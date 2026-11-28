/**
 * STAGING / NO DEPLOY — one authenticated, server-owned monthly count GET
 * from the existing joint ranking endpoint. Not a Firestore reader.
 * No Finance API, local cache, impersonation, browser role claims or writes.
 * A disabled call MUST NOT reach fetch or Firebase Auth.
 */
import {createVerifiedDualCountController} from "./verified-dual-count-view.mjs";
const ORIGIN="https://nico-factory.web.app";
const ENDPOINTS=new Set([
 ORIGIN+"/v1/owner-visible-counts",
 "https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking"
]);
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const stop=()=>{throw Error("VERIFIED_JOINT_COUNT_MONTH_BRIDGE_BLOCKED");};
const goodDay=d=>{
 if(typeof d!=="string"||!DATE.test(d))return false;
 const [y,m,day]=d.split("-").map(Number);
 const x=new Date(0);x.setUTCHours(0,0,0,0);x.setUTCFullYear(y,m-1,day);
 return x.getUTCFullYear()===y&&x.getUTCMonth()+1===m&&x.getUTCDate()===day;
};
const shifted=(day,offset)=>{
 if(!goodDay(day))stop();
 const d=new Date(day+"T12:00:00Z");
 d.setUTCDate(d.getUTCDate()+offset);
 return d.toISOString().slice(0,10);
};
export const getVerifiedJointCountWindow=period=>{
 if(!period||Object.keys(period).sort().join("|")!=="asOf|day|kind"||
    !["month","day","week"].includes(period.kind)||
    !goodDay(period.day)||!goodDay(period.asOf)||
    period.day>period.asOf)stop();
 const day=period.day,month=day.slice(0,7);
 const start=period.kind==="month"?month+"-01":
  period.kind==="week"?shifted(day,-((new Date(day+"T12:00:00Z").getUTCDay()+6)%7)):day;
 const last=period.kind==="month"?shifted(
  shifted(month+"-01",32).slice(0,7)+"-01",-1):
  period.kind==="week"?shifted(start,6):day;
 const end=last<period.asOf?last:period.asOf;
 if(end<start)stop();
 return {start,end};
};
export function createVerifiedJointMonthHttpBridge({
 featureEnabled=false,auth,fetcher,endpoint=ORIGIN+"/v1/owner-visible-counts",
 expectedRole=null,getCodeSession=()=>"",getWorkspaceCompanyId=()=>""
}={}){
 if(featureEnabled!==true||!auth||typeof fetcher!=="function"||
    typeof getCodeSession!=="function"||typeof getWorkspaceCompanyId!=="function"||
    !ENDPOINTS.has(endpoint)||
    (expectedRole!==null&&!["hub_owner","partner_owner"].includes(expectedRole)))stop();
 let generation=0;
 async function load({period,filters}={}){
  const window=getVerifiedJointCountWindow(period);
  if(!filters||typeof filters!=="object"||Array.isArray(filters)||
     Object.keys(filters).some(k=>k!=="scope")||
     (filters.scope!==undefined&&!["joint","direct","partner"].includes(filters.scope)))stop();
  const month=period.day.slice(0,7),seq=++generation;
  const identity=auth.currentUser;
  const codeSession=getCodeSession(),workspaceCompanyId=getWorkspaceCompanyId();
  if(typeof codeSession!=="string"||typeof workspaceCompanyId!=="string"||
     (workspaceCompanyId!==""&&!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceCompanyId))||
     (codeSession!==""&&(!/^[A-Za-z0-9_-]{43}$/.test(codeSession)||workspaceCompanyId!=="")))stop();
  if(!codeSession&&(!identity||typeof identity.uid!=="string"||!ID.test(identity.uid)||
     identity.emailVerified!==true||typeof identity.getIdToken!=="function"))
   stop();
  const sameIdentity=()=>seq===generation&&identity===auth.currentUser&&
   codeSession===getCodeSession()&&workspaceCompanyId===getWorkspaceCompanyId();
  let token,response,raw,value;
  try{
   token=codeSession||await identity.getIdToken();
   if(typeof token!=="string"||!/^[-A-Za-z0-9._]{20,12000}$/.test(token)||
      !sameIdentity())stop();
   const query=period.kind==="month"?"month="+month:
    period.kind+"="+period.day;
   const url=endpoint+"?"+query+(filters.scope&&filters.scope!=="joint"?
    "&scope="+filters.scope:"")+(workspaceCompanyId?
    "&workspaceCompanyId="+encodeURIComponent(workspaceCompanyId):"");
   response=await fetcher(url,{
    method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},
    cache:"no-store",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer"
   });
   if(!sameIdentity()||
      !response||response.status!==200||
      typeof response.text!=="function"||
      !/application\/json/i.test(response.headers?.get?.("Content-Type")||""))
    stop();
   raw=await response.text();
   if(typeof raw!=="string"||raw.length>900000)stop();
   value=JSON.parse(raw);
   if(!sameIdentity()||
      !value||value.schema!=="nico-verified-dual-count-v1"||
      !["hub_owner","partner_owner"].includes(value.role)||
      value.period!==period.kind||value.unit!=="件"||
      (expectedRole!==null&&value.role!==expectedRole)||
      (value.role==="hub_owner"&&
       (value.filters?.scope??"joint")!==(filters.scope??"joint"))||
      !goodDay(value.range?.start)||value.range.start!==window.start||
      !goodDay(value.range?.end)||value.range.end!==window.end)stop();
   return value; // existing DOM renderer strictly rejects all finance keys
  }catch{stop()}
 }
 return Object.freeze({load,onAuthChange(){generation++}});
}
/**
 * Optional shared mount into either owner dashboard. NO initial mount when OFF.
 * Only the real server GET can populate it. All day/week/month periods are
 * resolved by the same backend, including cross-month weeks that require TWO
 * same-snapshot monthly inventory reads. No browser-side count computation.
 */
export function mountVerifiedJointMonthCountDashboard({
 featureEnabled=false,document,root,auth,fetcher,endpoint,asOf,
 onAuthStateChanged,expectedRole=null
}={}){
 if(featureEnabled!==true||!document?.createElement||
    !root?.replaceChildren||!goodDay(asOf)||
    typeof onAuthStateChanged!=="function")stop();
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled,auth,fetcher,endpoint,expectedRole
 });
 const controller=createVerifiedDualCountController({
  document,root,auth,load:bridge.load,asOf,
  availablePeriods:["day","week","month"],allowFilters:false
 });
 let closed=false,off=()=>{};
 try{
  const callback=onAuthStateChanged(auth,user=>{
   if(closed)return;
   bridge.onAuthChange();controller.onAuthChange();
   if(user&&auth.currentUser===user&&user.emailVerified===true)
    void controller.refresh();
  });
  if(typeof callback!=="function")stop();
  off=callback;
 }catch{controller.destroy();bridge.onAuthChange();throw Error("VERIFIED_JOINT_COUNT_MOUNT_BLOCKED")}
 return Object.freeze({
  refresh(){return closed?Promise.resolve(false):controller.refresh()},
  destroy(){
   if(closed)return;closed=true;off();
   bridge.onAuthChange();controller.destroy();
  }
 });
}
