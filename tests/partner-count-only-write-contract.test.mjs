import test from "node:test";
import assert from "node:assert/strict";
import {planNewPartnerCount,planPartnerCountCorrection}
 from "../partner/count-only-write-contract.mjs";

const principal={
 serverVerified:true,tokenVerified:true,userActive:true,memberActive:true,
 companyActive:true,companyKind:"partner",accessKind:"partner",
 partnerRelationApproved:true,canSubmit:true,
 uid:"worker1",companyId:"partner1",teamIds:["team1"]
};
const catalog=[
 {catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
 {catalogId:"shared:hub:energy",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
 {catalogId:"custom:partner1:internal",ownerCompanyId:"partner1",active:true,visibility:"private"}
];
const request={date:"2026-10-29",teamId:"team1",status:"submitted",
 lines:[{catalogId:"shared:hub:NURO",count:2},
   {catalogId:"custom:partner1:internal",count:3}]};
const base={principal,catalog,request,serverRecordId:"pc_fixture00001",
 memberName:"登録者A",teamName:"協力店1班"};
const create=options=>planNewPartnerCount(options);
const denied=changes=>assert.throws(()=>create({...base,...changes}),
 /Count-only submission denied|Public document/);
test("shared 2, private 3: partner sees 5 but hub gets only approved 2",()=>{
 const result=create(base);
 assert.equal(result.action,"create_only");
 assert.equal(result.privateCollection,"partnerCountRecords");
 assert.equal(result.privateRecord.totalCount,5);
 assert.equal(result.privateRecord.sharedCount,2);
 assert.equal(result.publicHeader.totalCount,2);
 assert.equal(result.publicLines.length,1);
 assert.equal(result.publicLines[0].productId,"shared:hub:NURO");
 assert.equal(result.publicLines[0].count,2);
 assert.deepEqual(result.sourceChanges,[]);
 assert.equal(result.transactionRequired,true);
 const payload=JSON.stringify(result);
 for(const term of ["revenue","unitPrice","pricingOptions","cashback","totalRevenue"])
   assert.equal(payload.includes(term),false);
});
test("private-only activity is invisible to hub even as zero count row",()=>{
 const req={...request,lines:[{catalogId:"custom:partner1:internal",count:6}]};
 const result=create({...base,request:req});
 assert.equal(result.privateRecord.totalCount,6);
 assert.equal(result.publicHeader,null);
 assert.deepEqual(result.publicLines,[]);
});
test("explicit no-result can produce public submitted-zero marker",()=>{
 const req={...request,status:"no_result",lines:[]};
 const result=create({...base,request:req});
 assert.equal(result.privateRecord.totalCount,0);
 assert.equal(result.publicHeader.reportStatus,"no_result");
 assert.equal(result.publicHeader.totalCount,0);
 assert.deepEqual(result.publicLines,[]);
});
test("all financial/extra keys and client-controlled UID/role reject",()=>{
 for(const value of [
  {...request,revenue:999999},
  {...request,companyId:"hub"},
  {...request,uid:"owner"},
  {...request,lines:[{catalogId:"shared:hub:NURO",count:1,revenuePerUnit:20000}]},
  {...request,lines:[{catalogId:"shared:hub:NURO",count:1,cashback:1000}]},
  {...request,lines:[{catalogId:"shared:hub:NURO",count:2},{catalogId:"shared:hub:NURO",count:1}]},
  {...request,lines:[{catalogId:"shared:hub:NURO",count:-1}]},
  {...request,lines:[{catalogId:"shared:hub:NURO",count:1.5}]},
  {...request,lines:[{catalogId:"shared:hub:NURO",count:"2"}]},
  {...request,lines:[{catalogId:"invalid",count:2}]},
  {...request,teamId:"team2"}
 ])denied({request:value});
});
test("a partner owner or leader never receives finance role just by role label",()=>{
 for(const change of [
  {serverVerified:false},{tokenVerified:false},{memberActive:false},
  {userActive:false},{companyActive:false},{companyKind:"internal"},
  {accessKind:"internal"},{partnerRelationApproved:false},
  {canSubmit:false},{teamIds:["other"]},{teamIds:["team1","team1"]},
 ]){
  denied({principal:{...principal,companyRole:"owner",
   canViewRevenue:true,canViewUnitPrice:true,...change}});
 }
 const allowed=create({...base,principal:{...principal,companyRole:"owner",
  canViewRevenue:true,canViewUnitPrice:true}});
 assert.equal(allowed.privateRecord.totalCount,5);
 assert(!JSON.stringify(allowed).includes("canViewRevenue"));
});
test("private product is never available from other-company product catalog",()=>{
 const altered=catalog.map(x=>({...x}));
 altered[2].ownerCompanyId="otherCompany";
 denied({catalog:altered});
});
test("hidden inactive SKU, duplicate SKU or financial nested catalog fields fail",()=>{
 for(const alteration of [
  c=>{c[0].active=false;},
  c=>{c.push(c[0]);},
  c=>{c[0].pricingOptions=[{cashback:5000}]},
  c=>{c[0].revenue=10000},
  c=>{c[0].catalogId="NURO_CB20000";}
 ]){
  const altered=catalog.map(x=>({...x}));alteration(altered);
  denied({catalog:altered});
 }
});
test("correction appends independent event and keeps originally assigned team",()=>{
 const prior=create(base).privateRecord;
 const corrected={...request,lines:[
   {catalogId:"shared:hub:NURO",count:4},
   {catalogId:"custom:partner1:internal",count:1}
 ]};
 const plan=planPartnerCountCorrection({...base,request:corrected,
  previous:prior,expectedVersion:1,correctionId:"pcfix_fixture00001"});
 assert.equal(plan.action,"compare_and_swap_plus_append");
 assert.equal(plan.immutableCorrection.beforeCount,5);
 assert.equal(plan.immutableCorrection.afterCount,5);
 assert.equal(plan.immutableCorrection.beforeSharedCount,2);
 assert.equal(plan.immutableCorrection.afterSharedCount,4);
 assert.equal(plan.privateRecord.version,2);
 assert.equal(plan.privateRecord.teamId,"team1");
 assert.equal(plan.publicHeader.totalCount,4);
 assert.equal(plan.publicLines[0].count,4);
 assert.equal(prior.version,1);
 assert.equal(prior.sharedCount,2);
 assert.deepEqual(plan.sourceChanges,[]);
});
test("stale correction, other member, other team, other date and no-op are refused",()=>{
 const prior=create(base).privateRecord;
 const fixed={...base,previous:prior,expectedVersion:1,
  correctionId:"pcfix_fixture00002"};
 for(const change of [
  {expectedVersion:0},{previous:{...prior,version:2}},
  {previous:{...prior,companyId:"hub"}},
  {previous:{...prior,uid:"someoneElse"}},
  {previous:{...prior,teamId:"other"}},
  {request:{...request,date:"2026-10-28"}},
  {correctionId:"not_a_safe_id"}
 ]){
  assert.throws(()=>planPartnerCountCorrection({...fixed,...change}),
   /Count-only submission denied/);
 }
 assert.throws(()=>planPartnerCountCorrection(fixed),/denied/);
});
test("new/saved record paths never include raw products/records/recordCorrections",()=>{
 const registration=create(base);
 const before=create(base).privateRecord;
 const correction=planPartnerCountCorrection({...base,previous:before,
  expectedVersion:1,correctionId:"pcfix_test1",
  request:{...request,lines:[{catalogId:"shared:hub:energy",count:1}]}});
 for(const plan of [registration,correction]){
  assert.match(plan.privateCollection,/^partnerCountRecords$/);
  assert.deepEqual(plan.sourceChanges,[]);
  assert.equal(plan.transactionRequired,true);
  assert(JSON.stringify(plan).includes("publicHeader"));
 }
});

test("invalid dates never create count records (leap year guarded)",()=>{
 for(const date of ["2026-02-29","2026-02-30","2026-04-31",
                    "2026-13-01","not-a-date"]){
  denied({request:{...request,date}});
 }
 const allowed=create({...base,request:{...request,date:"2028-02-29"}});
 assert.equal(allowed.privateRecord.date,"2028-02-29");
});
