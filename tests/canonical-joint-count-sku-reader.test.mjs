import test from "node:test";
import assert from "node:assert/strict";
import {composeCanonicalMonthlyRankingInput,createCanonicalCountTransactionReader}
 from "../ranking/canonical-joint-count-sku-reader.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";
const TIME="2026-11-09T00:00:00.000Z";
const context={serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",
 hubCompanyId:"hub",role:"hub_owner",approvedCompanyIds:["hub","partner"],
 individualNamesApproved:true,reciprocalOwnersApproved:true,
 completeSnapshotBudgetApproved:true,userActive:true,memberActive:true,
 companyActive:true};
function sources(){
 const hubSource={companyId:"hub",companyLabel:"本社",kind:"own",
  consentVerified:true,isComplete:true,readTime:TIME,
  completeWindows:{current:true,previous:false},
  teams:[{id:"team1",name:"広島班",goalCount:null}],
  roster:[{uid:"owner",teamId:"team1",name:"社員"}],
  records:[{companyId:"hub",sourceId:"r1",uid:"owner",date:"2026-11-09",
   teamId:"team1",totalCount:3,reportStatus:"submitted",
   memberNameSnapshot:"社員",teamNameSnapshot:"広島班",workLocation:""}],
  lines:[{companyId:"hub",recordId:"r1",sourceId:"l1",uid:"owner",
   teamId:"team1",date:"2026-11-09",productId:"nuro",count:2},
   {companyId:"hub",recordId:"r1",sourceId:"l2",uid:"owner",
    teamId:"team1",date:"2026-11-09",productId:"air",count:1}],
  products:[{companyId:"hub",sourceId:"nuro",name:"NURO光",active:true,sortOrder:1},
   {companyId:"hub",sourceId:"air",name:"SoftBank Air",active:true,sortOrder:2}]
 };
 const partner={companyId:"partner",companyLabel:"協力店",kind:"partner",
  consentVerified:true,isComplete:true,readTime:TIME,
  teams:[{id:"team2",name:"協力班",goalCount:null}],
  records:[{companyId:"partner",sourceId:"r2",uid:"p1",date:"2026-11-09",
   teamId:"team2",totalCount:5,reportStatus:"submitted",
   memberNameSnapshot:"協力店員",teamNameSnapshot:"協力班",workLocation:""}],
  lines:[{companyId:"partner",recordId:"r2",sourceId:"l3",uid:"p1",
   teamId:"team2",date:"2026-11-09",productId:"partnerSku01",count:5}],
  products:[{companyId:"partner",sourceId:"partnerSku01",
   name:"NURO",active:true,sortOrder:0}]
 };
 return {hubSource,partnerSources:[partner]};
}
const map={hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
 active:true,version:1,bindings:[{companyId:"partner",productId:"partnerSku01",
  hubProductId:"nuro"}]};
const compose=(more={})=>composeCanonicalMonthlyRankingInput({
 context,...sources(),skuMap:map,hubOwnerUid:"owner",
 month:"2026-11",serverAsOf:"2026-11-09",...more
});
const pub=enabledHubProductIds=>({serverVerified:true,ownerSettingsRead:true,
 ownerUidVerified:true,productMappingsReviewed:true,
 hubCompanyId:"hub",revision:1,enabledHubProductIds});
