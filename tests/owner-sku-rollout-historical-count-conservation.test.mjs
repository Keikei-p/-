/**
 * Synthetic 234-count regression; NOT a real production company/product split.
 * Only total 234 / mapped 6 / held 228 / combined 光-AIR 35 mirrors a past
 * read-only inventory. The invented distribution must never be presented as
 * actual customer/staff/product data. No credentials, Firebase or writes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {inventoryPartnerFullHistory,LEGACY_PARTNER_CATEGORIES}
 from "../ranking/partner-full-history-inventory.mjs";
import {planOwnerReviewedSkuRollout,applyOwnerReviewedSkuRollout}
 from "../ranking/owner-reviewed-sku-rollout.mjs";

const DATE="2026-11-20", HUB="hub", OWNER="ownerHub";
const makeCounts=(nuro,sbmnp,combined)=>Object.fromEntries(
 LEGACY_PARTNER_CATEGORIES.map(name=>[name,
  name==="NURO"?nuro:name==="SBMNP"?sbmnp:
  name==="SB光・AIR"?combined:0])
);
const bind=(companyId,productId,hubProductId)=>({
 companyId,productId,hubProductId
});
function fixture(){
 const products=[
  {id:"nuro",companyId:HUB,name:"NURO",active:true},
  {id:"sbmnp",companyId:HUB,name:"SBMNP",active:true},
  {id:"combined",companyId:HUB,name:"SB光・AIR（旧合算）",active:true}
 ];
 const hub={
  id:HUB,ownerUid:OWNER,ownerProducts:products,
  visibility:{hubCompanyId:HUB,ownerUid:OWNER,version:2,
   enabledHubProductIds:products.map(x=>x.id),partnerOverrides:{}},
  catalog:{schema:"nico-reviewed-count-public-catalog-v1",
   hubCompanyId:HUB,ownerUid:OWNER,version:2,products},
  mapping:{hubCompanyId:HUB,ownerUid:OWNER,reviewedByUid:OWNER,
   active:true,version:1,bindings:[
    bind("partnerA","partnerSku01","nuro"),
    bind("partnerB","partnerSku01","nuro"),
    bind("partnerC","partnerSku01","nuro")
   ]}
 };
 // Synthetic layout only: 176+18+40=234, six NURO, 35 combined.
 const sources=[
  ["partnerA","staffA",makeCounts(5,153,18)],
  ["partnerB","staffB",makeCounts(0,13,5)],
  ["partnerC","staffC",makeCounts(1,27,12)]
 ];
 const companies=sources.map(([companyId,staffId,counts])=>{
  const totalCount=Object.values(counts).reduce((a,b)=>a+b,0);
  return {id:companyId,hubCompanyId:HUB,active:true,
   privateProducts:[],entries:[{id:DATE+"__"+staffId,companyId,
    hubCompanyId:HUB,date:DATE,staffId,version:1,counts,totalCount}]};
 });
 return {pseudonymKey:"synthetic_historical_test_only_never_live_20261123",
  proof:{serverVerified:true,snapshotConsistent:true,
   completeCompanies:true,completeRelations:true,completeEntries:true,
   completePrivateProducts:true,completeReports:true,
   completeOwnerProducts:true,completeSettings:true,
   readTime:"2026-11-22T13:02:42.071Z"},
  hubs:[hub],companies,
  relations:companies.map(({id})=>({
   hubCompanyId:HUB,partnerCompanyId:id,active:true,countSharingApproved:true
  })),
  reports:companies.map(({id,entries})=>({
   kind:"staff",hubCompanyId:HUB,partnerCompanyId:id,date:DATE,
   source:"staff-entries-v1",counts:entries[0].counts,
   totalCount:entries[0].totalCount
  }))
 };
}
const ownerCatalog=input=>({
 schema:"nico-hub-product-visibility-v1",
 hubCompanyId:HUB,role:"hub_owner",
 version:input.hubs[0].visibility.version,partnerOverrides:{},
 products:input.hubs[0].ownerProducts.map(p=>({
  id:p.id,name:p.name,active:p.active,enabled:true
 }))
});
const ownerMap=input=>({
 schema:"nico-owner-reviewed-sku-map-v1",hubCompanyId:HUB,
 version:input.hubs[0].mapping.version,
 bindings:structuredClone(input.hubs[0].mapping.bindings)
});

test("synthetic 234-count original inventory is 6 mapped + 228 held, with 35 combined preserved",()=>{
 const input=fixture(),before=structuredClone(input);
 const result=inventoryPartnerFullHistory(input);
 assert.equal(result.originalTotalCount,234);
 assert.equal(result.mappedTotalCount,6);
 assert.equal(result.heldTotalCount,228);
 assert.deepEqual(result.heldCountsByReason,{held_unmapped:228});
 assert.equal(result.legacyCombinedSourceCountsByKind[0].count,35);
 assert.equal(result.overlapDayCount,0);
 assert.equal(result.summaryMismatchDayCount,0);
 assert.deepEqual(input,before,"read-only audit must not mutate original reports");
 assert.equal(result.historicalWrites,0);
 assert.equal(result.mappingWrites,0);
});

test("Owner-review one company then verified rollout links all synthetic history without modifying source ledger",async()=>{
 const input=fixture();
 const original=structuredClone({
  companies:input.companies,relations:input.relations,reports:input.reports,
  ownerProducts:input.hubs[0].ownerProducts,visibility:input.hubs[0].visibility
 });
 // Simulate two explicit, separately audited Owner approvals in company A.
 // This is NOT an automatic name-match or a production write.
 input.hubs[0].mapping.bindings.push(
  bind("partnerA","partnerSku02","sbmnp"),
  bind("partnerA","partnerSku05","combined")
 );
 input.hubs[0].mapping.version=3;
 const afterOwnerReview=inventoryPartnerFullHistory(input);
 assert.equal(afterOwnerReview.originalTotalCount,234);
 assert.equal(afterOwnerReview.mappedTotalCount,177);
 assert.equal(afterOwnerReview.heldTotalCount,57);

 const preview=planOwnerReviewedSkuRollout({
  mapping:ownerMap(input),catalog:ownerCatalog(input),
  sourceCompanyId:"partnerA",targetCompanyIds:["partnerB","partnerC"]
 });
 assert.equal(preview.totalApply,4,"only two newly approved SKUs for two companies");
 assert.equal(preview.totalExisting,2,"all existing NURO mappings unchanged");
 assert.equal(preview.totalConflicts,0);
 assert.equal(preview.totalOff,0);
 assert.deepEqual(preview.plans.map(p=>p.apply.map(x=>x.partnerProductId)),[
  ["partnerSku02","partnerSku05"],["partnerSku02","partnerSku05"]
 ]);
 assert.equal(inventoryPartnerFullHistory(input).mappedTotalCount,177,
  "preview never changes reported or mapped counts");

 const auth={currentUser:{uid:"ownerUser",emailVerified:true,
  getIdToken:async()=>"synthetic-not-real-auth-token-12345"}};
 let mappingWrites=0;
 const applied=await applyOwnerReviewedSkuRollout({
  confirmed:true,plan:preview,auth,
  readMappings:async()=>ownerMap(input),
  readProducts:async()=>ownerCatalog(input),
  saveMapping:async({partnerCompanyId,partnerProductId,
   hubProductId,expectedVersion})=>{
   const mapping=input.hubs[0].mapping;
   assert.equal(expectedVersion,mapping.version);
   assert(!mapping.bindings.some(x=>x.companyId===partnerCompanyId&&
    x.productId===partnerProductId),"must not overwrite a historical mapping");
   mapping.bindings.push(bind(partnerCompanyId,partnerProductId,hubProductId));
   mapping.version++;mappingWrites++;
   return {saved:true,version:mapping.version,partnerCompanyId,
    partnerProductId,hubProductId};
  }
 });
 assert.deepEqual(applied,{status:"verified",verified:4,planned:4});
 assert.equal(mappingWrites,4);
 assert.deepEqual({
  companies:input.companies,relations:input.relations,reports:input.reports,
  ownerProducts:input.hubs[0].ownerProducts,visibility:input.hubs[0].visibility
 },original,"historical source rows, prices and publication must remain untouched");

 const reconciled=inventoryPartnerFullHistory(input);
 assert.equal(reconciled.originalTotalCount,234);
 assert.equal(reconciled.mappedTotalCount,234);
 assert.equal(reconciled.heldTotalCount,0);
 assert.deepEqual(reconciled.heldCountsByReason,{});
 assert.equal(reconciled.legacyCombinedSourceCountsByKind[0].count,35,
  "old 光/AIR is never split into inferred standalone products");
 assert.equal(reconciled.reportCount,3);
 assert.equal(reconciled.originalEntryCount,3);
 assert.equal(reconciled.historicalWrites,0);
 assert.equal(reconciled.productionDocumentWrites,0);
 assert.equal(reconciled.safeToEnableRanking,false,
  "passing a synthetic inventory never authorizes production deployment");
});
