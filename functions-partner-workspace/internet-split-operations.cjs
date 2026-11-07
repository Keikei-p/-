"use strict";
// Partner SB Hikari / SoftBank Air classification, additive and count-only.
// Never migrate, overwrite or reprice the existing "SB光・AIR" count ledger.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const {monthBounds}=require("./partner-saved-month.cjs");
const LEGACY_KEY="SB光・AIR";
const safeInt=n=>Number.isSafeInteger(n)&&n>=0&&n<=9999;
const failure=()=>{throw Error("PARTNER_INTERNET_SPLIT_INVALID");};
function validateSource(row,{cid,hubId,date,staffId}){
 if(!row||row.companyId!==cid||row.hubCompanyId!==hubId||
    row.date!==date||row.staffId!==staffId||
    !Number.isSafeInteger(row.version)||row.version<1||
    !row.counts||typeof row.counts!=="object"||
    !safeInt(row.counts[LEGACY_KEY]))failure();
 return {total:row.counts[LEGACY_KEY],sourceVersion:row.version};
}
function readSplit(doc,{cid,hubId,date,staffId}){
 if(doc==null)return null;
 if(!doc||doc.companyId!==cid||doc.hubCompanyId!==hubId||
    doc.date!==date||doc.staffId!==staffId||
    !safeInt(doc.hikari)||!safeInt(doc.air)||
    !safeInt(doc.combinedCount)||doc.hikari+doc.air!==doc.combinedCount||
    !Number.isSafeInteger(doc.sourceVersion)||doc.sourceVersion<1||
    !Number.isSafeInteger(doc.revision)||doc.revision<1)failure();
 return {hikari:doc.hikari,air:doc.air,combinedCount:doc.combinedCount,
  sourceVersion:doc.sourceVersion,revision:doc.revision};
}
function projectSplit(source,split){
 const base={total:source.total,sourceVersion:source.sourceVersion};
 if(!split)return {...base,revision:0,verified:false,
  hikari:null,air:null,unclassified:source.total};
 const verified=split.combinedCount===source.total&&
  split.sourceVersion===source.sourceVersion;
 return {...base,revision:split.revision,verified,
  hikari:split.hikari,air:split.air,
  // The original split is available for an explicit re-check, but never
  // silently used as a confirmed ranking if a source entry was edited.
  unclassified:verified?0:source.total};
}
function makePartnerInternetSplitOperations({db,actor,scope,collection,fail,
 FieldValue,validDate,canStaff}={}){
 if(!db||!actor||!scope||!collection||!fail||!FieldValue||!validDate||!canStaff)
  throw Error("PARTNER_INTERNET_SPLIT_DEPS_INVALID");
 const entries=(cid)=>collection(cid,"partnerWorkEntries");
 const splits=(cid)=>collection(cid,"partnerInternetSplits");
 const audits=(cid)=>collection(cid,"partnerInternetSplitAudits");
 async function verifiedCompany(request,partnerCompanyId){
  const a=await actor(request),d=request?.data||{};
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind==="partner"){
   if(partnerCompanyId!=null)fail("invalid-argument");
   return {actor:a,scope:s,cid:s.cid,hubId:s.hubId};
  }
  if(s.kind!=="hub"||s.role!=="owner"||!ID.test(partnerCompanyId||""))
   fail();
  const [relation,company]=await Promise.all([
   db.collection("partnerRelations").doc(partnerCompanyId).get(),
   db.collection("companies").doc(partnerCompanyId).get()
  ]);
  const r=relation.data()||{},c=company.data()||{};
  if(!relation.exists||!company.exists||
     r.partnerCompanyId!==partnerCompanyId||r.hubCompanyId!==s.cid||
     r.active!==true||r.countSharingApproved!==true||
     c.companyKind!=="partner"||c.hubCompanyId!==s.cid||c.active!==true)
   fail();
  return {actor:a,scope:s,cid:partnerCompanyId,hubId:s.cid};
 }
 async function viewInternetSplitDay(request){
  const d=request?.data||{},date=validDate(d.date);
  if(Object.keys(d).some(k=>!["date","partnerCompanyId","workspaceCompanyId",
    "codeSessionToken"].includes(k)))fail("invalid-argument");
  const who=await verifiedCompany(request,d.partnerCompanyId);
  const [sourceDocs,splitDocs]=await Promise.all([
   entries(who.cid).where("date","==",date).limit(201).get(),
   splits(who.cid).where("date","==",date).limit(201).get()
  ]);
  if(sourceDocs.size>200||splitDocs.size>200)fail("resource-exhausted");
  const saved=new Map();
  for(const sn of splitDocs.docs){
   const x=sn.data()||{},id=x.staffId;
   if(!ID.test(id||"")||sn.id!==date+"__"+id||saved.has(id))fail("data-loss");
   let parsed;
   try{parsed=readSplit(x,{cid:who.cid,hubId:who.hubId,date,staffId:id});}
   catch{fail("data-loss");}
   saved.set(id,parsed);
  }
  const result=[];
  const seen=new Set();
  for(const sn of sourceDocs.docs){
   const row=sn.data()||{},staffId=row.staffId;
   if(!ID.test(staffId||"")||sn.id!==date+"__"+staffId||seen.has(staffId))
    fail("data-loss");
   seen.add(staffId);
   // An ordinary partner Member can see only their own entry.
   if(who.scope.kind==="partner"&&who.scope.role==="member"&&
      staffId!==who.actor.uid)continue;
   let source;
   try{source=validateSource(row,{cid:who.cid,hubId:who.hubId,date,staffId});}
   catch{fail("data-loss");}
   const person=typeof row.staffNameSnapshot==="string"&&
      row.staffNameSnapshot.trim().length<=60?
      row.staffNameSnapshot.trim():"過去の担当者";
   result.push({staffId,staffName:person,
    ...projectSplit(source,saved.get(staffId)||null)});
  }
  if([...saved.keys()].some(staffId=>!seen.has(staffId)))
   fail("data-loss"); // No unanchored classification is acceptable.
  return {scope:"partner_internet_split_counts_only",date,
   partnerCompanyId:who.cid,records:result,financialFieldsIncluded:false};
 }
 // On-demand month projection for the HQ Owner. No saved counts are rewritten.
 // An old combined count remains in "unclassified" until a person verifies both pieces.
 async function viewInternetSplitMonth(request){
  const d=request?.data||{};
  if(Object.keys(d).some(k=>!["month","partnerCompanyId","workspaceCompanyId",
    "codeSessionToken"].includes(k)))fail("invalid-argument");
  const who=await verifiedCompany(request,d.partnerCompanyId);
  const today=new Intl.DateTimeFormat("en-CA",{
   timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(Date.now());
  let bounds;
  try{bounds=monthBounds(d.month,today);}catch{fail("invalid-argument");}
  const [sourceDocs,splitDocs]=await Promise.all([
   entries(who.cid).where("date",">=",bounds.first).where("date","<=",bounds.last)
    .limit(1001).get(),
   splits(who.cid).where("date",">=",bounds.first).where("date","<=",bounds.last)
    .limit(1001).get()
  ]);
  if(sourceDocs.size>1000||splitDocs.size>1000)fail("resource-exhausted");
  const byId=new Map();
  for(const sn of splitDocs.docs){
   const row=sn.data()||{},id=row.date+"__"+row.staffId;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date||"")||
      !ID.test(row.staffId||"")||sn.id!==id||byId.has(id)||
      row.date<bounds.first||row.date>bounds.last)fail("data-loss");
   let parsed;
   try{parsed=readSplit(row,{cid:who.cid,hubId:who.hubId,
    date:row.date,staffId:row.staffId});}catch{fail("data-loss");}
   byId.set(id,parsed);
  }
  const people=new Map();
  let total=0,hikari=0,air=0,unclassified=0,sourceRows=0,classifiedRows=0;
  const seen=new Set();
  for(const sn of sourceDocs.docs){
   const row=sn.data()||{},staffId=row.staffId,date=row.date,
    key=date+"__"+staffId;
   if(!ID.test(staffId||"")||sn.id!==key||seen.has(key)||
      typeof date!=="string"||date<bounds.first||date>bounds.last)
    fail("data-loss");
   seen.add(key);
   if(who.scope.kind==="partner"&&who.scope.role==="member"&&
      staffId!==who.actor.uid)continue;
   let src;
   try{src=validateSource(row,{cid:who.cid,hubId:who.hubId,date,staffId});}
   catch{fail("data-loss");}
   const v=projectSplit(src,byId.get(key)||null);
   const vh=v.verified?v.hikari:0,va=v.verified?v.air:0;
   total+=v.total;hikari+=vh;air+=va;unclassified+=v.unclassified;
   sourceRows++;if(v.verified)classifiedRows++;
   if(![total,hikari,air,unclassified].every(Number.isSafeInteger))fail("data-loss");
   let person=people.get(staffId);
   if(!person){
    const candidate=row.staffNameSnapshot;
    const label=typeof candidate==="string"&&
      /^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u.test(candidate)&&
      !/(?:単価|売上|利益|報酬|[¥￥$€]|\d[\d,]*円)/.test(candidate)?
      candidate:"当時の氏名未確認";
    person={staffId,name:label,combined:0,hikari:0,air:0,unclassified:0};
    people.set(staffId,person);
   }
   person.combined+=v.total;person.hikari+=vh;person.air+=va;
   person.unclassified+=v.unclassified;
  }
  if(total!==hikari+air+unclassified||[...byId.keys()].some(id=>!seen.has(id)))
   fail("data-loss");
  return {scope:"partner_internet_split_month_counts_only",
   month:d.month,partnerCompanyId:who.cid,combinedTotal:total,
   verifiedHikari:hikari,verifiedAir:air,unclassified,
   sourceRows,classifiedRows,people:[...people.values()].sort((a,b)=>
    b.unclassified-a.unclassified||a.name.localeCompare(b.name,"ja")),
   financialFieldsIncluded:false,productionDocumentWrites:0};
 }
 async function submitInternetSplit(request){
  const d=request?.data||{},date=validDate(d.date),staffId=d.staffId;
  if(Object.keys(d).sort().join("|")!==
     ["air","date","expectedRevision","hikari","sourceVersion","staffId",
      ...(d.workspaceCompanyId!==undefined?["workspaceCompanyId"]:[]),
      ...(d.codeSessionToken!==undefined?["codeSessionToken"]:[])].sort().join("|")||
     !ID.test(staffId||"")||!safeInt(d.hikari)||!safeInt(d.air)||
     !Number.isSafeInteger(d.sourceVersion)||d.sourceVersion<1||
     !Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0||
     d.expectedRevision>=999)fail("invalid-argument");
  const actorInfo=await actor(request);
  const s=await scope(actorInfo.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner")fail();
  return db.runTransaction(async tx=>{
   const live=await scope(actorInfo.uid,tx,d.workspaceCompanyId);
   if(live.kind!=="partner"||live.cid!==s.cid||live.hubId!==s.hubId)
    fail();
   const sr=entries(s.cid).doc(date+"__"+staffId);
   const dr=splits(s.cid).doc(date+"__"+staffId);
   const staff=collection(s.cid,"partnerWorkStaff").doc(staffId);
   const [sourceSnap,splitSnap,staffSnap]=await Promise.all([
    tx.get(sr),tx.get(dr),tx.get(staff)
   ]);
   if(!sourceSnap.exists)fail("failed-precondition");
   if(live.role==="member"){
    const person=staffSnap.data()||{};
    if(!staffSnap.exists||person.active!==true||
       person.companyId!==s.cid||!canStaff(live,person))fail();
   }else if(!["owner","leader"].includes(live.role))fail();
   let current,previous;
   try{
    current=validateSource(sourceSnap.data(),{
     cid:s.cid,hubId:s.hubId,date,staffId});
    previous=readSplit(splitSnap.exists?splitSnap.data():null,{
     cid:s.cid,hubId:s.hubId,date,staffId});
   }catch{fail("data-loss");}
   if(current.sourceVersion!==d.sourceVersion||
      d.hikari+d.air!==current.total)fail("failed-precondition");
   if(d.expectedRevision!==(previous?.revision??0))fail("aborted");
   if(previous&&previous.sourceVersion===current.sourceVersion&&
      previous.hikari===d.hikari&&previous.air===d.air)
    return {saved:false,unchanged:true,staffId,date,
     revision:previous.revision,verified:true};
   const revision=(previous?.revision??0)+1;
   const data={companyId:s.cid,hubCompanyId:s.hubId,date,staffId,
    hikari:d.hikari,air:d.air,combinedCount:current.total,
    sourceVersion:current.sourceVersion,revision,updatedByUid:actorInfo.uid,
    updatedAt:FieldValue.serverTimestamp()};
   if(splitSnap.exists)tx.update(dr,data);
   else tx.create(dr,{...data,createdAt:FieldValue.serverTimestamp()});
   const ar=audits(s.cid).doc(date+"__"+staffId+"__v"+revision);
   tx.create(ar,{...data,previousHikari:previous?.hikari??null,
    previousAir:previous?.air??null,previousRevision:previous?.revision??0,
    createdAt:FieldValue.serverTimestamp()});
   return {saved:true,staffId,date,revision,verified:true,
    hikari:d.hikari,air:d.air,combinedCount:current.total};
  });
 }
 return Object.freeze({viewInternetSplitDay,viewInternetSplitMonth,submitInternetSplit});
}
module.exports={makePartnerInternetSplitOperations,validateSource,readSplit,projectSplit};
