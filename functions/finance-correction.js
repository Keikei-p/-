"use strict";

/*
 * Server-side OWNER-only historical revenue correction.
 * No direct client writes of a record and its audit document: the current
 * Firestore security rules exceed expression limits for a combined client
 * transaction. Firebase Admin runs both writes atomically, with real owner,
 * company, price-master and optimistic concurrency checks.
 *
 * Deployment gated in functions/index.js; requires backup proof and OWNER
 * authorization. Never create missing records, change counts/team/date/uid,
 * or reprice an unknown cashback plan.
 */
function reject(ErrorType,code,message){
  throw new ErrorType(code,message);
}

function checkedInteger(value,ErrorType,label){
  const v=Number(value);
  if(value===null || value===undefined || value==="" ||
     !Number.isSafeInteger(v) || v<0)
    reject(ErrorType,"failed-precondition",label+"を確認できません。");
  return v;
}

function calculateOnePriceCorrection(record,product,input,ErrorType=Error){
  const issue=(code,msg)=>reject(ErrorType,code,msg);
  if(!record || !record.results || Array.isArray(record.results) ||
     typeof record.results!=="object")issue("failed-precondition","実績明細が見つかりません。");
  if(!product)issue("failed-precondition","商材が存在しません。");
  const cb=checkedInteger(input.cashback,ErrorType,"CBプラン");
  const explicit=Array.isArray(product.pricingOptions) && product.pricingOptions.length>0;
  const legacyCbTiers=Array.isArray(product.cashbackOptions) &&
    product.cashbackOptions.some(x=>Number(x)>0);
  const taggedCbName=/(?:CB|キャッシュバック)[\s（(:：]*[￥¥]?[0-9,]+/i.test(String(product.name||""));
  // Old non-CB products legitimately store one revenue number rather than
  // pricingOptions. Their known master price may be used for an OWNER-approved
  // correction, but never infer a price for a legacy cashback tier.
  const simpleLegacy=(!explicit && !legacyCbTiers && !taggedCbName &&
    product.revenue!==null && product.revenue!==undefined &&
    product.revenue!=="" && cb===0);
  const priceOptions=explicit ? product.pricingOptions :
    (simpleLegacy ? [{cashback:0,revenuePerUnit:product.revenue}] : []);
  if(!priceOptions.length)
    issue("failed-precondition","CB別売上単価が未確認です。通常商材はマスター収益単価を確認してください。");
  const matches=priceOptions.filter(p=>Number(p.cashback)===cb);
  if(matches.length!==1)issue("failed-precondition","対象のCBプランを一意に特定できません。");
  const newUnit=checkedInteger(matches[0].revenuePerUnit,ErrorType,"商材単価");
  const rows=Object.entries(record.results);
  const selected=rows.filter(([,row])=>row?.productId===input.productId &&
      (row.cashback == null
        ? priceOptions.length===1 && cb===0
        : Number(row.cashback)===cb));
  if(selected.length!==1)issue("failed-precondition","対象の商材とCBを一意に特定できません。");
  const [key,row]=selected[0];
  const beforeUnit=checkedInteger(row.revenuePerUnit,ErrorType,"保存済み単価");
  const selectedCount=checkedInteger(row.count,ErrorType,"保存済み件数");
  if(!selectedCount)issue("failed-precondition","対象の件数が0件です。");

  const expectedOldUnit=checkedInteger(input.expectedOldUnit,ErrorType,"確認済み単価");
  const expectedCount=checkedInteger(input.expectedSelectedCount,ErrorType,"確認済み件数");
  const expectedTotalCount=checkedInteger(input.expectedTotalCount,ErrorType,"確認済み合計件数");
  const expectedTotalRevenue=checkedInteger(input.expectedTotalRevenue,ErrorType,"確認済み売上合計");
  if(beforeUnit!==expectedOldUnit || selectedCount!==expectedCount ||
     Number(record.totalCount)!==expectedTotalCount ||
     Number(record.totalRevenue)!==expectedTotalRevenue)
    issue("aborted","他の端末で実績が更新されています。再読み込みしてください。");

  const priorUpdated=record.updatedAt?.toMillis?.()??null;
  if((input.expectedUpdatedAtMillis??null)!==priorUpdated)
    issue("aborted","保存時刻が更新されました。再読み込みしてください。");

  if(beforeUnit===newUnit)
    issue("failed-precondition","このCBプランの単価はすでに一致しています。");
  // Existing rows must already reconcile. A discrepancy involving multiple
  // rows is not safe to "fix" automatically with one guessed price.
  let originalCount=0, originalTotal=0;
  for(const [,original] of rows){
    const n=checkedInteger(original.count,ErrorType,"既存件数");
    const unit=checkedInteger(original.revenuePerUnit,ErrorType,"既存売上単価");
    if(!Number.isSafeInteger(n*unit))issue("failed-precondition","既存の金額が計算範囲を超えています。");
    originalCount+=n;originalTotal+=n*unit;
  }
  if(!Number.isSafeInteger(originalCount)||!Number.isSafeInteger(originalTotal)||
    originalCount!==expectedTotalCount||originalTotal!==expectedTotalRevenue)
    issue("failed-precondition","保存済みの明細と合計に差異があります。個別調査が必要です。");
  const results=Object.fromEntries(rows.map(([rowKey,item])=>
    [rowKey,rowKey===key?{...item,revenuePerUnit:newUnit}:{...item}]));
  let totalCount=0,totalRevenue=0;
  for(const item of Object.values(results)){
    const n=checkedInteger(item.count,ErrorType,"明細件数");
    const price=checkedInteger(item.revenuePerUnit,ErrorType,"明細単価");
    if(!Number.isSafeInteger(n*price))
      issue("failed-precondition","売上の数値範囲を超えています。");
    totalCount+=n;
    totalRevenue+=n*price;
    if(!Number.isSafeInteger(totalCount)||!Number.isSafeInteger(totalRevenue))
      issue("failed-precondition","売上の数値範囲を超えています。");
  }
  if(totalCount!==expectedTotalCount || totalCount!==Number(record.totalCount))
    issue("failed-precondition","元の合計件数と明細が異なります。");
  return {results,totalCount,totalRevenue,oldUnit:beforeUnit,newUnit,selectedCount};
}

function recordAuditSnapshot(record){
  return {
    memberNameSnapshot:record.memberNameSnapshot||"",
    teamId:record.teamId||null,
    teamNameSnapshot:record.teamNameSnapshot||"",
    workLocation:record.workLocation||"",
    results:record.results||{},
    totalCount:Number(record.totalCount||0),
    totalRevenue:Number(record.totalRevenue||0),
    reportStatus:record.reportStatus||"submitted"
  };
}

async function executeConfirmedCorrection({db,FieldValue,HttpsError,uid,companyId,input}){
  if(!uid || !companyId || typeof input!=="object" || !input)
    reject(HttpsError,"invalid-argument","訂正内容を確認できません。");
  const recordId=String(input.recordId||"").trim();
  const productId=String(input.productId||"").trim();
  const reason=String(input.reason||"").trim();
  if(!recordId || recordId.length>300 || recordId.includes("/") ||
     !productId || productId.length>300 || productId.includes("/") ||
     reason.length<5 || reason.length>200)
    reject(HttpsError,"invalid-argument","訂正対象と訂正理由（5〜200文字）を確認してください。");

  const recordRef=db.collection("records").doc(recordId);
  const productRef=db.collection("products").doc(productId);
  const companyRef=db.collection("companies").doc(companyId);
  const userRef=db.collection("users").doc(uid);
  const memberRef=companyRef.collection("members").doc(uid);
  // Different collection: existing /recordCorrections is readable by every
  // company member under current Firestore rules. Never put revenue values
  // or before/after snapshots there. This new path is deny-by-default for
  // all client SDK users; only Admin transactions can access it.
  const auditRef=db.collection("privateRevenueCorrectionAudits").doc();

  return db.runTransaction(async tx=>{
    // All reads precede all writes; checked atomically on Firebase Admin.
    const [recordSnap,productSnap,companySnap,userSnap,memberSnap]=
      await Promise.all([recordRef,productRef,companyRef,userRef,memberRef].map(ref=>tx.get(ref)));
    const company=companySnap.data()||{},user=userSnap.data()||{},
      member=memberSnap.data()||{},record=recordSnap.data()||{},
      product=productSnap.data()||{};
    if(!companySnap.exists || !memberSnap.exists || !userSnap.exists ||
       company.active===false || company.ownerUid!==uid ||
       user.companyId!==companyId || user.companyRole!=="owner" ||
       member.companyId && member.companyId!==companyId ||
       member.companyRole!=="owner" || member.active===false)
      reject(HttpsError,"permission-denied","オーナー権限を確認できません。");
    if(!recordSnap.exists || !productSnap.exists ||
       record.companyId!==companyId || product.companyId!==companyId)
      reject(HttpsError,"not-found","この会社の商材・実績が見つかりません。");
    const plan=calculateOnePriceCorrection(record,product,input,HttpsError);
    const now=FieldValue.serverTimestamp();
    const after={...recordAuditSnapshot(record),results:plan.results,
      totalCount:plan.totalCount,totalRevenue:plan.totalRevenue,
      financialCorrectionReason:reason};
    tx.update(recordRef,{
      results:plan.results,totalCount:plan.totalCount,
      totalRevenue:plan.totalRevenue,updatedByUid:uid,updatedAt:now
    });
    tx.create(auditRef,{
      companyId,recordId,recordUid:record.uid,recordDate:record.date,
      changedByUid:uid,changedByName:user.name||member.name||"オーナー",
      before:recordAuditSnapshot(record),after,
      // Atomic per-record recovery copy; retains untouched fields, timestamps,
      // identifier and team/owner metadata so no external guessed restore needed.
      originalRecordSnapshot:record,
      createdAt:now
    });
    return {recordId,totalCount:plan.totalCount,totalRevenue:plan.totalRevenue};
  });
}

module.exports={calculateOnePriceCorrection,recordAuditSnapshot,executeConfirmedCorrection};
