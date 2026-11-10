"use strict";
// Shared ranks are released ONLY for exact Owner-reviewed SKU mappings and
// server-stored per-partner visibility. This module never writes or returns
// financial master fields, inactive products, raw IDs or cashback tier labels.
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const stop=()=>{throw Error("PARTNER_PUBLICATION_UNVERIFIED")};
const id=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const unique=x=>Array.isArray(x)&&x.length<=1000&&x.every(id)&&new Set(x).size===x.length;
function allowedPartnerCategories({hubId,cid,ownerUid,visibility,mapping,products}={}){
 if(!id(hubId)||!id(cid)||hubId===cid||!id(ownerUid)||
  !obj(visibility)||visibility.hubCompanyId!==hubId||
  visibility.ownerUid!==ownerUid||
  !Number.isSafeInteger(visibility.version)||visibility.version<1||
  !unique(visibility.enabledHubProductIds)||
  !obj(visibility.partnerOverrides)||
  Object.keys(visibility.partnerOverrides).length>100||
  !obj(mapping)||mapping.hubCompanyId!==hubId||
  mapping.ownerUid!==ownerUid||mapping.reviewedByUid!==ownerUid||
  mapping.active!==true||!Number.isSafeInteger(mapping.version)||
  mapping.version<1||!Array.isArray(mapping.bindings)||
  mapping.bindings.length>1000||!Array.isArray(products)||
  products.length>1000)stop();
 const catalog=new Map(),approved=new Set(visibility.enabledHubProductIds);
 for(const product of products){
  if(!obj(product)||!id(product.id)||product.companyId!==hubId||
   catalog.has(product.id)||typeof product.name!=="string"||
   !product.name.trim()||product.name.length>80||
   (product.active!==undefined&&typeof product.active!=="boolean"))stop();
  catalog.set(product.id,product);
 }
 for(const v of approved)if(!catalog.has(v))stop();
 for(const [companyId,selected] of Object.entries(visibility.partnerOverrides)){
  if(!id(companyId)||companyId===hubId||!unique(selected)||
   selected.some(x=>!catalog.has(x)))stop();
 }
 const scoped=Object.prototype.hasOwnProperty.call(visibility.partnerOverrides,cid)?
  new Set(visibility.partnerOverrides[cid]):approved;
 const binding=new Map(),seen=new Set();
 for(const b of mapping.bindings){
  if(!obj(b)||Object.keys(b).sort().join("|")!==
   ["companyId","productId","hubProductId"].sort().join("|")||
   !id(b.companyId)||b.companyId===hubId||
   !/^partnerSku0[1-9]$/.test(b.productId)||
   !id(b.hubProductId)||!catalog.has(b.hubProductId))stop();
  const k=JSON.stringify([b.companyId,b.productId]);
  if(seen.has(k))stop();
  seen.add(k);
  if(b.companyId!==cid)continue;
  if(b.productId==="partnerSku05"&&
   !/SB光・AIR|旧合算|未分類/.test(catalog.get(b.hubProductId).name))stop();
  binding.set(b.productId,b.hubProductId);
 }
 return Object.freeze(KEYS.filter((category,i)=>{
  const sku="partnerSku"+String(i+1).padStart(2,"0"),pid=binding.get(sku);
  return pid&&approved.has(pid)&&scoped.has(pid)&&catalog.get(pid).active!==false;
 }));
}
module.exports={allowedPartnerCategories,KEYS};
