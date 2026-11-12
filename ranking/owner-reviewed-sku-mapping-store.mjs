/**
 * STAGING / NO DEPLOY. Explicit owner-reviewed partner SKU -> hub SKU mapping.
 * This is the missing durable writer for the canonical count reader's exact
 * companies/{hub}/rankingSkuMappings/shared document. No historical records,
 * pricing, cashback, existing product masters or counts are ever changed.
 *
 * Authentication MUST be bound to a server-verified Firebase ID token first.
 * Neither a partner role nor any browser-provided company identity is trusted.
 */
import {PARTNER_RANK_SKUS} from "./partner-workspace-count-source.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９,.，]*\s*(?:円|万円))/i;
const SKU=new Set(PARTNER_RANK_SKUS.map(p=>p.id));
const stop=()=>{throw Error("OWNER_SKU_MAPPING_REVIEW_UNVERIFIED");};
const id=s=>typeof s==="string"&&ID.test(s)&&
 !["prototype","constructor","__proto__"].includes(s);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const read=s=>s?.exists===true&&typeof s.data==="function"?s.data():null;
const label=s=>typeof s==="string"&&s.trim().length>0&&
 s.length<=80&&!MONEY.test(s.normalize("NFKC"))?s.trim():stop();
const shape=(o,keys)=>obj(o)&&
 Object.keys(o).sort().join("|")===keys.slice().sort().join("|");
