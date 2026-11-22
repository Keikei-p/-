import test from "node:test";
import assert from "node:assert/strict";
import {inventoryPartnerFullHistory,LEGACY_PARTNER_CATEGORIES as KEYS}
 from "../ranking/partner-full-history-inventory.mjs";

const key="one_inventory_only_private_pseudonym_seed";
const counts=(nuro=0,sb=0)=>Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?nuro:k==="SB光・AIR"?sb:0]));
const product=(id,name)=>({id,companyId:"hub_private_id",name,active:true});
const proof=()=>({serverVerified:true,snapshotConsistent:true,completeCompanies:true,
 completeRelations:true,completeEntries:true,completePrivateProducts:true,completeReports:true,
 completeOwnerProducts:true,completeSettings:true,readTime:"2026-11-17T00:00:00.000Z"});
export function historicalFixture(){
 const products=[product("nuro_private_id","NURO"),product("combined_private_id","SB光・AIR（旧合算）"),
  product("custom_private_id","独自サービス"),product("addon_private_id","新規商材"),product("air_private_id","SoftBank Air")];
 const entry={id:"2026-10-01__staff_private_id",companyId:"partner_private_id",hubCompanyId:"hub_private_id",
  date:"2026-10-01",staffId:"staff_private_id",version:1,counts:counts(3,2),totalCount:5,
  privateCounts:{private_sku_id:4},privateTotalCount:4,
  publishedCounts:{addon_private_id:5},publishedTotalCount:5,
  writerEmail:"never-log@example.invalid",unitPrice:123456789};
 return {pseudonymKey:key,proof:proof(),hubs:[{id:"hub_private_id",ownerUid:"owner_private_uid",ownerProducts:products,
  visibility:{hubCompanyId:"hub_private_id",ownerUid:"owner_private_uid",version:2,
   enabledHubProductIds:products.map(p=>p.id),partnerOverrides:{}},
  catalog:{schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub_private_id",
   ownerUid:"owner_private_uid",version:2,products},
  mapping:{hubCompanyId:"hub_private_id",ownerUid:"owner_private_uid",reviewedByUid:"owner_private_uid",
   active:true,version:1,bindings:[
    {companyId:"partner_private_id",productId:"partnerSku01",hubProductId:"nuro_private_id"},
    {companyId:"partner_private_id",productId:"partnerSku05",hubProductId:"combined_private_id"}
   ]}}],companies:[{id:"partner_private_id",hubCompanyId:"hub_private_id",active:true,
  privateProducts:[{id:"private_sku_id",companyId:"partner_private_id",name:"独自サービス",active:true,
   origin:"partner_custom",visibility:"private"}],entries:[entry]}],
  relations:[{hubCompanyId:"hub_private_id",partnerCompanyId:"partner_private_id",active:true,countSharingApproved:true}],
  reports:[{kind:"staff",hubCompanyId:"hub_private_id",partnerCompanyId:"partner_private_id",
   date:entry.date,source:"staff-entries-v1",counts:counts(3,2),totalCount:5,
   publishedCounts:{addon_private_id:5},publishedTotalCount:5}]};
}

test("full history conserves fixed, private and exact published counts without changing originals",()=>{
 const input=historicalFixture(),before=structuredClone(input),r=inventoryPartnerFullHistory(input);
 assert.deepEqual(input,before);
 assert.equal(r.completeSnapshot,true);
 assert.equal(r.sourceConservationVerified,true);
 assert.equal(r.combinedCountReconciled,true);
 assert.equal(r.originalTotalCount,14);
 assert.equal(r.mappedTotalCount,10);
 assert.equal(r.heldTotalCount,4);
 assert.deepEqual(r.heldCountsByReason,{held_unmapped:4},
  "read-only root cause must preserve full held count without product identities");
 assert.equal(r.originalTotalCount,r.mappedTotalCount+r.heldTotalCount);
 assert.equal(r.originalEntryCount,1);
 assert.equal(r.companies[0].products.find(p=>p.sourceKind==="ledger_published").mappedCount,5);
 assert.equal(r.companies[0].products.find(p=>p.sourceKind==="ledger_private").heldCount,4);
 assert(r.companies[0].products.every(p=>p.originalCount===p.mappedCount+p.heldCount));
 for(const k of ["historicalWrites","mappingWrites","productionDocumentWrites","candidateMappingsApplied"])
  assert.equal(r[k],0,k);
 assert.equal(r.safeToEnableRanking,false);
 const result=JSON.stringify(r);
 assert.doesNotMatch(result,/hub_private_id|partner_private_id|staff_private_id|owner_private_uid|private_sku_id|nuro_private_id|123456789|never-log|独自サービス|新規商材/);
});

