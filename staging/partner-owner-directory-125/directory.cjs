"use strict";
/**
 * STAGING ONLY / NO DEPLOY. Read-only Hub Owner partner directory.
 *
 * Deliberately independent of the legacy workspace's 100-company limit:
 * pagination reads partnerRelations + safe company labels only. This is NOT
 * a company creation API, rank API, impersonation or financial data reader.
 * A trusted adapter must provide live, authenticated verifyHubOwner().
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const FINANCE=/(?:単価|売上|収益|利益|報酬|キャッシュバック|[¥￥$€]|\d[\d,]*円)/i;
const PAGE=25;
function makeOwnerPartnerDirectory({db,verifyHubOwner,HttpsError}={}){
 if(!db||typeof db.collection!=="function"||
    typeof verifyHubOwner!=="function"||typeof HttpsError!=="function")
  throw Error("OWNER_DIRECTORY_STAGING_DEPENDENCIES");
 const fail=(code="permission-denied")=>{
  throw new HttpsError(code,"協力店の一覧を安全に取得できません。");
 };
 const valid=x=>typeof x==="string"&&ID.test(x);
 async function list(request){
  const data=request?.data||{};
  if(!data||typeof data!=="object"||Array.isArray(data)||
     Object.keys(data).some(k=>k!=="cursor")||
     !(data.cursor==null||data.cursor===""||valid(data.cursor)))
   fail("invalid-argument");
  // Never use the supplied query/body as a source of Owner identity.
  const actor=await verifyHubOwner(request);
  if(!actor||actor.serverVerified!==true||actor.kind!=="hub"||
     actor.role!=="owner"||!valid(actor.uid)||!valid(actor.hubId))
   fail();
  const cursor=data.cursor||null;
  let query=db.collection("partnerRelations")
   .where("hubCompanyId","==",actor.hubId).orderBy("__name__");
  if(cursor)query=query.startAfter(cursor);
  const snapshot=await query.limit(PAGE+1).get();
  if(!snapshot||!Array.isArray(snapshot.docs)||
     snapshot.docs.length>PAGE+1||snapshot.size!==snapshot.docs.length)
   fail("data-loss");
  const docs=snapshot.docs.slice(0,PAGE);
  const companies=await Promise.all(docs.map(async document=>{
   const id=document.id,rel=document.data()||{};
   if(!valid(id)||id===actor.hubId||
      rel.partnerCompanyId!==id||rel.hubCompanyId!==actor.hubId)
    fail("data-loss");
   const record=await db.collection("companies").doc(id).get();
   const company=record.data()||{};
   if(!record.exists||company.companyKind!=="partner"||
      company.hubCompanyId!==actor.hubId||
      typeof company.name!=="string"||!company.name.trim()||
      company.name.trim().length>80||FINANCE.test(company.name))
    fail("data-loss");
   return {partnerCompanyId:id,name:company.name.trim(),
    active:rel.active===true&&company.active===true,
    countSharingApproved:rel.active===true&&
     company.active===true&&rel.countSharingApproved===true};
  }));
  for(let i=0;i<companies.length;i++)
   if((i===0&&cursor&&companies[i].partnerCompanyId<=cursor)||
      (i>0&&companies[i].partnerCompanyId<=companies[i-1].partnerCompanyId))
    fail("data-loss");
  const more=snapshot.docs.length>PAGE;
  return {
   scope:"hub_owner_partner_directory_staging_counts_only",
   companies,
   nextCursor:more?companies.at(-1)?.partnerCompanyId??null:null,
   hasMore:more,
   pageSize:PAGE,
   // A single page is never proof of complete company coverage or a rank.
   completeNetworkSnapshot:false,
   financialFieldsIncluded:false,
   productionDocumentWrites:0
  };
 }
 return Object.freeze({list});
}
module.exports={makeOwnerPartnerDirectory};
