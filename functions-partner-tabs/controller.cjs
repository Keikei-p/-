"use strict";
/**
 * STAGING / NO DEPLOY. Dedicated Hub Owner publication read/write and
 * partner read-only API. Default disabled even if code is packaged.
 * Revoked tokens, authenticated identity and Firestore membership rechecked.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const SCHEMA="nico-partner-tabs-v1";
const CODE_SESSION=/^[A-Za-z0-9_-]{43}$/;
const TABS=["product","team","individual","detail","report","daily","history","goal"];
const allowed=new Set(TABS);
const exact=(value,keys)=>!!value&&typeof value==="object"&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&
 Object.keys(value).every(k=>keys.includes(k));
const valid=v=>Number.isSafeInteger(v)&&v>=0&&v<=999999;
const safeTabs=v=>Array.isArray(v)&&v.length<=8&&
 v.every(x=>typeof x==="string"&&allowed.has(x))&&new Set(v).size===v.length;
function makePartnerTabPublicationCallables({
 db,FieldValue,getAuth,HttpsError,enabled=()=>false,
 optionalDataEnabled=()=>false,
 modules=()=>Promise.all([
  import("./trusted-token-reader.mjs"),
  import("./partner-tab-publication-store.mjs"),
  import("./partner-optional-tab-reader.mjs")
 ])
}={}) {
 if(!db?.runTransaction||typeof FieldValue?.serverTimestamp!=="function"||
    typeof getAuth!=="function"||typeof HttpsError!=="function"||
    typeof enabled!=="function"||typeof optionalDataEnabled!=="function"||
    typeof modules!=="function")
   throw Error("PARTNER_TAB_CALLABLE_DEPENDENCIES_MISSING");
 let loaded;
 const imports=()=>loaded??=Promise.resolve().then(()=>modules());
 const fail=(status,message)=>{throw new HttpsError(status,message);};
 const unavailable=()=>fail("failed-precondition","partner_tabs_not_enabled");
 const unauthorized=()=>fail("unauthenticated","partner_tabs_login_required");
 const denied=()=>fail("permission-denied","partner_tabs_not_authorized");
 const invalid=()=>fail("invalid-argument","partner_tabs_invalid_request");

 async function identity(request,keys) {
  // When default-OFF, not even a token or Firestore read may occur.
  if(enabled()!==true)unavailable();
  if(!exact(request?.data,keys))invalid();
  const uid=request?.auth?.uid,token=request?.auth?.token;
  if(typeof uid!=="string"||!ID.test(uid)||
     token?.email_verified!==true||typeof token.email!=="string")unauthorized();
  const header=request?.rawRequest?.headers?.authorization;
  const bearer=typeof header==="string"?
   header.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1]:null;
  if(!bearer)unauthorized();
  let actor;
  try {
   const [trusted]=await imports();
   actor=await trusted.createVerifiedRankTokenReader({auth:getAuth()})(bearer);
  }catch{unauthorized();}
  if(actor.uid!==uid||actor.emailVerified!==true||
     actor.email!==token.email.trim().toLowerCase())unauthorized();
  return actor;
 }

 function confirm(raw) {
  if(!exact(raw,["schema","revision","published","tabs"])||
     raw.schema!==SCHEMA||!valid(raw.revision)||
     typeof raw.published!=="boolean"||!safeTabs(raw.tabs)||
     (!raw.published&&raw.tabs.length!==0)||
     TABS.filter(k=>raw.tabs.includes(k)).join("|")!==raw.tabs.join("|"))
    denied();
  return {schema:SCHEMA,revision:raw.revision,
   published:raw.published,tabs:[...raw.tabs]};
 }
 const loadOwner=async request=>{
  const actor=await identity(request,[]);
  try{
   const [,store]=await imports();
   const res=await store.createPartnerTabPublicationStore({db,FieldValue}).readOwner(actor);
   return confirm(res);
  }catch{denied();}
 };
 const loadPartner=async request=>{
  // The existing code login uses a distinct opaque session. Never require
  // a fabricated Firebase ID token or silently reinterpret it as email auth.
  const d=request?.data;
  const codeMode=d&&Object.hasOwn(d,"codeSessionToken");
  if(codeMode){
   if(enabled()!==true)unavailable();
   if(!exact(d,["codeSessionToken"])||
      typeof d.codeSessionToken!=="string"||
      !CODE_SESSION.test(d.codeSessionToken))invalid();
   if(request?.auth?.uid)unauthorized();
   try{
    const [,store]=await imports();
    const result=await store.createPartnerTabPublicationStore({db,FieldValue})
     .readPartnerCodeSession(d.codeSessionToken);
    return confirm(result);
   }catch{denied();}
  }
  // An existing authenticated account can select ONLY a server-verified
  // secondary partner workspace. Other caller-supplied fields are forbidden.
  const keys=d&&Object.hasOwn(d,"workspaceCompanyId")?
   ["workspaceCompanyId"]:[];
  const actor=await identity(request,keys);
  if(keys.length&&(!ID.test(d.workspaceCompanyId)||
     ["__proto__","constructor","prototype"].includes(d.workspaceCompanyId)))
   invalid();
  try{
   const [,store]=await imports();
   const res=await store.createPartnerTabPublicationStore({db,FieldValue})
    .readPartner(actor,keys.length?d.workspaceCompanyId:"");
   return confirm(res);
  }catch{denied();}
 };
 const loadOptional=async request=>{
  // An independently reviewed feature flag disables ALL optional read paths
  // before token verification or any datastore access.
  if(optionalDataEnabled()!==true)unavailable();
  const d=request?.data;
  const codeMode=d&&Object.hasOwn(d,"codeSessionToken");
  const keys=["tab","date",...(codeMode?["codeSessionToken"]:
   (d&&Object.hasOwn(d,"workspaceCompanyId")?["workspaceCompanyId"]:[]))];
  // Disallow mixed Firebase and code-session proof and any extra company hint.
  if(codeMode){
   if(enabled()!==true)unavailable();
   if(!exact(d,keys)||typeof d.codeSessionToken!=="string"||
      !CODE_SESSION.test(d.codeSessionToken))invalid();
   if(request?.auth?.uid)unauthorized();
  }
  const actor=codeMode?undefined:await identity(request,keys);
  if(!["report","daily","history","goal"].includes(d.tab)||
     typeof d.date!=="string"||
     !/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(d.date)||
     !Number.isFinite(Date.parse(d.date+"T00:00:00Z"))||
     new Date(d.date+"T00:00:00Z").toISOString().slice(0,10)!==d.date||
     (keys.includes("workspaceCompanyId")&&
      (!ID.test(d.workspaceCompanyId)||[
       "__proto__","constructor","prototype"].includes(d.workspaceCompanyId))))
   invalid();
  try{
   const [,store,readModule]=await imports();
   if(typeof readModule?.readPublishedPartnerOptionalTab!=="function")denied();
   const out=await store.createPartnerTabPublicationStore({db,FieldValue})
    .readPublishedOptional({
     ...(codeMode?{codeSessionToken:d.codeSessionToken}:{actor,
      workspaceCompanyId:d.workspaceCompanyId||""}),
     tab:d.tab,date:d.date,
     reader:readModule.readPublishedPartnerOptionalTab
    });
   const common=["schema","tab","date","companyName","reportStatus",
    "totalCount","reportedStaffCount"];
   const props={
    report:["lines"],daily:["products"],history:["audits"],goal:["actualCount"]
   }[d.tab];
   const individual=out?.schema==="nico-published-partner-optional-v2";
   if(!exact(out,[...common,...props,...(individual?["categories"]:[])])||
      !["nico-published-partner-optional-v1","nico-published-partner-optional-v2"].includes(out.schema)||
      (individual&&(!Array.isArray(out.categories)||out.categories.length>1009))||
      out.tab!==d.tab||out.date!==d.date||
      typeof out.companyName!=="string"||
      !["未報告","確定0件","報告済"].includes(out.reportStatus)||
      !Number.isSafeInteger(out.totalCount)||out.totalCount<0||
      !Number.isSafeInteger(out.reportedStaffCount)||out.reportedStaffCount<0)
     denied();
   return out;
  }catch{denied();}
 };
 const saveOwner=async request=>{
  const actor=await identity(request,["expectedRevision","published","tabs"]);
  const d=request.data;
  if(!valid(d.expectedRevision)||d.expectedRevision>=999999||
     typeof d.published!=="boolean"||!safeTabs(d.tabs))invalid();
  try{
   const [,store]=await imports();
   const out=await store.createPartnerTabPublicationStore({db,FieldValue})
    .saveOwner({actor,expectedRevision:d.expectedRevision,
      published:d.published,selectedTabs:d.tabs});
   if(!exact(out,["saved","schema","revision","published","tabs"])||
      typeof out.saved!=="boolean"||
      out.revision!==d.expectedRevision+(out.saved?1:0)||
      out.published!==d.published)denied();
   return {saved:out.saved,...confirm({
    schema:out.schema,revision:out.revision,published:out.published,tabs:out.tabs
   })};
  }catch{denied();}
 };
 return Object.freeze({loadOwner,loadPartner,loadOptional,saveOwner});
}
module.exports={makePartnerTabPublicationCallables};