test("exact names are candidates only; reviewed private ID mapping is separately required",()=>{
 const input=historicalFixture(),r=inventoryPartnerFullHistory(input);
 const p=r.companies[0].products.find(p=>p.sourceKind==="ledger_private");
 assert.equal(p.exactNameCandidates.length,1);
 assert.equal(p.candidateOnly,true);
 assert.equal(p.mappedCount,0);
 input.hubs[0].mapping.bindings.push({companyId:"partner_private_id",productId:"private_sku_id",hubProductId:"custom_private_id"});
 const matched=inventoryPartnerFullHistory(input);
 assert.equal(matched.originalTotalCount,14);
 assert.equal(matched.mappedTotalCount,14);
 assert.equal(matched.heldTotalCount,0);
 assert.deepEqual(matched.heldCountsByReason,{},
  "approved mapping never leaves unexplained held counts");
 assert.equal(matched.candidateMappingsApplied,0,"inventory still performs no mapping writes");
});

test("global and company OFF hold every historical source unchanged",()=>{
 const input=historicalFixture();
 input.hubs[0].visibility.partnerOverrides.partner_private_id=["nuro_private_id"];
 const r=inventoryPartnerFullHistory(input);
 assert.equal(r.originalTotalCount,14);
 assert.equal(r.mappedTotalCount,3);
 assert.equal(r.heldTotalCount,11);
 assert.equal(r.legacyCombinedSourceCountsByKind.find(s=>s.sourceKind==="ledger_legacy").count,2);
 input.hubs[0].visibility.enabledHubProductIds=[];
 const allOff=inventoryPartnerFullHistory(input);
 assert.equal(allOff.originalTotalCount,14);
 assert.equal(allOff.mappedTotalCount,0);
 assert.equal(allOff.heldTotalCount,14);
 assert.deepEqual(allOff.heldCountsByReason,{held_off:10,held_unmapped:4},
  "OFF-held and unmapped-held must be independent, with exact conservation");
});

test("quick/staff overlap is held as separate sources; no chosen or summed grand count",()=>{
 const input=historicalFixture();
 input.reports.push({kind:"quick",date:"2026-10-01",hubCompanyId:"hub_private_id",
  partnerCompanyId:"partner_private_id",version:1,counts:counts(4,1),totalCount:5});
 const r=inventoryPartnerFullHistory(input),c=r.companies[0];
 assert.equal(r.overlapDayCount,1);
 assert.equal(r.sourceConservationVerified,true);
 assert.equal(r.combinedCountReconciled,false);
 assert.equal(r.originalTotalCount,null);assert.equal(r.mappedTotalCount,null);assert.equal(r.heldTotalCount,null);
 assert.equal(r.heldCountsByReason,null,"overlap cannot be reported as an additive root cause");
 assert.deepEqual(r.nonOverlappingSourceCounts,{originalCount:0,mappedCount:0,heldCount:0});
 assert.equal(c.conflicts[0].combinedCount,null);
 assert.equal(c.conflicts[0].ledgerLegacyCount,5);
 assert.equal(c.conflicts[0].ledgerPrivateCount,4);
 assert.equal(c.conflicts[0].ledgerPublishedCount,5);
 assert.equal(c.conflicts[0].quickLegacyCount,5);
 assert(c.products.every(p=>p.state==="held_overlap"&&p.mappedCount===0&&p.heldCount===p.originalCount));
 assert.deepEqual(r.legacyCombinedSourceCountsByKind,[{sourceKind:"ledger_legacy",count:2},{sourceKind:"quick_legacy",count:1}]);
});

test("disjoint old quick report keeps company-only counts and old combined bucket",()=>{
 const input=historicalFixture();
 input.reports.push({kind:"quick",date:"2026-09-30",hubCompanyId:"hub_private_id",
  partnerCompanyId:"partner_private_id",version:1,counts:counts(4,1),totalCount:5});
 const r=inventoryPartnerFullHistory(input);
 assert.equal(r.originalTotalCount,19);assert.equal(r.mappedTotalCount,15);assert.equal(r.heldTotalCount,4);
 assert(r.companies[0].products.some(p=>p.month==="2026-09"&&p.sourceKind==="quick_legacy"&&p.legacyCombined&&p.originalCount===1));
 assert.doesNotMatch(JSON.stringify(r),/staff_private_id|staffId|teamId/);
});

