"use strict";
/**
 * Emergency isolated count reporting: only a partner-company owner can submit,
 * only their linked hub owner can see the daily partner summaries.
 * No finance originals, price products, employee records or history are read or written.
 * The complete audit log is append-only. This service does NOT enable the
 * earlier partnerCount* API, nor change any shared ranking or finance rules.
 */
const crypto=require("node:crypto");
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const BLOCKED_LABEL=/(?:[¥￥$€]|単価|売上|収益|報酬|利益|\d[\d,]*円)/;
const clean=x=>typeof x==="string"?x.trim():"";
const fail=(ErrorType,code="permission-denied")=>{throw new ErrorType(code,"件数報告の権限または入力内容を確認できません。");};
function validDate(value,now){
 if(typeof value!=="string"||!DATE.test(value))return false;
 const timestamp=Date.parse(value+"T00:00:00.000Z");
 if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==value)return false;
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now()));
 const todayTimestamp=Date.parse(today+"T00:00:00.000Z");
 return timestamp<=todayTimestamp&&timestamp>=todayTimestamp-31*86400000;
}
function validateCounts(input,ErrorType){
 if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).sort().join("|")!==[...KEYS].sort().join("|"))fail(ErrorType,"invalid-argument");
 const counts={};let total=0;
 for(const key of KEYS){
  const value=input[key];
  if(!Number.isInteger(value)||value<0||value>9999)fail(ErrorType,"invalid-argument");
  total+=value;counts[key]=value;
 }
 return {counts,total};
}
function makeQuickCounts({db,getAuth,FieldValue,HttpsError,enabled,now=()=>Date.now()}={}){
 if(!db||typeof getAuth!=="function"||!FieldValue||!HttpsError||typeof enabled!=="function"||typeof now!=="function")throw Error("quick_count_configuration_invalid");
 async function caller(request){
  if(enabled()!==true)fail(HttpsError,"unavailable");
  const uid=request?.auth?.uid;
  const email=clean(request?.auth?.token?.email).toLowerCase();
  if(!ID.test(uid||"")||!EMAIL.test(email)||request?.auth?.token?.email_verified!==true)fail(HttpsError,"unauthenticated");
  const bearer=request?.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail(HttpsError,"unauthenticated");
  let auth,verified;
  try{[auth,verified]=await Promise.all([getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)]);}catch{fail(HttpsError,"unauthenticated");}
  if(!auth||auth.disabled!==false||auth.emailVerified!==true||
     clean(auth.email).toLowerCase()!==email||verified.uid!==uid||
     verified.email_verified!==true||clean(verified.email).toLowerCase()!==email)fail(HttpsError,"unauthenticated");
  return uid;
 }
 async function identity(tx,uid){
  const userSnap=await tx.get(db.collection("users").doc(uid));
  const user=userSnap.data()||{};
  if(!userSnap.exists||user.uid!==uid||!ID.test(user.companyId||"")||user.active!==true)fail(HttpsError);
  const companyRef=db.collection("companies").doc(user.companyId);
  const memberRef=companyRef.collection("members").doc(uid);
  const [companySnap,memberSnap]=await Promise.all([tx.get(companyRef),tx.get(memberRef)]);
  const company=companySnap.data()||{},member=memberSnap.data()||{};
  if(!companySnap.exists||!memberSnap.exists||company.active!==true||member.active!==true||
     member.uid!==uid||member.companyId!==user.companyId||
     company.ownerUid!==uid||user.companyRole!=="owner"||member.companyRole!=="owner")fail(HttpsError);
  if(company.companyKind==="partner"){
   if(user.accessKind!=="partner"||member.accessKind!=="partner"||
      user.memberType!=="cooperator"||member.memberType!=="cooperator"||
      user.canViewRevenue!==false||member.canViewRevenue!==false||
      user.canViewUnitPrice!==false||member.canViewUnitPrice!==false||
      !ID.test(company.hubCompanyId||"")||company.hubCompanyId===user.companyId)fail(HttpsError);
   const relationSnap=await tx.get(db.collection("partnerRelations").doc(user.companyId));
   const rel=relationSnap.data()||{};
   if(!relationSnap.exists||rel.partnerCompanyId!==user.companyId||rel.hubCompanyId!==company.hubCompanyId)fail(HttpsError);
   const hubSnap=await tx.get(db.collection("companies").doc(company.hubCompanyId));
   const hub=hubSnap.data()||{};
   if(!hubSnap.exists||hub.active!==true||hub.ownerUid==null||
      ![undefined,"internal","direct"].includes(hub.companyKind))fail(HttpsError);
   return {role:"partner",partnerId:user.companyId,hubId:company.hubCompanyId,
     companyName:clean(company.name).slice(0,80)};
  }
  if(company.companyKind!=null&&!['internal','direct'].includes(company.companyKind)||
     user.accessKind==="partner"||member.accessKind==="partner"||
     user.memberType==="cooperator"||member.memberType==="cooperator")fail(HttpsError);
  return {role:"hub",hubId:user.companyId};
 }
 const reportRef=(hubId,date,partnerId)=>db.collection("companies").doc(hubId)
  .collection("partnerQuickCountDays").doc(date).collection("reports").doc(partnerId);
 async function submit(request){
  const uid=await caller(request);
  const input=request?.data;
  if(!input||typeof input!=="object"||Array.isArray(input)||
     Object.keys(input).sort().join("|")!==["counts","date","expectedVersion"].sort().join("|")||
     !validDate(input.date,now)||!Number.isSafeInteger(input.expectedVersion)||
     input.expectedVersion<0)fail(HttpsError,"invalid-argument");
  const {counts,total}=validateCounts(input.counts,HttpsError);
  return db.runTransaction(async tx=>{
   const scope=await identity(tx,uid);
   if(scope.role!=="partner")fail(HttpsError);
   const ref=reportRef(scope.hubId,input.date,scope.partnerId);
   const previousSnap=await tx.get(ref);
   const previous=previousSnap.data()||{};
   const oldVersion=previousSnap.exists?previous.version:0;
   if(!Number.isSafeInteger(oldVersion)||oldVersion<0||oldVersion!==input.expectedVersion)
     fail(HttpsError,"aborted");
   if(oldVersion>=999)fail(HttpsError,"resource-exhausted");
   const version=oldVersion+1;
   const auditId=crypto.createHash("sha256").update([scope.hubId,input.date,scope.partnerId].join("|")).digest("hex")+"_v"+version;
   const log=db.collection("partnerQuickCountAudits").doc(auditId);
   const time=FieldValue.serverTimestamp();
   if(!scope.companyName||BLOCKED_LABEL.test(scope.companyName))fail(HttpsError);
   const data={hubCompanyId:scope.hubId,partnerCompanyId:scope.partnerId,
    partnerCompanyName:scope.companyName,date:input.date,counts,totalCount:total,
    version,updatedByUid:uid,updatedAt:time};
   if(previousSnap.exists)tx.update(ref,data);else tx.create(ref,{...data,createdAt:time});
   tx.create(log,{...data,previousVersion:oldVersion,createdAt:time});
   return {saved:true,version,date:input.date,totalCount:total};
  });
 }
 async function view(request){
  const uid=await caller(request);
  const input=request?.data;
  if(!input||typeof input!=="object"||Array.isArray(input)||
     Object.keys(input).join("|")!=="date"||!validDate(input.date,now))fail(HttpsError,"invalid-argument");
  const scope=await db.runTransaction(tx=>identity(tx,uid));
  if(scope.role==="partner"){
   const snap=await reportRef(scope.hubId,input.date,scope.partnerId).get();
   const d=snap.data()||{};
   return {role:"partner",date:input.date,report:snap.exists?{
    version:d.version,counts:d.counts,totalCount:d.totalCount}:null};
  }
  const query=await db.collection("companies").doc(scope.hubId)
   .collection("partnerQuickCountDays").doc(input.date).collection("reports").limit(201).get();
  if(query.size>200)fail(HttpsError,"resource-exhausted");
  const rows=[];
  for(const snap of query.docs){
   const d=snap.data()||{};
   if(d.hubCompanyId!==scope.hubId||d.date!==input.date||
      d.partnerCompanyId!==snap.id||!Number.isInteger(d.version)||d.version<1||
      typeof d.partnerCompanyName!=="string"||d.partnerCompanyName.length>80||
      BLOCKED_LABEL.test(d.partnerCompanyName))fail(HttpsError);
   const checked=validateCounts(d.counts,HttpsError);
   if(checked.total!==d.totalCount)fail(HttpsError);
   rows.push({partnerCompanyId:snap.id,name:d.partnerCompanyName,
    counts:checked.counts,totalCount:checked.total,version:d.version});
  }
  rows.sort((a,b)=>a.name.localeCompare(b.name,"ja"));
  return {role:"hub",date:input.date,partners:rows,
   totalCount:rows.reduce((n,r)=>n+r.totalCount,0),
   categories:KEYS};
 }
 return Object.freeze({submit,view});
}
module.exports={makeQuickCounts,KEYS};
