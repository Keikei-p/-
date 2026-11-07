"use strict";
// Count-only opt-in nine-category guard. No edits to sales, saved entries, or history.
// Activation is separately disabled by default even if the module is deployed.
const {readLegacyGate,nextDay,activateLegacyGate,resolveLegacyPolicy,assertUnchangedBlocked}=
 require("./legacy-publication-policy.cjs");
const {readLinks}=require("./catalog-count-links.cjs");
const {loadPublication}=require("./catalog-publication.cjs");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
function makeLegacyPublicationOperations({db,actor,scope,collection,fail,FieldValue,jstToday,
 KEYS,activationEnabled=()=>false}={}){
 if(!db||!actor||!scope||!collection||!fail||!FieldValue||!jstToday||
    !Array.isArray(KEYS)||KEYS.length!==9)throw Error("LEGACY_GATE_DEPS_INVALID");
 const gateRef=cid=>collection(cid,"partnerCatalogSettings").doc("legacyPublicationGate");
 const pubRef=hub=>collection(hub,"partnerCatalogSettings").doc("publication");
 const linksRef=hub=>collection(hub,"partnerCatalogSettings").doc("countLinks");
 async function policyFor(s,date,tx=null){
  if(s.kind!=="partner")fail();
  const read=ref=>tx?tx.get(ref):ref.get();
  const gate=await read(gateRef(s.cid));
  let parsed;
  try{parsed=readLegacyGate(gate.exists?gate.data():null);}
  catch{fail("data-loss");}
  if(parsed.mode==="legacy"||date<parsed.effectiveFrom)
   return {mode:parsed.mode==="legacy"?"legacy":"scheduled",
    effectiveFrom:parsed.effectiveFrom,blockedCategories:[]};
  const [pub,links]=await Promise.all([read(pubRef(s.hubId)),read(linksRef(s.hubId))]);
  try{return resolveLegacyPolicy({gate:gate.data(),
   publication:pub.exists?pub.data():null,links:links.exists?links.data():null,
   date,categories:KEYS});}
  catch{fail("data-loss");}
 }
 async function getLegacyGate(request){
  const a=await actor(request),d=request?.data||{};
  if(Object.keys(d).sort().join("|")!=="partnerCompanyId"||
     !ID.test(d.partnerCompanyId||""))fail("invalid-argument");
  const s=await scope(a.uid);
  if(s.kind!=="hub"||s.role!=="owner")fail();
  const [relSnap,companySnap,gateSnap,linksSnap]=await Promise.all([
   db.collection("partnerRelations").doc(d.partnerCompanyId).get(),
   db.collection("companies").doc(d.partnerCompanyId).get(),
   gateRef(d.partnerCompanyId).get(),linksRef(s.cid).get()
  ]);
  const rel=relSnap.data()||{},company=companySnap.data()||{};
  if(!relSnap.exists||!companySnap.exists||
     rel.partnerCompanyId!==d.partnerCompanyId||rel.hubCompanyId!==s.cid||
     company.companyKind!=="partner"||company.hubCompanyId!==s.cid||
     company.active!==true)fail();
  try{
   const gate=readLegacyGate(gateSnap.exists?gateSnap.data():null);
   const links=readLinks(linksSnap.exists?linksSnap.data():null,KEYS);
   return {scope:"hub_legacy_count_gate_read_only",partnerCompanyId:d.partnerCompanyId,
    armed:gate.mode==="enforce",effectiveFrom:gate.effectiveFrom,
    revision:gate.revision,mappedCategories:links.links.map(x=>x.category),
    activationAvailable:false};
  }catch{fail("data-loss");}
 }
 async function activateLegacyCountGate(request){
  // Deliberately not enabled until independent finance/security/backup proof.
  if(activationEnabled()!==true)fail("failed-precondition");
  const a=await actor(request),d=request?.data||{};
  if(Object.keys(d).sort().join("|")!=="confirmation|expectedRevision|partnerCompanyId"||
     !ID.test(d.partnerCompanyId||"")||d.expectedRevision!==0||
     d.confirmation!=="ACTIVATE_NEXT_DAY_LEGACY_CATEGORY_FILTER")
   fail("invalid-argument");
  const s=await scope(a.uid);
  if(s.kind!=="hub"||s.role!=="owner")fail();
  const from=nextDay(jstToday());
  return db.runTransaction(async tx=>{
   const live=await scope(a.uid,tx);
   if(live.kind!=="hub"||live.cid!==s.cid||live.role!=="owner")fail();
   const ref=gateRef(d.partnerCompanyId);
   const [rs,cs,old,links]=await Promise.all([
    tx.get(db.collection("partnerRelations").doc(d.partnerCompanyId)),
    tx.get(db.collection("companies").doc(d.partnerCompanyId)),
    tx.get(ref),tx.get(linksRef(s.cid))
   ]);
   const rel=rs.data()||{},company=cs.data()||{};
   if(!rs.exists||!cs.exists||rel.partnerCompanyId!==d.partnerCompanyId||
      rel.hubCompanyId!==s.cid||rel.active!==true||rel.countSharingApproved!==true||
      company.companyKind!=="partner"||company.hubCompanyId!==s.cid||
      company.active!==true)fail("failed-precondition");
   let next;
   try{
    const mapping=readLinks(links.exists?links.data():null,KEYS);
    if(!mapping.links.some(x=>x.effectiveFrom<=from))fail("failed-precondition");
    next=activateLegacyGate(old.exists?old.data():null,from,d.expectedRevision);
   }catch(e){if(e?.code==="failed-precondition")throw e;fail("failed-precondition");}
   tx.create(ref,{...next,hubCompanyId:s.cid,partnerCompanyId:d.partnerCompanyId,
    activatedByUid:a.uid,activatedAt:FieldValue.serverTimestamp()});
   return {armed:true,effectiveFrom:from,partnerCompanyId:d.partnerCompanyId};
  });
 }
 function assertEdit(policy,previous,next){
  try{assertUnchangedBlocked({policy,previous,next,categories:KEYS});}
  catch{fail("failed-precondition");}
 }
 return Object.freeze({policyFor,getLegacyGate,activateLegacyCountGate,assertEdit});
}
module.exports={makeLegacyPublicationOperations};
