"use strict";
/**
 * STAGING ONLY: owner corrections for existing partner count entries.
 * No production callable export and no Firebase deploy. Requires a trusted
 * server-side verifyHubOwner(request, transaction?) callback from the existing
 * workspace actor/scope path when integrated. NEVER use client-supplied identity.
 */
const {LEGACY,PARTS,breakdown,nextBreakdown,aggregateBreakdown}=
 require("../partner-sb-v2/sb-category-v2.cjs");
const KEYS=Object.freeze([
 "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const empty=()=>Object.fromEntries(KEYS.map(key=>[key,0]));
function makeHubCountCorrections({
 db,FieldValue,HttpsError,verifyHubOwner,now=()=>Date.now(),enabled=()=>false
}={}){
 if(!db||!FieldValue||!HttpsError||typeof verifyHubOwner!=="function")
  throw Error("HUB_CORRECTION_DEPENDENCIES");
 const fail=(code="permission-denied")=>{
  throw new HttpsError(code,"協力店の権限・件数または訂正版を確認できません。");
 };
 const norm=x=>typeof x==="string"?x.trim():"";
 const validateDay=x=>{
  if(typeof x!=="string"||!DATE.test(x))fail("invalid-argument");
  const timestamp=Date.parse(x+"T00:00:00Z");
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==x)
   fail("invalid-argument");
  const today=new Intl.DateTimeFormat("en-CA",{
   timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(now());
  const max=Date.parse(today+"T00:00:00Z");
  if(timestamp>max||timestamp<max-366*86400000)fail("invalid-argument");
  return x;
 };
 const validateCounts=obj=>{
  if(!obj||typeof obj!=="object"||Array.isArray(obj)||
     Object.keys(obj).sort().join("|")!==[...KEYS].sort().join("|"))
   fail("invalid-argument");
  let total=0;const counts={};
  for(const key of KEYS){
   const n=obj[key];
   if(!Number.isSafeInteger(n)||n<0||n>9999)fail("invalid-argument");
   counts[key]=n;total+=n;
  }
  return {counts,total};
 };
 const ref=(companyId,collection)=>db.collection("companies").doc(companyId).collection(collection);
 const entry=(cid,date,staffId)=>ref(cid,"partnerWorkEntries").doc(date+"__"+staffId);
 const summary=(hub,date,partnerId)=>ref(hub,"partnerWorkCountDays").doc(date)
  .collection("reports").doc(partnerId);
 const ensureHub=async(request,tx)=>{
  if(enabled()!==true)fail("unavailable");
  const actor=await verifyHubOwner(request,tx);
  // verifyHubOwner must use the *server-verified* principal / live company scope,
  // not request.data. Check its output again to fail closed.
  if(!actor||actor.kind!=="hub"||actor.role!=="owner"||
     !ID.test(actor.uid||"")||!ID.test(actor.hubId||""))fail();
  return actor;
 };
 const ensurePartner=async(reader,hubId,partnerId)=>{
  if(!ID.test(partnerId||"")||partnerId===hubId)fail("invalid-argument");
  const [cs,rs]=await Promise.all([
   reader(db.collection("companies").doc(partnerId)),
   reader(db.collection("partnerRelations").doc(partnerId))
  ]);
  const c=cs.data()||{},r=rs.data()||{};
  if(!cs.exists||!rs.exists||c.active!==true||c.companyKind!=="partner"||
    c.hubCompanyId!==hubId||r.partnerCompanyId!==partnerId||
    r.hubCompanyId!==hubId||r.active!==true||
    r.countSharingApproved!==true||typeof c.name!=="string"||
    !c.name.trim()||c.name.length>80||MONEY.test(c.name))
   fail();
  return c.name.trim();
 };
 const validateExisting=(doc,cid,hub,date,staffId)=>{
  const d=doc.data()||{};
  if(!doc.exists||d.companyId!==cid||d.hubCompanyId!==hub||
    d.date!==date||d.staffId!==staffId||
    !Number.isSafeInteger(d.version)||d.version<1||
    d.version>999||d.totalCount<0)fail("failed-precondition");
  const values=validateCounts(d.counts);
  if(values.total!==d.totalCount)fail("data-loss");
  try{if(d.sbBreakdown!=null)breakdown(values.counts[LEGACY],d.sbBreakdown);}
  catch{fail("data-loss");}
  return {raw:d,counts:values.counts,total:values.total};
 };
 const validateSummary=(doc,cid,hub,date)=>{
  const s=doc.data()||{};
  if(!doc.exists||s.source!=="staff-entries-v1"||
    s.partnerCompanyId!==cid||s.hubCompanyId!==hub||s.date!==date||
    !Number.isSafeInteger(s.totalCount)||s.totalCount<0)
   fail("failed-precondition");
  const values=validateCounts(s.counts);
  if(values.total!==s.totalCount)fail("data-loss");
  try{if(s.sbBreakdown!=null)breakdown(values.counts[LEGACY],s.sbBreakdown,{
   max:Number.MAX_SAFE_INTEGER});}
  catch{fail("data-loss");}
  return {raw:s,counts:values.counts,total:values.total};
 };
 async function list(request){
  const d=request?.data||{},date=validateDay(d.date),partnerId=norm(d.partnerCompanyId);
  if(Object.keys(d).sort().join("|")!=="date|partnerCompanyId")fail("invalid-argument");
  const hub=await ensureHub(request,null);
  await ensurePartner(r=>r.get(),hub.hubId,partnerId);
  const snapshots=await ref(partnerId,"partnerWorkEntries")
   .where("date","==",date).limit(201).get();
  if(snapshots.size>200)fail("resource-exhausted");
  const entries=[];
  for(const sn of snapshots.docs){
   const row=sn.data()||{},staffId=norm(row.staffId);
   if(!ID.test(staffId)||sn.id!==date+"__"+staffId)fail("data-loss");
   const v=validateExisting({exists:true,data:()=>row},partnerId,hub.hubId,date,staffId);
   entries.push({staffId,staffName:typeof row.staffNameSnapshot==="string"&&
    row.staffNameSnapshot.length<=60&&!MONEY.test(row.staffNameSnapshot)?
    row.staffNameSnapshot:"（氏名未確認）",
    teamIdSnapshot:ID.test(row.teamIdSnapshot||"")?row.teamIdSnapshot:null,
    counts:v.counts,totalCount:v.total,version:row.version,
    sbBreakdown:breakdown(v.counts[LEGACY],row.sbBreakdown)});
  }
  entries.sort((a,b)=>a.staffName.localeCompare(b.staffName,"ja")||
   a.staffId.localeCompare(b.staffId));
  return {role:"hub",scope:"existing-partner-counts-only",date,partnerCompanyId:partnerId,
   entries,sbBreakdownSchema:"sb-separated-v1",containsFinance:false};
 }
 async function correct(request){
  const d=request?.data||{},keys=Object.keys(d).sort().join("|");
  const expectedNoSplit="correctionReason|counts|date|expectedVersion|partnerCompanyId|staffId";
  const expectedWithSplit="correctionReason|counts|date|expectedVersion|partnerCompanyId|sbBreakdown|staffId";
  if(keys!==expectedNoSplit&&keys!==expectedWithSplit)fail("invalid-argument");
  const date=validateDay(d.date),partnerId=norm(d.partnerCompanyId),staffId=norm(d.staffId);
  if(!ID.test(staffId)||!ID.test(partnerId)||!Number.isSafeInteger(d.expectedVersion)||
   d.expectedVersion<1||d.expectedVersion>=999)fail("invalid-argument");
  const reason=norm(d.correctionReason);
  if(reason.length<6||reason.length>120||/[\r\n]/.test(reason)||MONEY.test(reason))
   fail("invalid-argument");
  const {counts,total}=validateCounts(d.counts);
  const hasSplit=Object.prototype.hasOwnProperty.call(d,"sbBreakdown");
  if(hasSplit){
   try{breakdown(counts[LEGACY],d.sbBreakdown);}
   catch{fail("invalid-argument");}
  }
  const hub=await ensureHub(request,null);
  if(partnerId===hub.hubId)fail();
  return db.runTransaction(async tx=>{
   const fresh=await ensureHub(request,tx);
   if(fresh.uid!==hub.uid||fresh.hubId!==hub.hubId)fail();
   await ensurePartner(r=>tx.get(r),hub.hubId,partnerId);
   const er=entry(partnerId,date,staffId);
   const summaryRef=summary(hub.hubId,date,partnerId);
   // Both the entry and the original company aggregate must already exist.
   // No owner-created fake person or new daily report is permitted.
   const [existingDoc,summaryDoc]=await Promise.all([tx.get(er),tx.get(summaryRef)]);
   const existing=validateExisting(existingDoc,partnerId,hub.hubId,date,staffId);
   const aggregate=validateSummary(summaryDoc,partnerId,hub.hubId,date);
   if(existing.raw.version!==d.expectedVersion)fail("aborted");
   const next={};let nextTotal=0;
   for(const key of KEYS){
    const value=aggregate.counts[key]+counts[key]-existing.counts[key];
    if(!Number.isSafeInteger(value)||value<0)fail("data-loss");
    next[key]=value;nextTotal+=value;
   }
   if(nextTotal!==aggregate.total+total-existing.total)fail("data-loss");
   let nextSb,aggregateSb;
   try{
    nextSb=nextBreakdown({
     previousLegacy:existing.counts[LEGACY],
     previousRaw:existing.raw.sbBreakdown,
     nextLegacy:counts[LEGACY],
     requestedRaw:hasSplit?d.sbBreakdown:undefined
    });
    if(nextSb!==null||aggregate.raw.sbBreakdown!=null||
       existing.raw.sbBreakdown!=null)
     aggregateSb=aggregateBreakdown({
      previousAggregate:aggregate.counts[LEGACY],
      previousRaw:aggregate.raw.sbBreakdown,
      priorLegacy:existing.counts[LEGACY],
      priorRaw:existing.raw.sbBreakdown,
      nextLegacy:counts[LEGACY],
      nextRaw:nextSb
     });
   }catch{fail("data-loss");}
   // A replay with identical business counts must not manufacture a new
   // revision or append an audit event. Compare semantic SB breakdowns so
   // old "unclassified" and explicit unknown-only are treated identically.
   const oldParts=breakdown(existing.counts[LEGACY],existing.raw.sbBreakdown);
   const newParts=breakdown(counts[LEGACY],nextSb);
   if(KEYS.every(k=>counts[k]===existing.counts[k])&&
      PARTS.every(k=>oldParts[k]===newParts[k]))
    fail("failed-precondition");
   const stamp=FieldValue.serverTimestamp(),version=d.expectedVersion+1;
   // PATCH only count and version fields. Preserve team snapshot, people,
   // private products/private counts, create time, and old sales documents.
   const entryPatch={counts,totalCount:total,version,
    updatedByUid:hub.uid,updatedAt:stamp,
    ...(nextSb===null?{}:{sbBreakdown:nextSb})};
   const totalPatch={counts:next,totalCount:nextTotal,updatedAt:stamp,
    ...(aggregateSb===undefined?{}:{sbBreakdown:aggregateSb})};
   const ar=ref(partnerId,"partnerWorkAudits").doc(date+"__"+staffId+"__v"+version);
   tx.update(er,entryPatch);
   tx.update(summaryRef,totalPatch);
   // Append-only audit of *just* count fields. Finance and private counts
   // are never included in the audit payload or API response.
   tx.create(ar,{kind:"hub_owner_count_correction_v1",hubCompanyId:hub.hubId,
    partnerCompanyId:partnerId,staffId,date,previousVersion:d.expectedVersion,
    version,previousCounts:existing.counts,counts,
    previousSbBreakdown:breakdown(existing.counts[LEGACY],existing.raw.sbBreakdown),
    sbBreakdown:breakdown(counts[LEGACY],nextSb),
    correctionReason:reason,changedByUid:hub.uid,createdAt:stamp});
   return {saved:true,scope:"hub-owner-existing-only",partnerCompanyId:partnerId,
    staffId,date,version,totalCount:total,containsFinance:false};
  });
 }
 return Object.freeze({list,correct});
}
module.exports={makeHubCountCorrections,KEYS};
