"use strict";
// Owner-only partner count correction; authenticates the Hub Owner as themself.
// NO impersonation, auth/user/team/sales/price changes, or new-count creation.
const {validateSource,readSplit}=require("./internet-split-operations.cjs");
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
 // Bounded company directory for 100+ partners. Read-only and HUB Owner only.
 // 25 relations + company summaries per page. No team/record/price reads.
 async function listCompaniesPage(request){
  const d=request?.data||{};
  if(Object.keys(d).some(k=>k!=="cursor")||
     (d.cursor!==undefined&&d.cursor!==null&&d.cursor!==""&&!raw(d.cursor)))
   fail("invalid-argument");
  const {s}=await owner(request);
  const cursor=d.cursor||"";
  const PAGE=25;
  let query=db.collection("partnerRelations").where("hubCompanyId","==",s.cid)
   .orderBy("__name__");
  if(cursor)query=query.startAfter(cursor);
  const snapshot=await query.limit(PAGE+1).get();
  if(snapshot.size>PAGE+1)fail("resource-exhausted");
  const docs=snapshot.docs.slice(0,PAGE);
  const rows=await Promise.all(docs.map(async sn=>{
   const rel=sn.data()||{},cid=sn.id;
   if(!raw(cid)||rel.partnerCompanyId!==cid||
      rel.hubCompanyId!==s.cid)fail("data-loss");
   const company=await db.collection("companies").doc(cid).get();
   const c=company.data()||{},name=c.name;
   if(!company.exists||c.companyKind!=="partner"||
      c.hubCompanyId!==s.cid||
      typeof name!=="string"||!name.trim()||name.length>80||
      /(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/.test(name))
    fail("data-loss");
   return {partnerCompanyId:cid,name:name.trim(),
    approved:rel.active===true&&rel.countSharingApproved===true&&c.active===true};
  }));
  if(rows.some((row,i)=>i>0&&rows[i-1].partnerCompanyId>=row.partnerCompanyId))
   fail("data-loss");
  const hasMore=snapshot.size>PAGE;
  return {scope:"hub_owner_partner_directory_counts_only",
   companies:rows,nextCursor:hasMore?(docs.at(-1)?.id||null):null,
   hasMore,pageSize:PAGE,financialFieldsIncluded:false,
   productionDocumentWrites:0};
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

 // Extra count-only operation to classify the ALREADY saved SB光・AIR total.
 // This does not touch the original per-person legacy nine-category count.
 async function classifyOwnerInternet(request){
  const d=request?.data||{};
  if(Object.keys(d).sort().join("|")!==
   "air|date|expectedRevision|hikari|partnerCompanyId|reason|sourceVersion|staffId")
   fail("invalid-argument");
  const date=validDate(d.date);
  if(!raw(d.partnerCompanyId)||!raw(d.staffId)||
   !Number.isSafeInteger(d.hikari)||d.hikari<0||d.hikari>9999||
   !Number.isSafeInteger(d.air)||d.air<0||d.air>9999||
   !Number.isSafeInteger(d.sourceVersion)||d.sourceVersion<1||
   !Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0||
   d.expectedRevision>=999||typeof d.reason!=="string"||
   d.reason.trim().length<3||d.reason.trim().length>160||
   /[\x00-\x1f\x7f]/.test(d.reason))fail("invalid-argument");
  const {a,s}=await owner(request);
  return db.runTransaction(async tx=>{
   const fresh=await owner(request,tx);
   if(fresh.a.uid!==a.uid||fresh.s.cid!==s.cid)fail();
   await relation(s.cid,d.partnerCompanyId,tx);
   const cr=entry(d.partnerCompanyId,date,d.staffId);
   const dr=collection(d.partnerCompanyId,"partnerInternetSplits")
    .doc(date+"__"+d.staffId);
   const [originalSnap,splitSnap]=await Promise.all([tx.get(cr),tx.get(dr)]);
   if(!originalSnap.exists)fail("failed-precondition");
   let source,previous;
   try{
    source=validateSource(originalSnap.data(),{
     cid:d.partnerCompanyId,hubId:s.cid,date,staffId:d.staffId});
    const originalCounts=validateCounts(originalSnap.data().counts);
    if(originalCounts.total!==originalSnap.data().totalCount)fail("data-loss");
    previous=readSplit(splitSnap.exists?splitSnap.data():null,{
     cid:d.partnerCompanyId,hubId:s.cid,date,staffId:d.staffId});
   }catch{fail("data-loss");}
   if(source.sourceVersion!==d.sourceVersion||
      d.hikari+d.air!==source.total)fail("failed-precondition");
   if((previous?.revision??0)!==d.expectedRevision)fail("aborted");
   if(previous&&previous.sourceVersion===source.sourceVersion&&
      previous.hikari===d.hikari&&previous.air===d.air)
    return {saved:false,unchanged:true,staffId:d.staffId,date,
     partnerCompanyId:d.partnerCompanyId,revision:previous.revision,
     combinedCount:source.total,verified:true};
   const revision=(previous?.revision??0)+1,stamp=FieldValue.serverTimestamp();
   const classification={companyId:d.partnerCompanyId,hubCompanyId:s.cid,
    date,staffId:d.staffId,hikari:d.hikari,air:d.air,
    combinedCount:source.total,sourceVersion:source.sourceVersion,revision,
    updatedByUid:a.uid,updatedAt:stamp};
   if(splitSnap.exists)tx.update(dr,classification);
   else tx.create(dr,{...classification,createdAt:stamp});
   const audit=collection(d.partnerCompanyId,"partnerInternetSplitAudits")
    .doc(date+"__"+d.staffId+"__v"+revision);
   tx.create(audit,{...classification,previousHikari:previous?.hikari??null,
    previousAir:previous?.air??null,previousRevision:previous?.revision??0,
    correctionType:"hub_owner_internet_classification",correctionActorUid:a.uid,
    correctionReason:d.reason.trim(),createdAt:stamp});
   return {saved:true,partnerCompanyId:d.partnerCompanyId,staffId:d.staffId,
    date,revision,combinedCount:source.total,verified:true,
    hikari:d.hikari,air:d.air,correctionLogged:true};
  });
 }
 return Object.freeze({viewDay,correctDay,classifyOwnerInternet,listCompaniesPage});
}
module.exports={makeOwnerPartnerCorrections};
