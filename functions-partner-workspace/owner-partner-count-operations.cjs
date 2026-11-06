"use strict";
// Owner-only partner count correction; authenticates the Hub Owner as themself.
// NO impersonation, auth/user/team/sales/price changes, or new-count creation.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ZERO=keys=>Object.fromEntries(keys.map(k=>[k,0]));
function makeOwnerPartnerCorrections({db,actor,scope,collection,FieldValue,fail,
 validDate,validateCounts,validatePrivateCounts,KEYS,legacyPolicyFor,assertLegacyEdit}={}){
 if(!db||!actor||!scope||!collection||!FieldValue||!fail||!validDate||
  !validateCounts||!validatePrivateCounts||!legacyPolicyFor||!assertLegacyEdit||
  !Array.isArray(KEYS)||KEYS.length!==9)throw Error("OWNER_CORRECTION_DEPS_MISSING");
 const raw=id=>typeof id==="string"&&ID.test(id);
 const entry=(cid,date,staff)=>collection(cid,"partnerWorkEntries").doc(date+"__"+staff);
 const summary=(hub,date,cid)=>collection(hub,"partnerWorkCountDays")
  .doc(date).collection("reports").doc(cid);
 async function owner(request,tx=null){
  const a=await actor(request);
  const s=await scope(a.uid,tx);
  if(s.kind!=="hub"||s.role!=="owner"||!raw(s.cid))fail();
  // A dual-context Owner may not bypass their current partner financial boundary.
  const context=await (tx?tx.get(db.collection("partnerWorkspaceContexts").doc(a.uid)):
   db.collection("partnerWorkspaceContexts").doc(a.uid).get());
  if(context.exists)fail();
  return {a,s};
 }
 async function relation(hub,cid,tx=null){
  if(!raw(cid))fail("invalid-argument");
  const read=ref=>tx?tx.get(ref):ref.get();
  const [rs,cs]=await Promise.all([
   read(db.collection("partnerRelations").doc(cid)),
   read(db.collection("companies").doc(cid))
  ]);
  const r=rs.data()||{},c=cs.data()||{};
  if(!rs.exists||!cs.exists||r.partnerCompanyId!==cid||
   r.hubCompanyId!==hub||r.active!==true||r.countSharingApproved!==true||
   c.companyKind!=="partner"||c.hubCompanyId!==hub||c.active!==true||
   typeof c.name!=="string"||!c.name.trim()||c.name.length>80)fail();
  return c.name.trim();
 }
 async function viewDay(request){
  const d=request?.data||{};
  if(Object.keys(d).sort().join("|")!=="date|partnerCompanyId")
   fail("invalid-argument");
  const date=validDate(d.date);
  const {s}=await owner(request);
  const companyName=await relation(s.cid,d.partnerCompanyId);
  const snaps=await collection(d.partnerCompanyId,"partnerWorkEntries")
   .where("date","==",date).limit(201).get();
  if(snaps.size>200)fail("resource-exhausted");
  const items=[],seen=new Set();
  for(const sn of snaps.docs){
   const x=sn.data()||{};
   if(!raw(x.staffId)||x.date!==date||sn.id!==date+"__"+x.staffId||
    seen.has(x.staffId)||x.companyId!==d.partnerCompanyId||
    x.hubCompanyId!==s.cid||
    !Number.isSafeInteger(x.version)||x.version<1)fail("data-loss");
   seen.add(x.staffId);
   let n;
   try{n=validateCounts(x.counts);}catch{fail("data-loss");}
   if(n.total!==x.totalCount)fail("data-loss");
   const name=(typeof x.staffNameSnapshot==="string"&&
    x.staffNameSnapshot.trim().length<=60&&x.staffNameSnapshot.trim())||
    "保存時の担当者名未確認";
   items.push({staffId:x.staffId,staffName:name,
    teamIdSnapshot:raw(x.teamIdSnapshot)?x.teamIdSnapshot:null,
    counts:n.counts,totalCount:n.total,version:x.version});
  }
  items.sort((a,b)=>a.staffName.localeCompare(b.staffName,"ja")||
   a.staffId.localeCompare(b.staffId));
  return {scope:"hub_owner_partner_count_correction",partnerCompanyId:d.partnerCompanyId,
   companyName,date,categories:[...KEYS],records:items,
   existingRecordsOnly:true,financialFieldsIncluded:false};
 }
 async function correctDay(request){
  const d=request?.data||{};
  if(Object.keys(d).sort().join("|")!==
   "counts|date|expectedVersion|partnerCompanyId|reason|staffId")
   fail("invalid-argument");
  const date=validDate(d.date);
  if(!raw(d.partnerCompanyId)||!raw(d.staffId)||
   !Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<1||
   d.expectedVersion>=999||
   typeof d.reason!=="string"||d.reason.trim().length<3||
   d.reason.trim().length>160||
   /[\x00-\x1f\x7f]/.test(d.reason))fail("invalid-argument");
  const {counts,total}=validateCounts(d.counts);
  const {a,s}=await owner(request);
  return db.runTransaction(async tx=>{
   // Recheck Owner and company relation INSIDE the same transaction.
   const live=await owner(request,tx);
   if(live.a.uid!==a.uid||live.s.cid!==s.cid)fail();
   const partnerName=await relation(s.cid,d.partnerCompanyId,tx);
   const er=entry(d.partnerCompanyId,date,d.staffId),
    sr=summary(s.cid,date,d.partnerCompanyId);
   const [oldSnap,summarySnap]=await Promise.all([tx.get(er),tx.get(sr)]);
   const old=oldSnap.data()||{},prev=summarySnap.data()||{};
   // Do not make up a new person / row / legacy aggregate. Owner corrects only
   // entries the partner has ALREADY saved.
   if(!oldSnap.exists||!summarySnap.exists||
    old.companyId!==d.partnerCompanyId||old.hubCompanyId!==s.cid||
    old.staffId!==d.staffId||old.date!==date||
    prev.source!=="staff-entries-v1"||
    prev.hubCompanyId!==s.cid||prev.partnerCompanyId!==d.partnerCompanyId)
    fail("failed-precondition");
   if(old.version!==d.expectedVersion)fail("aborted");
   let prior,aggregate,originalPrivate;
   try{
    prior=validateCounts(old.counts);
    aggregate=validateCounts(prev.counts);
    originalPrivate=validatePrivateCounts(old.privateCounts||{});
   }catch{fail("data-loss");}
   if(prior.total!==old.totalCount||aggregate.total!==prev.totalCount||
    originalPrivate.total!==(old.privateTotalCount??0))fail("data-loss");
   // Read the live publication gate so Owner proxy cannot bypass partner rules.
   const policy=await legacyPolicyFor({
    kind:"partner",cid:d.partnerCompanyId,hubId:s.cid},date,tx);
   assertLegacyEdit(policy,prior.counts,counts);
   if(KEYS.every(k=>prior.counts[k]===counts[k]))
    return {saved:false,unchanged:true,partnerCompanyId:d.partnerCompanyId,
     staffId:d.staffId,date,version:old.version,totalCount:prior.total};
   const next=ZERO(KEYS);
   let sum=0;
   for(const key of KEYS){
    const value=aggregate.counts[key]+counts[key]-prior.counts[key];
    if(!Number.isSafeInteger(value)||value<0)fail("data-loss");
    next[key]=value;sum+=value;
   }
   if(!Number.isSafeInteger(sum)||sum<0)fail("data-loss");
   // No team, staff, CB, private extra, historical identity or login mutation.
   const version=old.version+1,stamp=FieldValue.serverTimestamp();
   tx.update(er,{counts,totalCount:total,version,
    updatedByUid:a.uid,updatedAt:stamp});
   tx.update(sr,{counts:next,totalCount:sum,
    updatedAt:stamp,updatedByUid:a.uid});
   const audit=collection(d.partnerCompanyId,"partnerWorkAudits")
    .doc(date+"__"+d.staffId+"__v"+version);
   tx.create(audit,{
    companyId:d.partnerCompanyId,hubCompanyId:s.cid,date,staffId:d.staffId,
    counts,totalCount:total,privateCounts:originalPrivate.counts,
    privateTotalCount:originalPrivate.total,version,
    teamIdSnapshot:old.teamIdSnapshot??null,
    staffNameSnapshot:old.staffNameSnapshot??null,
    previousCounts:prior.counts,
    previousPrivateCounts:originalPrivate.counts,
    correctionActorUid:a.uid,correctionActorRole:"hub_owner",
    correctionReason:d.reason.trim(),correctionType:"owner_proxy_count_correction",
    createdAt:stamp,updatedByUid:a.uid,updatedAt:stamp
   });
   return {saved:true,partnerCompanyId:d.partnerCompanyId,staffId:d.staffId,
    date,version,totalCount:total,companyName:partnerName,
    correctionLogged:true};
  });
 }
 return Object.freeze({viewDay,correctDay});
}
module.exports={makeOwnerPartnerCorrections};
