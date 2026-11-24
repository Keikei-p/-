/**
 * STAGING / NO DEPLOY. One explicitly reviewed legacy SKU mapping can be
 * copied to the other verified partner companies, without touching saved
 * counts, finance, product masters or another company's existing overrides.
 * Only nine common, immutable partnerSku01..09 IDs can be copied. Company-
 * private SKUs MUST be individually reviewed; the server rechecks every save.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const LEGACY=new Set(Array.from({length:9},(_,i)=>"partnerSku0"+(i+1)));
// Identical combined-category safeguard to the canonical Owner mapping writer:
// saved 光/AIR history may never become a standalone 光 or AIR product.
const LEGACY_COMBINED_LIGHT_AIR=/(?:^|[\s（(])(?:SB|ソフトバンク)?光\s*[/／・]\s*(?:AIR|エアー)(?=$|[\s）)（(])/i;
const LEGACY_COMBINED_TSUBASA_HTB=/(?:^|[\s（(])(?:つばさ|翼)\s*[/／・]\s*HTB(?=$|[\s）)（(])/i;
const fail=()=>{throw Error("OWNER_SKU_ROLLOUT_UNVERIFIED");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const pair=(a,b)=>JSON.stringify([a,b]);
function checked(mapping,catalog,source,targetIds){
 if(!id(source)||!Array.isArray(targetIds)||targetIds.length>30||
    new Set(targetIds).size!==targetIds.length||
    targetIds.some(x=>!id(x)||x===source))fail();
 if(!exact(mapping,["schema","hubCompanyId","version","bindings"])||
    mapping.schema!=="nico-owner-reviewed-sku-map-v1"||
    !id(mapping.hubCompanyId)||source===mapping.hubCompanyId||
    !Number.isSafeInteger(mapping.version)||mapping.version<0||
    !Array.isArray(mapping.bindings)||mapping.bindings.length>1000)fail();
 if(!exact(catalog,["schema","role","version","hubCompanyId","products","partnerOverrides"])||
    catalog.schema!=="nico-hub-product-visibility-v1"||
    catalog.role!=="hub_owner"||catalog.hubCompanyId!==mapping.hubCompanyId||
    !Number.isSafeInteger(catalog.version)||catalog.version<0||
    !Array.isArray(catalog.products)||catalog.products.length>1000||
    !object(catalog.partnerOverrides)||Object.keys(catalog.partnerOverrides).length>100)fail();
 const products=new Map();
 for(const p of catalog.products){
  if(!exact(p,["id","name","active","enabled"])||!id(p.id)||
     products.has(p.id)||typeof p.name!=="string"||!p.name.trim()||
     p.name.length>80||typeof p.active!=="boolean"||
     typeof p.enabled!=="boolean"||p.enabled&&!p.active)fail();
  products.set(p.id,p);
 }
 for(const [companyId,allowed] of Object.entries(catalog.partnerOverrides)){
  if(!id(companyId)||!Array.isArray(allowed)||allowed.length>1000||
     new Set(allowed).size!==allowed.length||
     allowed.some(pid=>!id(pid)||!products.has(pid)))fail();
 }
 const sources=new Set(),targets=new Set(),bindings=new Map();
 for(const b of mapping.bindings){
  if(!exact(b,["companyId","productId","hubProductId"])||
     !id(b.companyId)||!id(b.hubProductId)||
     typeof b.productId!=="string"||
     !(LEGACY.has(b.productId)||/^partnerPrivate:[A-Za-z0-9_-]{1,128}$/.test(b.productId)))fail();
  if(b.hubProductId.startsWith("legacyPartnerSku:")&&b.hubProductId!=="legacyPartnerSku:"+b.productId)fail();
  const sk=pair(b.companyId,b.productId),tk=pair(b.companyId,b.hubProductId);
  if(sources.has(sk)||targets.has(tk))fail();
  if(b.productId==="partnerSku05"){
   const combinedTarget=products.get(b.hubProductId);
   if(!combinedTarget||
      !LEGACY_COMBINED_LIGHT_AIR.test(combinedTarget.name.normalize("NFKC")))fail();
  }
  if(b.productId==="partnerSku07"&&
     !LEGACY_COMBINED_TSUBASA_HTB.test(products.get(b.hubProductId)?.name?.normalize("NFKC")??""))fail();
  sources.add(sk);targets.add(tk);
  if(!bindings.has(b.companyId))bindings.set(b.companyId,new Map());
  bindings.get(b.companyId).set(b.productId,b.hubProductId);
 }
 return {bindings,products,hub:mapping.hubCompanyId};
}
export function planOwnerReviewedSkuRollout({
 mapping,catalog,sourceCompanyId,targetCompanyIds
}={}){
 if(!Array.isArray(targetCompanyIds))fail();
 const targets=[...targetCompanyIds];
 const {bindings,products,hub}=checked(mapping,catalog,sourceCompanyId,targets);
 if(targets.some(x=>x===hub))fail();
 const source=bindings.get(sourceCompanyId)||new Map();
 // Never invent a correspondence. Only the Owner's already SAVED reviewed
 // binding in the source company is used as a reusable mapping template.
 const reviewed=[...source].filter(([sku])=>LEGACY.has(sku))
  .sort(([a],[b])=>a.localeCompare(b));
 const plans=[];
 let totalApply=0,totalExisting=0,totalConflicts=0,totalOff=0;
 for(const companyId of targets){
  const occupied=bindings.get(companyId)||new Map();
  const mappedTargets=new Set(occupied.values());
  const allowed=Object.hasOwn(catalog.partnerOverrides,companyId)?
   new Set(catalog.partnerOverrides[companyId]):null;
  const apply=[];
  let existing=0,conflicts=0,off=0;
  for(const [partnerProductId,hubProductId] of reviewed){
   const product=products.get(hubProductId);
   if(!product||!product.active||!product.enabled||
      allowed&&!allowed.has(hubProductId)){off++;continue}
   const previous=occupied.get(partnerProductId);
   if(previous!==undefined){
    if(previous===hubProductId)existing++;
    else conflicts++;
    continue;
   }
   if(mappedTargets.has(hubProductId)){conflicts++;continue}
   mappedTargets.add(hubProductId);
   apply.push(Object.freeze({partnerProductId,hubProductId}));
  }
  totalApply+=apply.length;totalExisting+=existing;
  totalConflicts+=conflicts;totalOff+=off;
  plans.push(Object.freeze({partnerCompanyId:companyId,
   apply:Object.freeze(apply),existing,conflicts,off}));
 }
 return Object.freeze({
  schema:"nico-owner-reviewed-sku-rollout-plan-v1",
  sourceCompanyId,hubCompanyId:hub,
  expectedMappingVersion:mapping.version,expectedCatalogVersion:catalog.version,
  targetCompanyIds:Object.freeze(targets),
  plans:Object.freeze(plans),totalApply,totalExisting,totalConflicts,totalOff
 });
}
/**
 * This never runs on page load. The Owner must click a separate confirmation
 * button. The calling page must derive target IDs from the existing verified
 * hub roster, never URL state. All writes are audited/versioned server calls.
 */
