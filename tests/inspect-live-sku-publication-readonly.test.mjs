import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessSkuPublication,inspectSkuPublication}
 from "../tools/production/inspect-live-sku-publication-readonly.mjs";
const base=()=>{
 const relations=[{partnerCompanyId:"partner",hubCompanyId:"hub",active:true,
  countSharingApproved:true}];
 const visibility={hubCompanyId:"hub",ownerUid:"owner",version:2,
  enabledHubProductIds:["nuro","air"],partnerOverrides:{}};
 const mapping={hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
  active:true,version:1,bindings:[
   {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"partner",productId:"partnerSku05",hubProductId:"air"}
  ]};
 const catalog={schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub",
  ownerUid:"owner",version:2,products:[
   {id:"nuro",companyId:"hub",name:"NURO光",active:true},
   {id:"air",companyId:"hub",name:"SB光・AIR（旧合算）",active:true}
  ]};
 return {hubId:"hub",ownerUid:"owner",relations,visibility,mapping,catalog,
  approvals:[{hubApproved:true,partnerApproved:true,namesApproved:true}]};
};
test("real owner-published count-only settings + reciprocal consent are ready",()=>{
 const r=assessSkuPublication(base());
 assert.equal(r.publishedCatalogReady,true);
 assert.equal(r.partnerCompaniesMapped,1);
 assert.equal(r.enabledCategoriesMappedToAllPartners,true);
 assert.equal(r.reciprocalOwnerRankConsentReady,true);
 assert.doesNotMatch(JSON.stringify(r),/owner|hubId|nuro|air|uid|email|token|￥|円/);
});
test("missing Owner publication does not claim readiness or modify previous partner counts",()=>{
 const v=base(),previous=structuredClone(v);
 v.catalog=null;
 const r=assessSkuPublication(v);
 assert.equal(r.publishedCatalogReady,false);
 assert.equal(r.partnerCompaniesMapped,0);
 assert.equal(r.reciprocalOwnerRankConsentReady,true,
  "approved ranking consent must remain independently visible");
 assert.deepEqual(previous.relations, v.relations);
 assert.deepEqual(previous.visibility, v.visibility);
});
test("same-version count-only catalog, unique mapped IDs and active SKU are mandatory",()=>{
 for(const mutate of [
  p=>{p.catalog.version++;},
  p=>{p.catalog.products[0].unitPrice=50000;},
  p=>{p.visibility.enabledHubProductIds.push("unknown");},
  p=>{p.mapping.bindings.push({...p.mapping.bindings[0]});},
  p=>{p.mapping.bindings.push({companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"});},
  p=>{p.catalog.products[0].name="NURO 50000円";},
  p=>{p.mapping.bindings[1].productId="partnerSku05";p.catalog.products[1].name="SB光";},
  p=>{p.visibility.partnerOverrides.foreign=["nuro"];}
 ]){
  const f=base();mutate(f);
  assert.throws(()=>assessSkuPublication(f),/STOP_SKU_PUBLICATION_READONLY_/);
 }
});
test("missing one partner category mapping fails readiness instead of inventing counts",()=>{
 const p=base();
 p.mapping.bindings.pop();
 const r=assessSkuPublication(p);
 assert.equal(r.enabledCategoriesMappedToAllPartners,false);
 assert.equal(r.partnerCompaniesMapped,1);
 const q=base();q.approvals[0].namesApproved=false;
 assert.equal(assessSkuPublication(q).reciprocalOwnerRankConsentReady,false);
});
class DB{
 constructor(){this.docs=new Map();this.reads=[];}
 seed(k,v){this.docs.set(k,structuredClone(v));}
 collection(k){return this.col(k);}
 col(k,filter=null){const self=this;return {
  doc(id){const path=k+"/"+id;return {
   get:async()=>self.snap(path),collection:n=>self.col(path+"/"+n)
  };},
  where(field,op,v){assert.equal(op,"==");return self.col(k,[field,v]);},
  select(...fields){return {...self.col(k,filter),selected:fields,
   limit(n){return self.colLimit(k,filter,n,fields);}};},
  limit(n){return self.colLimit(k,filter,n);}
 };}
 colLimit(k,filter,n,fields=null){const self=this;return {
  get:async()=>{
   assert(n<=201);
   self.reads.push(k);
   const docs=[...self.docs].filter(([path,v])=>
    path.startsWith(k+"/")&&!path.slice(k.length+1).includes("/")&&
    (!filter||v[filter[0]]===filter[1])).slice(0,n).map(([path,v])=>({
     id:path.slice(k.length+1),data:()=>fields?
      Object.fromEntries(fields.filter(x=>Object.hasOwn(v,x)).map(x=>[x,v[x]])):v
    }));
   return {docs};
  }
 };}
 async snap(path){this.reads.push(path);return {
  exists:this.docs.has(path),data:()=>this.docs.get(path)
 };}
}
function live(){
 const db=new DB(),p=base();
 db.seed("companies/hub",{active:true,ownerUid:"owner",companyKind:"internal"});
 db.seed("companies/partner",{active:true,ownerUid:"partnerOwner",companyKind:"partner"});
 db.seed("partnerRelations/partner",{...p.relations[0],
  combinedRankingApprovedByHub:true,combinedRankingApprovedByPartner:true,
  individualNamesApprovedByHub:true,individualNamesApprovedByPartner:true});
 db.seed("companies/hub/rankingProductVisibility/shared",p.visibility);
 db.seed("companies/hub/rankingSkuMappings/shared",p.mapping);
 db.seed("companies/hub/rankingCountPublicCatalog/shared",p.catalog);
 db.seed("companies/hub/rankingApprovals/partner",{
  active:true,combinedRankingApproved:true,individualNamesApproved:true});
 db.seed("companies/partner/rankingApprovals/hub",{
  active:true,combinedRankingApproved:true,individualNamesApproved:true});
 db.seed("products/secret",{unitPrice:100000,name:"秘密単価"});
 return db;
}
test("bounded live metadata reader checks only approved count-only paths, never financial originals",async()=>{
 const db=live(),r=await inspectSkuPublication(db);
 assert.equal(r.hubCompanyCount,1);
 assert.equal(r.activeApprovedPartnerCount,1);
 assert.equal(r.ownerPublicationCatalogReady,true);
 assert.equal(r.allEnabledPartnerSkuMapped,true);
 assert.equal(r.reciprocalOwnerRankConsentReady,true);
 assert.equal(r.safeToEnableNewRanking,false,"no real logged-in proof");
 assert.equal(r.productionDocumentWrites,0);
 assert.equal(r.blockingReasons.length,0);
 assert(db.reads.length<=9);
 assert(!db.reads.some(s=>/^(products|records|recordCorrections|revenueGoals|users)\//.test(s)));
 assert.doesNotMatch(JSON.stringify(r),/secret|price|token|salary|50000/);
});
test("missing live catalog or approval reports blockers and never creates a document",async()=>{
 const db=live();
 db.docs.delete("companies/hub/rankingCountPublicCatalog/shared");
 db.docs.delete("companies/partner/rankingApprovals/hub");
 const before=[...db.docs].map(([k,v])=>[k,structuredClone(v)]);
 const r=await inspectSkuPublication(db);
 assert.equal(r.ownerPublicationCatalogReady,false);
 assert.equal(r.reciprocalOwnerRankConsentReady,false);
 assert(r.blockingReasons.includes("OWNER_PUBLIC_CATALOG_MISSING"));
 assert.deepEqual([...db.docs],before);
});
test("missing catalog cannot falsely imply missing Owner ranking consent",async()=>{
 const db=live();
 db.docs.delete("companies/hub/rankingCountPublicCatalog/shared");
 const before=structuredClone([...db.docs]);
 const r=await inspectSkuPublication(db);
 assert.equal(r.ownerPublicationCatalogReady,false);
 assert.equal(r.reciprocalOwnerRankConsentReady,true);
 assert(r.blockingReasons.includes("OWNER_PUBLIC_CATALOG_MISSING"));
 assert(!r.blockingReasons.includes("RECIPROCAL_RANK_CONSENT_INCOMPLETE"));
 assert.equal(r.productionDocumentWrites,0);
 assert.deepEqual([...db.docs],before);
});
test("public release path is GET-only, no credential output and no deploy",()=>{
 const source=readFileSync(new URL("../tools/production/inspect-live-sku-publication-readonly.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\b(?:tx|docRef|db|batch|writer)\.(?:set|update|delete|create)\s*\(|runTransaction\(|firebase deploy|functions:delete/);
 assert.match(source,/GITHUB_REF!=="refs\/heads\/main"/);
 assert.match(source,/mode:"LIVE_READ_ONLY_NO_DEPLOY"/);
 assert.match(source,/safeToEnableNewRanking:false/);
});