test("legacy combined cannot map to independent Air; stale catalog never authorizes any count",()=>{
 const input=historicalFixture();
 input.hubs[0].mapping.bindings[1].hubProductId="air_private_id";
 const r=inventoryPartnerFullHistory(input);
 assert.equal(r.mappedTotalCount,8);
 assert(r.companies[0].products.some(p=>p.legacyCombined&&p.state==="held_legacy_combined"&&p.heldCount===2));
 input.hubs[0].catalog.version++;
 const stale=inventoryPartnerFullHistory(input);
 assert.equal(stale.originalTotalCount,14);assert.equal(stale.mappedTotalCount,0);assert.equal(stale.heldTotalCount,14);
 assert(stale.blockingReasons.includes("PUBLICATION_UNVERIFIED"));
});

test("missing and inconsistent summaries stop combined proof without losing ledger counts",()=>{
 for(const change of [x=>{x.reports=[];},x=>{x.reports[0].counts=counts(9,2);x.reports[0].totalCount=11;}]){
  const input=historicalFixture();change(input);
  const r=inventoryPartnerFullHistory(input);
  assert.equal(r.originalTotalCount,null);
  assert.equal(r.summaryMismatchDayCount,1);
  assert.equal(r.companies[0].sourceConservationVerified,true);
  assert.equal(r.nonOverlappingSourceCounts.originalCount,14);
  assert.equal(r.nonOverlappingSourceCounts.mappedCount,0);
  assert.equal(r.nonOverlappingSourceCounts.heldCount,14);
 }
});

test("orphan staff summary is retained as separate evidence and never made into an entry",()=>{
 const input=historicalFixture();input.companies[0].entries=[];
 const r=inventoryPartnerFullHistory(input),c=r.companies[0];
 assert.equal(r.originalEntryCount,0);assert.equal(r.originalTotalCount,null);
 assert.equal(c.summaryMismatchDayCount,1);assert.equal(c.products.length,0);
 assert.deepEqual(c.summaryMismatches,[{date:"2026-10-01",combinedCount:null,
  originalEntryCount:0,ledgerLegacyCount:0,ledgerPublishedCount:0,staffSummaryPresent:true,
  staffSummaryLegacyCount:5,staffSummaryPublishedCount:5}]);
});

test("same target from separate count source namespaces is held without summing business totals",()=>{
 const input=historicalFixture();
 input.companies[0].entries[0].publishedCounts={nuro_private_id:5};
 input.reports[0].publishedCounts={nuro_private_id:5};
 const r=inventoryPartnerFullHistory(input),c=r.companies[0];
 assert.equal(r.productSourceOverlapDayCount,1);assert.equal(r.originalTotalCount,null);
 assert(c.products.every(p=>p.state==="held_overlap"&&p.mappedCount===0));
 assert.equal(c.conflicts[0].quickStaffOverlap,false);
 assert.equal(c.conflicts[0].productSourceOverlap,true);
 assert.equal(c.conflicts[0].targetProductRefs.length,1);
 assert.equal(c.conflicts[0].combinedCount,null);
});

test("unreported and reported zero stay distinct; no invented missing day zero",()=>{
 const input=historicalFixture(),entry=input.companies[0].entries[0];
 entry.counts=counts();entry.totalCount=0;entry.privateCounts={};entry.privateTotalCount=0;
 entry.publishedCounts={};entry.publishedTotalCount=0;
 input.reports[0].counts=counts();input.reports[0].totalCount=0;
 input.reports[0].publishedCounts={};input.reports[0].publishedTotalCount=0;
 const r=inventoryPartnerFullHistory(input);
 assert.equal(r.companies[0].reportedZeroEntryCount,1);assert.equal(r.originalTotalCount,0);
 input.companies[0].entries=[];input.reports=[];
 const empty=inventoryPartnerFullHistory(input);
 assert.equal(empty.companies[0].reportedZeroEntryCount,0);
 assert.deepEqual(empty.companies[0].products,[]);
});

test("incomplete proof, duplicate originals, corrupt totals and unsafe count IDs fail closed",()=>{
 for(const change of [
  x=>{x.proof.completeEntries=false;},x=>{x.proof.snapshotConsistent=false;},
  x=>{x.companies[0].entries.push(structuredClone(x.companies[0].entries[0]));},
  x=>{x.companies[0].entries[0].publishedTotalCount=1;},
  x=>{x.companies[0].entries[0].counts.NURO=-1;},
  x=>{x.companies[0].entries[0].privateCounts=JSON.parse('{"__proto__":1}');},
  x=>{x.companies[0].entries[0].id="forged";}
 ]){const input=historicalFixture();change(input);assert.throws(()=>inventoryPartnerFullHistory(input),/^Error: PARTNER_FULL_HISTORY_/);}
});
