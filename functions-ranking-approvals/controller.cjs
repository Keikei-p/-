"use strict";
/**
 * STAGED ONLY / never deployed by push.
 * Distinct Finance-free callable controller. All Firebase credential checks
 * are repeated server-side; callable claims alone do NOT authorize approval.
 * No imports from legacy workspace or finance functions.
 */
const NAME=/^[A-Za-z0-9_-]{1,128}$/;
const only=(x,keys)=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const generic=(status,code,HttpsError)=>{
 throw new HttpsError(status,code);
};
function makeRankingOwnerCallables({
 db,FieldValue,getAuth,HttpsError,
 enabled=()=>false,
 modules=()=>Promise.all([
  import("./vendor/trusted-combined-ranking-context.mjs"),
  import("./vendor/ranking-owner-consent-status.mjs"),
  import("./vendor/ranking-owner-consent-service.mjs")
 ])
}={}){
 if(!db||typeof db.runTransaction!=="function"||
    !FieldValue||typeof FieldValue.serverTimestamp!=="function"||
    typeof getAuth!=="function"||typeof HttpsError!=="function"||
    typeof enabled!=="function"||typeof modules!=="function")
  throw Error("Ranking server dependencies unavailable");
 let pendingModules;
 const getModules=()=>pendingModules??=(Promise.resolve().then(()=>modules()));
 const unauth=()=>generic("unauthenticated","ranking_owner_auth_required",HttpsError);
 const blocked=()=>generic("permission-denied","ranking_owner_action_denied",HttpsError);
 const unavailable=()=>generic("failed-precondition","ranking_settings_not_enabled",HttpsError);
 const invalid=()=>generic("invalid-argument","ranking_settings_invalid_request",HttpsError);
 async function authorize(request,requestedKeys){
  if(enabled()!==true)unavailable();
  if(!only(request?.data,requestedKeys))invalid();
  if(!NAME.test(request?.auth?.uid||"")||
     request?.auth?.token?.email_verified!==true||
     typeof request?.auth?.token?.email!=="string")unauth();
  // Raw bearer is required: do not trust a caller-supplied UID/email,
  // secondary workspace ID, partner-code token or request body flags.
  const raw=request?.rawRequest?.headers?.authorization;
  const bearer=typeof raw==="string"?
   raw.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1]:null;
  if(!bearer)unauth();
  let principal;
  try{
   const [authModule]=await getModules();
   if(!authModule||
      typeof authModule.createVerifiedRankTokenReader!=="function")blocked();
   principal=await authModule.createVerifiedRankTokenReader({
    auth:getAuth()
   })(bearer);
  }catch{unauth();}
  if(principal.uid!==request.auth.uid||
     principal.email!==request.auth.token.email.trim().toLowerCase())unauth();
  return principal;
 }
 const status=async request=>{
  const principal=await authorize(request,[]);
  try{
   const [,statusModule]=await getModules();
   const result=await statusModule.createOwnerRankingConsentStatusReader({db})(principal);
   // Force exact whitelist; future accidental financial field output is a
   // failure, NOT a property spread into a callable JSON response.
   if(!only(result,["schema","role","partners"])||
      result.schema!=="nico-ranking-owner-consent-v1"||
      !Array.isArray(result.partners)||result.partners.length>100)blocked();
   const seen=new Set();
   const partners=result.partners.map(p=>{
    if(!only(p,["partnerCompanyId","companyName","ownApproved",
     "otherApproved","version","canEdit"])||
     !NAME.test(p.partnerCompanyId||"")||seen.has(p.partnerCompanyId)||
     typeof p.companyName!=="string"||
     typeof p.ownApproved!=="boolean"||
     typeof p.otherApproved!=="boolean"||
     typeof p.canEdit!=="boolean"||
     !Number.isSafeInteger(p.version)||p.version<0||p.version>999)blocked();
    seen.add(p.partnerCompanyId);
    return {
     partnerCompanyId:p.partnerCompanyId,companyName:p.companyName,
     ownApproved:p.ownApproved,otherApproved:p.otherApproved,
     version:p.version,canEdit:p.canEdit
    };
   });
   if(!["hub_owner","partner_owner"].includes(result.role)||
      result.role==="partner_owner"&&partners.length!==1)blocked();
   return {schema:result.schema,role:result.role,partners};
  }catch{blocked();}
 };
 const save=async request=>{
  const principal=await authorize(request,["partnerCompanyId","enable","expectedVersion"]);
  const d=request.data;
  if(!NAME.test(d.partnerCompanyId||"")||
     typeof d.enable!=="boolean"||
     !Number.isSafeInteger(d.expectedVersion)||
     d.expectedVersion<0||d.expectedVersion>998)invalid();
  try{
   const [,,serviceModule]=await getModules();
   const result=await serviceModule.createRankingOwnerConsentService({
    db,FieldValue
   })({
    auth:principal,partnerCompanyId:d.partnerCompanyId,
    enable:d.enable,expectedVersion:d.expectedVersion
   });
   if(!only(result,["saved","partnerCompanyId","enabled","version"])||
      result.partnerCompanyId!==d.partnerCompanyId||
      result.enabled!==d.enable||
      typeof result.saved!=="boolean"||
      !Number.isSafeInteger(result.version)||
      result.version!==(result.saved?d.expectedVersion+1:d.expectedVersion))blocked();
   return {
    saved:result.saved,partnerCompanyId:result.partnerCompanyId,
    enabled:result.enabled,version:result.version
   };
  }catch{blocked();}
 };
 return Object.freeze({status,save});
}
module.exports={makeRankingOwnerCallables};
