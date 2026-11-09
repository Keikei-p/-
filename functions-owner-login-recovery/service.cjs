"use strict";
/**
 * STAGING ONLY / DEFAULT OFF. Explicit primary Owner-controlled recovery for
 * existing internal NON-OWNER staff accounts. Never repairs partner accounts,
 * company owners, unknown roles, or disabled Firebase Auth credentials.
 *
 * The only write set is users/{uid}.active, updatedAt;
 * companies/{hub}/members/{uid}.active, updatedAt; and one append-only audit.
 * Does not create/delete users, update Auth, or touch financial/count records.
 */
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const safeId=v=>typeof v==="string"&&ID.test(v);
const MEMBER_TYPES=new Set(["internal","direct","member","managed"]);
const REASONS=new Set(["PERSONALLY_VERIFIED_RETURN","OWNER_CONFIRMED_ACCOUNT_RESTORE"]);
const MESSAGE="ログイン復旧には主Ownerによる本人・所属・停止理由の確認が必要です。";
const allowedInternal=(u,m,uid,cid)=>u?.uid===uid&&u.companyId===cid&&
 u.active===false&&u.companyRole!=="owner"&&u.authKind!=="partner_code_shared"&&
 (u.accessKind==null||u.accessKind==="internal")&&
 (u.memberType==null||MEMBER_TYPES.has(u.memberType))&&
 m?.uid===uid&&(m.companyId==null||m.companyId===cid)&&
 m.active===false&&m.companyRole!=="owner"&&
 m.authKind!=="partner_code_shared"&&
 (m.accessKind==null||m.accessKind==="internal")&&
 (m.memberType==null||MEMBER_TYPES.has(m.memberType))&&
 (u.companyRole==null||m.companyRole==null||u.companyRole===m.companyRole)&&
 (u.teamId==null||m.teamId==null||u.teamId===m.teamId);
