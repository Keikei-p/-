"use strict";
/**
 * STAGING ONLY. Isolated ranking-owner codebase, flag OFF by default.
 * Authenticate every request against fresh Firebase Auth. Never trust body
 * company/role/consent and never send raw financial product attributes.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const exact=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
function makeProductVisibilityCallables({
 db,FieldValue,getAuth,HttpsError,
 enabled=()=>false,
 modules=()=>Promise.all([
  import("./vendor/trusted-combined-ranking-context.mjs"),
  import("./vendor/owner-product-visibility-firestore.mjs")
 ])
}={}){
 if(!db||!FieldValue||typeof getAuth!=="function"||
    typeof HttpsError!=="function"||typeof enabled!=="function"||
    typeof modules!=="function")throw Error("OWNER_PRODUCT_CALLABLE_DEPENDENCIES_MISSING");
 let cached;
 const imports=()=>cached??=Promise.resolve().then(()=>modules());
 const error=(status,code)=>{throw new HttpsError(status,code)};
 const unauth=()=>error("unauthenticated","owner_product_login_required");
 const deny=()=>error("permission-denied","owner_product_not_authorized");
 const invalid=()=>error("invalid-argument","owner_product_invalid_request");
 const offline=()=>error("failed-precondition","owner_product_settings_disabled");
 async function authorized(request,keys){
  if(enabled()!==true)offline();
  if(!exact(request?.data,keys))invalid();
  const uid=request?.auth?.uid,token=request?.auth?.token;
  if(typeof uid!=="string"||!ID.test(uid)||
     token?.email_verified!==true||typeof token?.email!=="string")unauth();
  const h=request?.rawRequest?.headers?.authorization;
  const bearer=typeof h==="string"?
    h.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1]:null;
  if(!bearer)unauth();
  try{
   const [trusted]=await imports();
   const principal=await trusted.createVerifiedRankTokenReader({
    auth:getAuth()
   })(bearer);
   if(principal.uid!==uid||
      principal.email!==token.email.trim().toLowerCase())unauth();
   return principal;
  }catch{unauth()}
 }
 function verifyStatus(res){
  const safeId=x=>typeof x==="string"&&ID.test(x)&&
   !["__proto__","prototype","constructor"].includes(x);
  const money=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
  if(!exact(res,["schema","role","version","hubCompanyId","products",
      "partnerOverrides"])||
     res.schema!=="nico-hub-product-visibility-v1"||
     res.role!=="hub_owner"||!safeId(res.hubCompanyId)||
     !Number.isSafeInteger(res.version)||res.version<0||
     !Array.isArray(res.products)||res.products.length>1000||
     !res.products.every(p=>exact(p,["id","name","active","enabled"])&&
       safeId(p.id)&&typeof p.name==="string"&&
       p.name.trim().length>0&&p.name.trim().length<=80&&
       !money.test(p.name)&&typeof p.active==="boolean"&&
       typeof p.enabled==="boolean"&&(!p.enabled||p.active))||
     new Set(res.products.map(p=>p.id)).size!==res.products.length||
     !res.partnerOverrides||typeof res.partnerOverrides!=="object"||
     Array.isArray(res.partnerOverrides))deny();
  const overrides=Object.entries(res.partnerOverrides);
  if(overrides.length>100||!overrides.every(([companyId,productIds])=>
     safeId(companyId)&&companyId!==res.hubCompanyId&&
     Array.isArray(productIds)&&productIds.length<=1000&&
     productIds.every(safeId)&&
     new Set(productIds).size===productIds.length))deny();
  // Rebuild only approved count/label fields; never forward raw store objects.
  return {schema:res.schema,role:res.role,version:res.version,
   hubCompanyId:res.hubCompanyId,products:res.products.map(p=>({
    id:p.id,name:p.name,active:p.active,enabled:p.enabled
   })),partnerOverrides:Object.fromEntries(
    overrides.map(([companyId,productIds])=>[companyId,productIds.slice()])
   )};
 }
 const load=async request=>{
  const principal=await authorized(request,[]);
  try{
   const [,store]=await imports();
   return verifyStatus(await store.createOwnerProductVisibilityStore({
    db,FieldValue
   }).readStatus(principal));
  }catch{deny();}
 };
 const save=async request=>{
  const principal=await authorized(request,[
   "productId","enabled","expectedVersion","partnerCompanyId"
  ]);
  const d=request.data;
  if(!ID.test(d.productId||"")||typeof d.enabled!=="boolean"||
     !Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<0||
     (d.partnerCompanyId!==null&&!ID.test(d.partnerCompanyId||"")))
   invalid();
  try{
   const [,store]=await imports();
   const out=await store.createOwnerProductVisibilityStore({
    db,FieldValue
   }).saveSwitch({principal,productId:d.productId,enabled:d.enabled,
    expectedVersion:d.expectedVersion,partnerCompanyId:d.partnerCompanyId});
   if(!exact(out,["saved","version","productId","enabled","partnerCompanyId"])||
      typeof out.saved!=="boolean"||
      !Number.isSafeInteger(out.version)||out.version<0||
      out.productId!==d.productId||out.enabled!==d.enabled||
      out.partnerCompanyId!==d.partnerCompanyId)deny();
   return {saved:out.saved,version:out.version,productId:out.productId,
    enabled:out.enabled,partnerCompanyId:out.partnerCompanyId};
  }catch{deny();}
 };
 return Object.freeze({load,save});
}
module.exports={makeProductVisibilityCallables};