test("shared owner-reviewed exact product IDs drive company, individual and SKU totals",()=>{
 const input=compose(),before=structuredClone(input);
 assert.equal(input.sources.length,2);
 assert.deepEqual(input.productGroups.find(x=>x.companyId==="partner"),{
  companyId:"partner",productId:"partnerSku01",
  groupId:"nuro",groupName:"NURO光"
 });
 const on=buildOwnerVisibleCountRanking({input:{...input,context},publication:pub(["nuro"])});
 assert.deepEqual(on.summary,{own:2,partner:5,total:7,unidentified:0});
 assert.equal(on.productRanking[0].count,7);
 assert.equal(on.memberRanking.find(x=>x.id==="partner:p1").count,5);
 assert.equal(on.companyBreakdown.find(x=>x.id==="partner").count,5);
 const off=buildOwnerVisibleCountRanking({input:{...input,context},publication:pub([])});
 assert.equal(off.summary.total,0);
 const back=buildOwnerVisibleCountRanking({input:{...input,context},publication:pub(["nuro","air"])});
 assert.equal(back.summary.total,8);
 assert.deepEqual(input,before,"no source-count or original history may be changed");
 assert(!/revenue|cashback|unitPrice|totalRevenue/.test(JSON.stringify(input)));
});
test("same product names NEVER map two companies without explicit owner-reviewed binding",()=>{
 const noMap=compose({skuMap:{...map,bindings:[]}});
 const on=buildOwnerVisibleCountRanking({input:{...noMap,context},publication:pub(["nuro"])});
 assert.equal(on.summary.partner,0);
 assert.equal(on.summary.own,2);
});
test("unknown, overlapping, stale and unauthorized ID maps fail closed",()=>{
 const bad=[
  {...map,reviewedByUid:"attacker"},
  {...map,active:false},
  {...map,bindings:[{companyId:"other",productId:"partnerSku01",hubProductId:"nuro"}]},
  {...map,bindings:[{companyId:"partner",productId:"partnerSku99",hubProductId:"nuro"}]},
  {...map,bindings:[{companyId:"partner",productId:"partnerSku01",hubProductId:"fake"}]},
  {...map,bindings:[...map.bindings,...map.bindings]},
  {...map,bindings:[{companyId:"partner",productId:"partnerSku01",
    hubProductId:"nuro",price:10000}]}
 ];
 for(const skuMap of bad)assert.throws(()=>compose({skuMap}),
  /CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/);
});
test("old combined SB光/AIR counts cannot be silently mapped to separate Air or 光",()=>{
 const src=sources(),p=src.partnerSources[0];
 p.products[0].name="SB光・AIR（旧合算・未分類）";
 assert.throws(()=>compose({
  ...src,skuMap:{...map,bindings:[{companyId:"partner",
   productId:"partnerSku01",hubProductId:"air"}]}
 }),/CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/);
 const absent=compose({...src,skuMap:{...map,bindings:[]}});
 assert.equal(absent.productGroups.length,2);
});
test("duplicate company sources, partial monthly source and mismatched read time stop",()=>{
 const original=sources();
 for(const changed of [
  {partnerSources:[]},
  {partnerSources:[{...original.partnerSources[0],readTime:"2026-11-09T00:01:00Z"}]},
  {hubSource:{...original.hubSource,isComplete:false}},
  {serverAsOf:"2026-11-31"},
  {serverAsOf:"2026-12-01"},
  {context:{...context,serverVerified:false}}
 ])assert.throws(()=>compose(changed),
  /CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/);
});
test("partner activity includes authoritative member, no invented financial field",()=>{
 const input=compose();
 assert.deepEqual(input.sources[1].roster,
  [{uid:"p1",name:"協力店員",teamId:"team2"}]);
 assert.deepEqual(input.sources[1].completeWindows,
  {current:true,previous:false});
});
function fakeReader({noMapping=false,mixedTime=false}={}){
 const seen=[],timestamp={
  seconds:1794182400,nanoseconds:0,
  toDate:()=>new Date("2026-11-09T00:00:00.000Z")
 };
 const doc=(path)=>({path,collection:(name)=>collection(path+"/"+name)});
 const collection=path=>({
  path,doc:id=>doc(path+"/"+id)
 });
 const db={collection};
 const tx={async get(ref){
  seen.push(ref.path);
  if(ref.path==="companies/hub")return {
   exists:true,readTime:timestamp,data:()=>({
    ownerUid:"owner",active:true})};
  if(ref.path==="companies/hub/rankingSkuMappings/shared")return {
   exists:!noMapping,readTime:mixedTime?{...timestamp,
    toDate:()=>new Date("2026-11-09T00:01:00.000Z")}:timestamp,
   data:()=>map};
  throw Error("unexpected DB ref");
 }};
 return {db,tx,seen};
}
test("trusted transaction reader denies missing map without inventing SKU mapping",async()=>{
 const f=fakeReader({noMapping:true});
 // Actual internal + partner readers need full Firebase snapshots and will
 // fail before publication on this intentionally incomplete fake store.
 await assert.rejects(createCanonicalCountTransactionReader({db:f.db})({
  tx:f.tx,context,month:"2026-11"
 }));
 assert(f.seen.includes("companies/hub/rankingSkuMappings/shared"));
});
test("cross-month reader rejects nonadjacent or forged month BEFORE any Firestore read",async()=>{
 const f=fakeReader(),read=createCanonicalCountTransactionReader({db:f.db});
 for(const secondMonth of ["2026-11","2026-09","2026-13","2026-11-01","2027-01",null]){
  await assert.rejects(read({tx:f.tx,month:"2026-11",secondMonth,context}),
   /CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/);
  assert.deepEqual(f.seen,[],"no storage request may precede month validation");
 }
});
test("trusted Tokyo day prevents future month publication",()=>{
 assert.throws(()=>compose({serverAsOf:"2026-11-32"}),
  /CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/);
});