const version=s=>{
 const time=s?.updateTime?.toMillis?.();
 return Number.isSafeInteger(time)&&time>0?time:null;
};
function makeOwnerLoginRecovery({
 db,getAuth,FieldValue,HttpsError,verifyHubOwner,
 enabledRead=()=>false,enabledWrite=()=>false
}={}){
 if(!db?.collection||typeof db.runTransaction!=="function"||
   typeof getAuth!=="function"||typeof FieldValue?.serverTimestamp!=="function"||
   typeof HttpsError!=="function"||typeof verifyHubOwner!=="function"||
   typeof enabledRead!=="function"||typeof enabledWrite!=="function")
  throw Error("LOGIN_RECOVERY_MISSING_TRUSTED_DEPENDENCIES");
 const fail=(code="permission-denied")=>{throw new HttpsError(code,MESSAGE)};
 const companyRef=cid=>db.collection("companies").doc(cid);
 const userRef=uid=>db.collection("users").doc(uid);
 const memberRef=(cid,uid)=>companyRef(cid).collection("members").doc(uid);
 const primary=async(req,tx)=>{
  if(enabledRead()!==true)fail("unavailable");
  const actor=await verifyHubOwner(req,tx);
  if(!actor||actor.kind!=="hub"||actor.role!=="owner"||
   actor.ownerGrant!=="primary"||!safeId(actor.uid)||!safeId(actor.hubId))
   fail();
  return actor;
 };
 async function checkTarget({cid,uid,us,ms}){
  if(!us?.exists||!ms?.exists||
   !allowedInternal(us.data(),ms.data(),uid,cid)||
   version(us)===null||version(ms)===null)return {eligible:false,reason:"PROFILE_OR_MEMBER_NOT_RESTORABLE"};
  let account;
  try{account=await getAuth().getUser(uid)}catch(e){
   if(e?.code==="auth/user-not-found")
    return {eligible:false,reason:"AUTH_RECORD_MISSING"};
   fail("unavailable");
  }
  const email=typeof account?.email==="string"?account.email.trim().toLowerCase():"";
  if(account?.uid!==uid||account.disabled!==false||account.emailVerified!==true||
   !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
   return {eligible:false,reason:"AUTH_DISABLED_OR_UNVERIFIED"};
  const profileEmail=us.data().email;
  if(typeof profileEmail!=="string"||profileEmail.trim().toLowerCase()!==email)
   return {eligible:false,reason:"AUTH_PROFILE_EMAIL_MISMATCH"};
  return {eligible:true,email,auth:account,
   userVersion:version(us),memberVersion:version(ms)};
 }
 function nameOf(user){
  const str=typeof user?.name==="string"?user.name.trim():"";
  return str.length>=1&&str.length<=40?str:"名前未設定";
 }
 function maskedEmail(email){
  const [local,host]=email.split("@");
  return local.slice(0,1)+"***@"+host;
 }
 async function list(request){
  if(request?.data==null||typeof request.data!=="object"||
   Array.isArray(request.data)||Object.keys(request.data).length!==0)
   fail("invalid-argument");
  const actor=await primary(request);
  const snap=await db.collection("users").where("companyId","==",actor.hubId).limit(61).get();
  if(!Array.isArray(snap?.docs)||snap.docs.length>60)fail("resource-exhausted");
  const rows=[];let suppressed=0;
  for(const row of snap.docs){
   if(!safeId(row.id)||row.id===actor.uid)continue;
   const u=row.data()||{};
   if(u.active!==false)continue;
   const ms=await memberRef(actor.hubId,row.id).get();
   const state=await checkTarget({cid:actor.hubId,uid:row.id,us:row,ms});
   if(!state.eligible){suppressed++;continue}
   if(rows.length>=20)fail("resource-exhausted");
   rows.push({
    uid:row.id,displayName:nameOf(u),maskedEmail:maskedEmail(state.email),
    userVersion:state.userVersion,memberVersion:state.memberVersion,
    recoveryReadyForOwnerReview:true
   });
  }
  return {
   kind:"owner-reviewed-internal-login-recovery",
   candidates:rows,excludedForSafety:suppressed,
   requiresExplicitOwnerDecision:true,
   writeEnabled:enabledWrite()===true&&enabledRead()===true,
   financeRead:false,historyChanged:false
  };
 }
 async function reactivate(request){
  if(enabledRead()!==true||enabledWrite()!==true)fail("unavailable");
  const d=request?.data;
  if(!d||typeof d!=="object"||Array.isArray(d)||
   Object.keys(d).sort().join("|")!==
    "confirmation|emailConfirmation|memberVersion|reasonCode|targetUid|userVersion"||
   d.confirmation!=="OWNER_CONFIRMS_PERSON_AND_REASON"||
   !REASONS.has(d.reasonCode)||!safeId(d.targetUid)||
   !Number.isSafeInteger(d.userVersion)||d.userVersion<=0||
   !Number.isSafeInteger(d.memberVersion)||d.memberVersion<=0||
   typeof d.emailConfirmation!=="string"||
   d.emailConfirmation.trim().toLowerCase()!==d.emailConfirmation||
   d.emailConfirmation.length>254||
   !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.emailConfirmation))
   fail("invalid-argument");
  // Isolated Auth GET preflight: NEVER enable disabled Firebase Auth accounts.
  let account;try{account=await getAuth().getUser(d.targetUid)}
  catch{fail("failed-precondition")}
  if(account.uid!==d.targetUid||account.disabled!==false||
   account.emailVerified!==true||
   account.email?.trim().toLowerCase()!==d.emailConfirmation)
   fail("failed-precondition");
  const auditRef=db.collection("loginReactivationAudit").doc();
  return db.runTransaction(async tx=>{
   const actor=await primary(request,tx);
   if(d.targetUid===actor.uid)fail();
   const us=await tx.get(userRef(d.targetUid));
   const ms=await tx.get(memberRef(actor.hubId,d.targetUid));
   const checked=await checkTarget({
    cid:actor.hubId,uid:d.targetUid,us,ms
   });
   if(!checked.eligible||checked.email!==d.emailConfirmation)fail();
   if(checked.userVersion!==d.userVersion||
      checked.memberVersion!==d.memberVersion)
    fail("aborted");
   // Only these four fields change; historical sales/counts/roles preserved.
   tx.update(userRef(d.targetUid),{
    active:true,updatedAt:FieldValue.serverTimestamp()
   });
   tx.update(memberRef(actor.hubId,d.targetUid),{
    active:true,updatedAt:FieldValue.serverTimestamp()
   });
   tx.create(auditRef,{
    kind:"owner-approved-internal-login-reactivation",
    hubCompanyId:actor.hubId,ownerUid:actor.uid,
    targetUid:d.targetUid,reasonCode:d.reasonCode,
    previousUserVersion:d.userVersion,
    previousMemberVersion:d.memberVersion,
    createdAt:FieldValue.serverTimestamp(),
    userHistoryRetained:true,memberHistoryRetained:true,
    authAccountUnchanged:true
   });
   return {restored:true,uid:d.targetUid,
    userActive:true,memberActive:true,authAccountUnchanged:true,
    financialOriginalsUnchanged:true,historyRetained:true};
  });
 }
 return Object.freeze({list,reactivate});
}
module.exports={makeOwnerLoginRecovery};
