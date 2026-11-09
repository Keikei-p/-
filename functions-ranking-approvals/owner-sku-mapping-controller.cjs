"use strict";
/**
 * STAGING / NO DEPLOY. Owner-reviewed canonical partner SKU mappings.
 * Independent from sales/count originals and existing workspace Functions.
 * All permissions are proven server-side from a revocation-checked Auth token.
 * Never accept caller-provided hub ID, owner UID, price or "approved" roles.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const KEYS=["partnerCompanyId","partnerProductId","hubProductId","expectedVersion"];
const isId=v=>typeof v==="string"&&ID.test(v)&&
 !["__proto__","constructor","prototype"].includes(v);
const exact=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const publishedSku=new Set(Array.from({length:9},(_,i)=>
 "partnerSku"+String(i+1).padStart(2,"0")));
function createOwnerSkuMappingCallables({
 db,FieldValue,getAuth,HttpsError,enabled=()=>false,
 modules=()=>Promise.all([
  import("./vendor/trusted-combined-ranking-context.mjs"),
  import("./ranking/owner-reviewed-sku-mapping-store.mjs")
 ])
}={}){
 if(!db||!FieldValue||typeof getAuth!=="function"||
    typeof HttpsError!=="function"||typeof enabled!=="function"||
    typeof modules!=="function")throw Error("OWNER_SKU_MAPPING_DEPS_NOT_READY");
 let cached;
 const getModules=()=>cached??=Promise.resolve().then(()=>modules());
 const err=(code,message)=>{throw new HttpsError(code,message)};
 const block=()=>err("permission-denied","owner_sku_mapping_not_authorized");
 const denied=()=>err("failed-precondition","owner_sku_mapping_disabled");
 const invalid=()=>err("invalid-argument","owner_sku_mapping_invalid_request");
 const missing=()=>err("unauthenticated","owner_sku_mapping_login_required");
 async function principal(request,keys){
  // Feature OFF never reads an ID token, initializes a store or touches DB.
  if(enabled()!==true)denied();
  if(!exact(request?.data,keys))invalid();
  const uid=request?.auth?.uid,token=request?.auth?.token;
  if(!isId(uid)||token?.email_verified!==true||
     typeof token?.email!=="string")missing();
  const header=request?.rawRequest?.headers?.authorization;
  const bearer=typeof header==="string"?
   header.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1]:null;
  if(!bearer)missing();
  try{
   const [trust]=await getModules();
   const actor=await trust.createVerifiedRankTokenReader({
    auth:getAuth()
   })(bearer);
   if(actor.uid!==uid||
      actor.email!==token.email.trim().toLowerCase()||
      actor.emailVerified!==true)missing();
   return actor;
  }catch{missing()}
 }
 async function get(request){
  const actor=await principal(request,[]);
  try{
   const [,store]=await getModules();
   const result=await store.createOwnerReviewedSkuMappingStore({
    db,FieldValue
   }).status(actor);
   if(!exact(result,["schema","hubCompanyId","version","bindings"])||
      result.schema!=="nico-owner-reviewed-sku-map-v1"||
      !isId(result.hubCompanyId)||
      !Number.isSafeInteger(result.version)||result.version<0||
      !Array.isArray(result.bindings)||result.bindings.length>1000||
      !result.bindings.every(x=>
       exact(x,["companyId","productId","hubProductId"])&&
       isId(x.companyId)&&publishedSku.has(x.productId)&&
       isId(x.hubProductId)))block();
   return {schema:result.schema,hubCompanyId:result.hubCompanyId,
    version:result.version,
    bindings:result.bindings.map(({companyId,productId,hubProductId})=>({
     companyId,productId,hubProductId
    }))};
  }catch{block()}
 }
 async function save(request){
  const actor=await principal(request,KEYS);
  const d=request.data;
  if(!isId(d.partnerCompanyId)||!publishedSku.has(d.partnerProductId)||
     (d.hubProductId!==null&&!isId(d.hubProductId))||
     !Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<0||
     d.expectedVersion>=100000)invalid();
  try{
   const [,store]=await getModules();
   const result=await store.createOwnerReviewedSkuMappingStore({
    db,FieldValue
   }).change({principal:actor,partnerCompanyId:d.partnerCompanyId,
    partnerProductId:d.partnerProductId,hubProductId:d.hubProductId,
    expectedVersion:d.expectedVersion});
   if(!exact(result,["saved","version","partnerCompanyId",
       "partnerProductId","hubProductId"])||
      typeof result.saved!=="boolean"||
      !Number.isSafeInteger(result.version)||result.version<0||
      result.partnerCompanyId!==d.partnerCompanyId||
      result.partnerProductId!==d.partnerProductId||
      result.hubProductId!==d.hubProductId)block();
   return {saved:result.saved,version:result.version,
    partnerCompanyId:result.partnerCompanyId,
    partnerProductId:result.partnerProductId,
    hubProductId:result.hubProductId};
  }catch{block()}
 }
 return Object.freeze({get,save});
}
module.exports={createOwnerSkuMappingCallables};