function mapping(doc,hub,uid){
 if(!doc)return {version:0,bindings:[]};
 if(!obj(doc)||doc.hubCompanyId!==hub||
    doc.ownerUid!==uid||doc.reviewedByUid!==uid||
    doc.active!==true||
    !Number.isSafeInteger(doc.version)||doc.version<1||
    !Array.isArray(doc.bindings)||doc.bindings.length>1000)stop();
 const seen=new Set();
 for(const b of doc.bindings){
  if(!shape(b,["companyId","productId","hubProductId"])||
     !id(b.companyId)||b.companyId===hub||
     !SKU.has(b.productId)||!id(b.hubProductId))stop();
  const k=b.companyId+":"+b.productId;
  if(seen.has(k))stop();
  seen.add(k);
 }
 return {version:doc.version,bindings:doc.bindings.map(b=>({...b}))};
}
export function createOwnerReviewedSkuMappingStore({db,FieldValue}={}){
 if(!db?.collection||typeof db.runTransaction!=="function"||
    typeof FieldValue?.serverTimestamp!=="function")stop();
 const c=id=>db.collection("companies").doc(id);
 const ref=hub=>c(hub).collection("rankingSkuMappings").doc("shared");
 async function verifyOwner(tx,principal){
  if(!id(principal?.uid)||principal.emailVerified!==true)stop();
  const [us,ctx]=await Promise.all([
   tx.get(db.collection("users").doc(principal.uid)),
   tx.get(db.collection("partnerWorkspaceContexts").doc(principal.uid))
  ]);
  const u=read(us),secondary=read(ctx);
  if(!obj(u)||u.uid!==principal.uid||!id(u.companyId)||
     u.active!==true||u.companyRole!=="owner"||
     u.accessKind==="partner"||u.memberType==="cooperator"||
     (ctx.exists&&secondary?.active!==false))stop();
  const hub=u.companyId;
  const [company,member]=await Promise.all([
   tx.get(c(hub)),tx.get(c(hub).collection("members").doc(principal.uid))
  ]);
  const h=read(company),m=read(member);
  if(!obj(h)||h.ownerUid!==principal.uid||h.active===false||
     h.companyKind==="partner"||!obj(m)||m.uid!==principal.uid||
     m.companyRole!=="owner"||m.active!==true||
     m.accessKind==="partner"||
     (m.companyId!=null&&m.companyId!==hub))stop();
  return {hub,uid:principal.uid};
 }
 async function verifyPartner(tx,hub,partnerId){
  if(!id(partnerId)||partnerId===hub)stop();
  const [com,rel]=await Promise.all([
   tx.get(c(partnerId)),
   tx.get(db.collection("partnerRelations").doc(partnerId))
  ]);
  const company=read(com),relation=read(rel);
  if(!obj(company)||company.companyKind!=="partner"||
     company.active!==true||company.hubCompanyId!==hub||
     !obj(relation)||relation.active!==true||
     relation.hubCompanyId!==hub||
     relation.partnerCompanyId!==partnerId||
     relation.countSharingApproved!==true)stop();
 }
 async function status(principal){
  return db.runTransaction(async tx=>{
   const {hub,uid}=await verifyOwner(tx,principal);
   const saved=mapping(read(await tx.get(ref(hub))),hub,uid);
   return {schema:"nico-owner-reviewed-sku-map-v1",
    hubCompanyId:hub,version:saved.version,
    bindings:saved.bindings};
  },{readOnly:true});
 }
 async function change({principal,partnerCompanyId,partnerProductId,
   hubProductId,expectedVersion}={}){
  if(!id(partnerCompanyId)||!SKU.has(partnerProductId)||
     (hubProductId!==null&&!id(hubProductId))||
     !Number.isSafeInteger(expectedVersion)||
     expectedVersion<0||expectedVersion>=100000)stop();
  return db.runTransaction(async tx=>{
   const {hub,uid}=await verifyOwner(tx,principal);
   await verifyPartner(tx,hub,partnerCompanyId);
   const mappingRef=ref(hub);
   const previousSnap=await tx.get(mappingRef);
   const previous=mapping(read(previousSnap),hub,uid);
   if(previous.version!==expectedVersion)stop();
   const found=previous.bindings.find(b=>b.companyId===partnerCompanyId&&
     b.productId===partnerProductId);
   const prevId=found?.hubProductId??null;
   // The count-save guard rejects two categories pointing to the same hub
   // SKU. Refuse that invalid state at the owner mapping writer, before writes.
   // Allow removal of older mappings through the audited versioned path.
   if(hubProductId!==null&&previous.bindings.some(b=>
      b.companyId===partnerCompanyId&&b.productId!==partnerProductId&&
      b.hubProductId===hubProductId))stop();
   if(hubProductId!==null){
    const product=read(await tx.get(db.collection("products").doc(hubProductId)));
    if(!obj(product)||product.companyId!==hub||
       product.active===false)stop();
    const name=label(product.name);
    // The old combined SB光・AIR value may ONLY map to a distinct combined
    // hub product, NEVER infer any separate Hikari or Air counts.
    if(partnerProductId==="partnerSku05"&&
       !/SB光・AIR|旧合算|未分類/.test(name))stop();
   }
   if(prevId===hubProductId)return {
    saved:false,version:previous.version,partnerCompanyId,
    partnerProductId,hubProductId};
   const bindings=previous.bindings.filter(b=>!(
     b.companyId===partnerCompanyId&&b.productId===partnerProductId
   ));
   if(hubProductId!==null)bindings.push({
    companyId:partnerCompanyId,
    productId:partnerProductId,hubProductId
   });
   bindings.sort((a,b)=>a.companyId.localeCompare(b.companyId)||
     a.productId.localeCompare(b.productId));
   if(bindings.length>1000)stop();
   const version=previous.version+1,now=FieldValue.serverTimestamp();
   const saved={
    hubCompanyId:hub,ownerUid:uid,reviewedByUid:uid,active:true,
    version,bindings,reviewedAt:now
   };
   if(previousSnap.exists)tx.update(mappingRef,saved);
   else tx.create(mappingRef,{...saved,createdAt:now});
   tx.create(c(hub).collection("rankingSkuMappingAudit").doc(),{
    hubCompanyId:hub,partnerCompanyId,partnerProductId,
    previousHubProductId:prevId,hubProductId,version,
    reviewedByUid:uid,reviewedAt:now
   });
   return {saved:true,version,partnerCompanyId,
    partnerProductId,hubProductId};
  });
 }
 return Object.freeze({status,change});
}
