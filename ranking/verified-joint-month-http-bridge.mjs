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
const PRODUCT_ID=/^[A-Za-z0-9_:-]{1,300}$/;
const FILTER_KEYS=["companyId","teamId","uid","productId"];
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const stop=()=>{throw Error("VERIFIED_JOINT_COUNT_MONTH_BRIDGE_BLOCKED");};
const goodDay=d=>{
 if(typeof d!=="string"||!DATE.test(d))return false;
 const [y,m,day]=d.split("-").map(Number);
 const x=new Date(0);x.setUTCHours(0,0,0,0);x.setUTCFullYear(y,m-1,day);
 return x.getUTCFullYear()===y&&x.getUTCMonth()+1===m&&x.getUTCDate()===day;
};

// Date-only query. The server owns every count and consent; this guard only
// prevents a calendar selection from requesting a partial cross-month week.
const dateAt=(value,days=0)=>{
 if(!goodDay(value))stop();
 const d=new Date(value+"T12:00:00Z");
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
};
const weekStart=value=>dateAt(value,-((new Date(value+"T12:00:00Z").getUTCDay()+6)%7));
const monthEnd=value=>{
 const m=new Date(value.slice(0,7)+"-01T12:00:00Z");
 m.setUTCMonth(m.getUTCMonth()+1);m.setUTCDate(0);
 return m.toISOString().slice(0,10);
};
function expectedRange(period){
 if(!["month","day","week"].includes(period.kind)||!goodDay(period.day)||
    !goodDay(period.asOf)||period.day>period.asOf)stop();
 const month=period.day.slice(0,7);
 const start=period.kind==="month"?month+"-01":
  period.kind==="week"?weekStart(period.day):period.day;
 const last=period.kind==="month"?monthEnd(period.day):
  period.kind==="week"?dateAt(start,6):period.day;
 // Only the trusted backend may approve a cross-month week after reading
 // both complete monthly inventories under the same atomic transaction.
 if(period.kind!=="week"&&
    (start.slice(0,7)!==month||last.slice(0,7)!==month))stop();
 const end=last<period.asOf?last:period.asOf;
 if(end<start)stop();
 return {start,end};
}

export function createVerifiedJointMonthHttpBridge({
 featureEnabled=false,auth,fetcher,endpoint=ORIGIN+"/v1/owner-visible-counts",
 expectedRole=null
}={}){
 if(expectedRole!==null&&!["hub_owner","partner_owner"].includes(expectedRole))stop();
 if(featureEnabled!==true||!auth||typeof fetcher!=="function"||
    !ENDPOINTS.has(endpoint))stop();
 let generation=0;
 async function load({period,filters,scope}={}){
  if(scope!==undefined&&!["joint","own","partner"].includes(scope))stop();
  if(!period||Object.keys(period).sort().join("|")!=="asOf|day|kind"||
     !filters||typeof filters!=="object"||Array.isArray(filters)||
     Object.keys(filters).some(k=>!FILTER_KEYS.includes(k)))stop();
  const used=FILTER_KEYS.filter(k=>Object.prototype.hasOwnProperty.call(filters,k));
  if(used.length>4||used.some(k=>
    typeof filters[k]!=="string"||
    !(k==="productId"?PRODUCT_ID:ID).test(filters[k]))||
    ((filters.teamId||filters.uid)&&!filters.companyId)||
    (expectedRole==="partner_owner"&&used.length>0))stop();
  const range=expectedRange(period);
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
   const query=period.kind==="month"?"month="+month:
    period.kind+"="+period.day;
   const selected=used.map(k=>"&"+k+"="+encodeURIComponent(filters[k])).join("");
   const selectedScope=scope===undefined?"":"&scope="+scope;
   const url=endpoint+"?"+query+selected+selectedScope;
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
      (expectedRole!==null&&value.role!==expectedRole)||
      value.period!==period.kind||value.unit!=="件"||
      value.range?.start!==range.start||value.range.end!==range.end)stop();
   if(scope!==undefined?value.scope!==scope:
      value.scope!==undefined&&value.scope!=="joint")stop();
   // A successfully authenticated answer for another company's scope must
   // never be rendered as the currently selected owner's filtered ranking.
   if(used.length>0&&value.role!=="hub_owner")stop();
   if(value.role==="hub_owner"&&
      (!value.filters||typeof value.filters!=="object"||
       Array.isArray(value.filters)||
       Object.keys(value.filters).some(k=>!FILTER_KEYS.includes(k))||
       FILTER_KEYS.some(k=>value.filters[k]!==filters[k])))stop();
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
  availablePeriods:["day","week","month"],
  allowFilters:expectedRole==="hub_owner"
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
