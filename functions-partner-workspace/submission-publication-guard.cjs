"use strict";
/**
 * STAGING ONLY / NO DEPLOY.
 * Read owner publication and reviewed exact SKU mapping INSIDE the existing
 * partner count-write transaction. No records, sales, CB or history are edited.
 * The caller MUST pass a fresh server-authenticated partner scope, and BOTH
 * previousCounts and nextCounts from the same transaction (never browser
 * supplied previousCounts). OFF counts are immutable, not silently reset.
 */
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|キャッシュバック|[¥￥$€]|[0-9０-９][0-9０-９,，]*\\s*(?:万円|千円|円))/i;
const deny=()=>{throw Error("PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const snap=x=>x?.exists===true&&typeof x.data==="function"?x.data():null;
const unique=x=>Array.isArray(x)&&x.length<=1000&&x.every(id)&&
 new Set(x).size===x.length;
const exact=(x,keys)=>obj(x)&&Object.keys(x).sort().join("|")===
 [...keys].sort().join("|");
function counts(value){
 if(!exact(value,KEYS))deny();
 for(const k of KEYS)if(!Number.isSafeInteger(value[k])||value[k]<0||value[k]>9999)deny();
 return value;
}
function validatePolicy({hubId,partnerId,ownerUid,visibility,mapping,products}){
 if(!obj(visibility)||visibility.hubCompanyId!==hubId||
    visibility.ownerUid!==ownerUid||
    !Number.isSafeInteger(visibility.version)||visibility.version<1||
    !unique(visibility.enabledHubProductIds)||
    !obj(visibility.partnerOverrides)||
    Object.keys(visibility.partnerOverrides).length>100||
    !obj(mapping)||mapping.hubCompanyId!==hubId||
    mapping.ownerUid!==ownerUid||mapping.reviewedByUid!==ownerUid||
    mapping.active!==true||!Number.isSafeInteger(mapping.version)||
    mapping.version<1||!Array.isArray(mapping.bindings)||
    mapping.bindings.length>1000||!Array.isArray(products)||products.length>1000)deny();
 const catalog=new Map();
 for(const p of products){
  if(!obj(p)||!id(p.id)||p.companyId!==hubId||
     (p.active!==undefined&&typeof p.active!=="boolean")||
     typeof p.name!=="string"||p.name.length<1||p.name.length>80||
     catalog.has(p.id))deny();
  catalog.set(p.id,p);
 }
 const globallyEnabled=new Set(visibility.enabledHubProductIds);
 for(const sku of globallyEnabled)if(!catalog.has(sku))deny();
 const overrides=visibility.partnerOverrides;
 for(const [companyId,values] of Object.entries(overrides)){
  if(!id(companyId)||companyId===hubId||!unique(values)||
     values.some(v=>!catalog.has(v)))deny();
 }
 const partnerAllowed=Object.prototype.hasOwnProperty.call(overrides,partnerId)?
  new Set(overrides[partnerId]):globallyEnabled;
 const mapped=new Map(),seen=new Set(),seenHubSku=new Set();
 for(const b of mapping.bindings){
  if(!exact(b,["companyId","productId","hubProductId"])||
     !id(b.companyId)||b.companyId===hubId||
     !/^partnerSku0[1-9]$/.test(b.productId)||!id(b.hubProductId)||
     !catalog.has(b.hubProductId))deny();
  const key=JSON.stringify([b.companyId,b.productId]);
  if(seen.has(key))deny();
  seen.add(key);
  if(b.companyId!==partnerId)continue;
  // A single reviewed hub SKU cannot be published twice under two categories.
  if(seenHubSku.has(b.hubProductId))deny();
  seenHubSku.add(b.hubProductId);
  if(MONEY.test(catalog.get(b.hubProductId).name))deny();
  // Never interpret old combined SB光・AIR as either new 光 or Air.
  if(b.productId==="partnerSku05"&&
     !/SB光・AIR|旧合算|未分類/.test(catalog.get(b.hubProductId).name))deny();
  mapped.set(b.productId,b.hubProductId);
 }
 const allowed=new Set();
 for(let i=0;i<KEYS.length;i++){
  const skuId="partnerSku"+String(i+1).padStart(2,"0");
  const hubProductId=mapped.get(skuId);
  if(hubProductId&&globallyEnabled.has(hubProductId)&&
     partnerAllowed.has(hubProductId)&&catalog.get(hubProductId).active!==false)
   allowed.add(KEYS[i]);
 }
 return {allowed,version:visibility.version};
}
function createPartnerSubmissionPublicationGuard({db}={}){
 if(typeof db?.collection!=="function")deny();
 return async function verify({tx,scope,previousCounts,nextCounts}={}){
  if(typeof tx?.get!=="function"||!scope||
     scope.verifiedByServer!==true||scope.kind!=="partner"||
     !id(scope.uid)||!id(scope.cid)||!id(scope.hubId)||
     scope.cid===scope.hubId)deny();
  const before=counts(previousCounts),after=counts(nextCounts);
  const hub=db.collection("companies").doc(scope.hubId);
  const partner=db.collection("companies").doc(scope.cid);
  const [hubSnap,partnerSnap,relationSnap,visibilitySnap,mappingSnap,productSnap]=
   await Promise.all([
    tx.get(hub),tx.get(partner),
    tx.get(db.collection("partnerRelations").doc(scope.cid)),
    tx.get(hub.collection("rankingProductVisibility").doc("shared")),
    tx.get(hub.collection("rankingSkuMappings").doc("shared")),
    tx.get(db.collection("products").where("companyId","==",scope.hubId).limit(1001))
   ]);
  const h=snap(hubSnap),p=snap(partnerSnap),r=snap(relationSnap);
  if(!obj(h)||!id(h.ownerUid)||h.active===false||
     !obj(p)||p.companyKind!=="partner"||p.active!==true||
     p.hubCompanyId!==scope.hubId||
     !obj(r)||r.hubCompanyId!==scope.hubId||
     r.partnerCompanyId!==scope.cid||r.active!==true||
     r.countSharingApproved!==true||!Array.isArray(productSnap?.docs)||
     productSnap.docs.length>1000)deny();
  const products=productSnap.docs.map(d=>({...snap(d),id:d.id}));
  const policy=validatePolicy({hubId:scope.hubId,partnerId:scope.cid,
   ownerUid:h.ownerUid,visibility:snap(visibilitySnap),
   mapping:snap(mappingSnap),products});
  for(const key of KEYS){
   // OFF is a publication setting, never a destructive history migration.
   if(!policy.allowed.has(key)&&after[key]!==before[key])deny();
  }
  return Object.freeze({verified:true,publicationVersion:policy.version,
   enabledCategories:Object.freeze(KEYS.filter(k=>policy.allowed.has(k)))});
 };
}

module.exports={createPartnerSubmissionPublicationGuard};
