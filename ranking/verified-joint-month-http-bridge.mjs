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
export function createVerifiedJointMonthHttpBridge({
 featureEnabled=false,auth,fetcher,endpoint=ORIGIN+"/v1/owner-visible-counts"
}={}){
 if(featureEnabled!==true||!auth||typeof fetcher!=="function"||
    !ENDPOINTS.has(endpoint))stop();
 let generation=0;
 async function load({period,filters}={}){
  if(!period||Object.keys(period).sort().join("|")!=="asOf|day|kind"||
     period.kind!=="month"||!goodDay(period.day)||!goodDay(period.asOf)||
     period.day>period.asOf||!MONTH.test(period.day.slice(0,7))||
     !filters||typeof filters!=="object"||Array.isArray(filters)||
     Object.keys(filters).length!==0)stop();
  const month=period.day.slice(0,7),seq=++generation;
  const identity=auth.currentUser;
  if(!identity||typeof identity.uid!=="string"||!ID.test(identity.uid)||
     identity.emailVerified!==true||typeof identity.getIdToken!=="function")
   stop();
  let token,response,raw,value;
  try{
   token=await identity.getIdToken();
   if(typeof token!=="string"||!/^[-A-Za-z0-9._]{20,12000}$/.test(token)||
      seq!==generation||identity!==auth.currentUser)stop();
   const url=endpoint+"?month="+month;
   response=await fetcher(url,{
    method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},
    cache:"no-store",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer"
   });
   if(seq!==generation||auth.currentUser!==identity||
      !response||response.status!==200||
      typeof response.text!=="function"||
      !/application\/json/i.test(response.headers?.get?.("Content-Type")||""))
    stop();
   raw=await response.text();
   if(typeof raw!=="string"||raw.length>900000)stop();
   value=JSON.parse(raw);
   if(seq!==generation||identity!==auth.currentUser||
      !value||value.schema!=="nico-verified-dual-count-v1"||
      !["hub_owner","partner_owner"].includes(value.role)||
      value.period!=="month"||value.unit!=="件"||
      !goodDay(value.range?.start)||value.range.start.slice(0,7)!==month||
      !goodDay(value.range?.end)||value.range.end.slice(0,7)!==month||
      value.range.end>period.asOf)stop();
   return value; // existing DOM renderer strictly rejects all finance keys
  }catch{stop()}
 }
 return Object.freeze({load,onAuthChange(){generation++}});
}
/**
 * Optional shared mount into either owner dashboard. NO initial mount when OFF.
 * Only the real server GET can populate it. This intentionally omits filters,
 * daily and weekly modes until the server supports them.
 */
export function mountVerifiedJointMonthCountDashboard({
 featureEnabled=false,document,root,auth,fetcher,endpoint,asOf,
 onAuthStateChanged
}={}){
 if(featureEnabled!==true||!document?.createElement||
    !root?.replaceChildren||!goodDay(asOf)||
    typeof onAuthStateChanged!=="function")stop();
 const bridge=createVerifiedJointMonthHttpBridge({featureEnabled,auth,fetcher,endpoint});
 const controller=createVerifiedDualCountController({
  document,root,auth,load:bridge.load,asOf,availablePeriods:["month"],allowFilters:false
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