export async function applyOwnerReviewedSkuRollout({
 confirmed=false,plan,auth,readMappings,readProducts,saveMapping,
 canContinue=()=>true
}={}){
 if(confirmed!==true)return Object.freeze({status:"not_confirmed",verified:0});
 if(!object(plan)||plan.schema!=="nico-owner-reviewed-sku-rollout-plan-v1"||
    !Array.isArray(plan.plans)||!auth?.currentUser||
    typeof readMappings!=="function"||
    typeof readProducts!=="function"||typeof saveMapping!=="function"||
    typeof canContinue!=="function")fail();
 const identity=auth.currentUser;
 if(!id(identity.uid)||identity.emailVerified!==true||
    typeof identity.getIdToken!=="function")fail();
 let verified=0;
 try{
  for(const target of plan.plans){
   for(const operation of target.apply){
    if(auth.currentUser!==identity||!canContinue())fail();
    const token=await identity.getIdToken();
    if(auth.currentUser!==identity||!canContinue()||typeof token!=="string"||token.length<20)fail();
    const [mapping,catalog]=await Promise.all([
     readMappings({token}),readProducts({token})
    ]);
    if(auth.currentUser!==identity||!canContinue())fail();
    if(catalog.version!==plan.expectedCatalogVersion||
       mapping.version!==plan.expectedMappingVersion+verified)fail();
    const fresh=planOwnerReviewedSkuRollout({
     mapping,catalog,sourceCompanyId:plan.sourceCompanyId,
     targetCompanyIds:[target.partnerCompanyId]
    });
    if(fresh.hubCompanyId!==plan.hubCompanyId||
       !fresh.plans[0].apply.some(x=>
        x.partnerProductId===operation.partnerProductId&&
        x.hubProductId===operation.hubProductId))fail();
    const saved=await saveMapping({token,
     partnerCompanyId:target.partnerCompanyId,
     partnerProductId:operation.partnerProductId,
     hubProductId:operation.hubProductId,
     expectedVersion:mapping.version
    });
    if(auth.currentUser!==identity||!canContinue()||!exact(saved,
       ["saved","version","partnerCompanyId","partnerProductId","hubProductId"])||
       saved.saved!==true||saved.version!==mapping.version+1||
       saved.partnerCompanyId!==target.partnerCompanyId||
       saved.partnerProductId!==operation.partnerProductId||
       saved.hubProductId!==operation.hubProductId)fail();
    const reloaded=await readMappings({token});
    if(auth.currentUser!==identity||!canContinue()||reloaded.version!==saved.version||
       !reloaded.bindings?.some(x=>x.companyId===target.partnerCompanyId&&
         x.productId===operation.partnerProductId&&
         x.hubProductId===operation.hubProductId))fail();
    verified++;
   }
  }
  return Object.freeze({status:"verified",verified,planned:plan.totalApply});
 }catch{
  // Never auto-rollback or claim success for a write with no readback.
  return Object.freeze({status:"partial_or_blocked",verified,planned:plan.totalApply});
 }
}
