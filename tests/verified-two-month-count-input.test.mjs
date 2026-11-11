import test from "node:test";
import assert from "node:assert/strict";
import {mergeVerifiedTwoMonthInputs}
 from "../ranking/verified-two-month-count-input.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";

const TIME="2026-11-11T12:00:00.000Z";
const context={serverVerified:true,userActive:true,memberActive:true,
 companyActive:true,reciprocalOwnersApproved:true,
 completeSnapshotBudgetApproved:true,individualNamesApproved:true,
 viewerUid:"owner",viewerCompanyId:"hub",role:"hub_owner",
 hubCompanyId:"hub",approvedCompanyIds:["hub","partner"]};
const copy=x=>structuredClone(x);
const products=[{companyId:"hub",sourceId:"nuro",name:"NURO",active:true,sortOrder:0}];
function source(companyId,date,total){
 const own=companyId==="hub",sku=own?"nuro":"partnerSku01",
 teamId=own?"hubTeam":"partnerTeam",uid=own?"owner":"employee";
 const id=date+"_"+companyId;
 return {companyId,companyLabel:own?"本社":"承認済み協力店",
  kind:own?"own":"partner",consentVerified:true,isComplete:true,
  readTime:TIME,completeWindows:{current:true,previous:false},
  teams:[{id:teamId,name:"営業班",goalCount:null}],
  roster:[{uid,teamId,name:"担当者"}],
  products:own?copy(products):[{companyId,sourceId:sku,
   name:"NURO",active:true,sortOrder:0}],
  records:[{companyId,sourceId:id,uid,teamId,date,
   totalCount:total,reportStatus:"submitted",
   memberNameSnapshot:"担当者",teamNameSnapshot:"営業班",workLocation:""}],
  lines:[{companyId,sourceId:"line_"+id,recordId:id,
   uid,teamId,date,productId:sku,count:total}]};
}
const productGroups=[
 {companyId:"hub",productId:"nuro",groupId:"nuro",groupName:"NURO"},
 {companyId:"partner",productId:"partnerSku01",groupId:"nuro",groupName:"NURO"}
];
function monthly(month,day,counts,asOf){
 return {hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  sources:[source("hub",day,counts[0]),source("partner",day,counts[1])],
  productGroups:copy(productGroups),unassigned:[],personGoals:[],
  historicalBest:[],mappingsReviewed:true,snapshotReadTime:TIME,
  period:{kind:"month",day:month+"-01",asOf}};
}
const fixtures=()=>({
 primary:monthly("2026-11","2026-11-01",[3,2],"2026-11-11"),
 secondary:monthly("2026-10","2026-10-31",[4,5],"2026-10-31")
});
const publication={serverVerified:true,ownerSettingsRead:true,
 ownerUidVerified:true,productMappingsReviewed:true,
 hubCompanyId:"hub",revision:2,enabledHubProductIds:["nuro"],
 partnerOverrides:[]};
test("one verified readTime merges both original months exactly once and publishes full cross-month week",()=>{
 const args=fixtures(),snapshot=copy(args);
 const merged=mergeVerifiedTwoMonthInputs(args);
 assert.equal(merged.snapshotReadTime,TIME);
 assert.equal(merged.period.asOf,"2026-11-11");
 assert.deepEqual(merged.sources.map(s=>s.records.length),[2,2]);
 assert(merged.sources.every(s=>s.completeWindows.previous===true));
 const result=buildOwnerVisibleCountRanking({
  input:{...merged,context,period:{kind:"week",day:"2026-11-01",asOf:"2026-11-11"}},
  publication
 });
 assert.deepEqual(result.range.start,"2026-10-26");
 assert.equal(result.range.end,"2026-11-01");
 assert.deepEqual(result.summary,{own:7,partner:7,total:14,unidentified:0});
 assert.equal(result.productRanking[0].count,14);
 assert.equal(result.memberRanking.length,2);
 assert.deepEqual(args,snapshot,"read-only count projection must not alter histories");
 assert(!/revenue|unitPrice|cashback|totalRevenue/.test(JSON.stringify(result)));
});
test("old-month selected week includes newer month but no silently missing source",()=>{
 const {primary,secondary}=fixtures();
 const merged=mergeVerifiedTwoMonthInputs({primary:secondary,secondary:primary});
 const result=buildOwnerVisibleCountRanking({
  input:{...merged,context,period:{kind:"week",day:"2026-10-31",asOf:"2026-11-11"}},
  publication
 });
 assert.equal(result.summary.total,14);
 assert.equal(result.range.end,"2026-11-01");
});
test("tampered clock, scope, SKU mapping, duplicate record, and identities fail closed",()=>{
 const args=fixtures();
 const mutations=[
  x=>{x.secondary.snapshotReadTime="2026-11-11T12:00:01.000Z";},
  x=>{x.secondary.sources[1].readTime="2026-11-11T12:00:01.000Z";},
  x=>{x.secondary.approvedCompanyIds=["hub","foreign"];},
  x=>{x.secondary.productGroups.pop();},
  x=>{x.secondary.sources[0].records[0].sourceId="2026-11-01_hub";},
  x=>{x.secondary.sources[1].roster[0].name="別人";},
  x=>{x.secondary.sources[1].teams[0].name="別の班";},
  x=>{x.secondary.sources.pop();},
  x=>{x.secondary.period.day="2026-09-01";},
  x=>{x.secondary.sources[0].records[0].date="2026-11-01";}
 ];
 for(const mutate of mutations){
  const value=copy(args);mutate(value);
  assert.throws(()=>mergeVerifiedTwoMonthInputs(value),
   /VERIFIED_TWO_MONTH_COUNTS_UNVERIFIED/);
 }
});
test("nonadjacent months are never treated as a complete seven-day window",()=>{
 const x=fixtures();x.secondary.period.day="2026-09-01";
 x.secondary.period.asOf="2026-09-30";
 assert.throws(()=>mergeVerifiedTwoMonthInputs(x),
  /VERIFIED_TWO_MONTH_COUNTS_UNVERIFIED/);
});


test("Owner global OFF and partner override OFF never erase two months of historical count originals",()=>{
 const args=fixtures(),snapshot=copy(args),merged=mergeVerifiedTwoMonthInputs(args);
 const period={kind:"week",day:"2026-11-01",asOf:"2026-11-11"};
 const build=policy=>buildOwnerVisibleCountRanking({
  input:{...merged,context,period},publication:policy
 });
 const partnerOff=build({...publication,partnerOverrides:[
  {companyId:"partner",enabledHubProductIds:[]}
 ]});
 assert.deepEqual(partnerOff.summary,{own:7,partner:0,total:7,unidentified:0});
 assert.equal(partnerOff.productRanking[0].count,7);
 const globalOff=build({...publication,enabledHubProductIds:[]});
 assert.equal(globalOff.summary.total,0);
 const restored=build(publication);
 assert.deepEqual(restored.summary,{own:7,partner:7,total:14,unidentified:0});
 assert.deepEqual(args,snapshot,"visibility changes publish only; no original record is touched");
 assert.equal(merged.sources[1].records[0].totalCount,2);
 assert.equal(merged.sources[1].records[1].totalCount,5);
});
