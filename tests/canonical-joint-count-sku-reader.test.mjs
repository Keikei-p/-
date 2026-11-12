import test from "node:test";
import assert from "node:assert/strict";
import {composeCanonicalMonthlyRankingInput,createCanonicalCountTransactionReader}
 from "../ranking/canonical-joint-count-sku-reader.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";
import {composeCanonicalMonthlyRankingInput as composeIsolatedRankingInput}
 from "../functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs";
import {readFileSync} from "node:fs";
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
test("two partners and hub share four exact ranks, ON/OFF and correction without double counting",()=>{
 const input=sources(),second=structuredClone(input.partnerSources[0]);
 second.companyId="partner2";second.companyLabel="協力店B";
 second.records[0].companyId="partner2";
 second.records[0].memberNameSnapshot="協力店員B";
 second.lines[0].companyId="partner2";
 second.products[0].companyId="partner2";
 // Same local staff/team/report IDs across the two companies are legal.
 assert.equal(second.records[0].uid,input.partnerSources[0].records[0].uid);
 assert.equal(second.records[0].teamId,input.partnerSources[0].records[0].teamId);
 const allPartners=[...input.partnerSources,second];
 const approved={...context,approvedCompanyIds:["hub","partner","partner2"]};
 const skuMap={...map,bindings:[
  ...map.bindings,
  {companyId:"partner2",productId:"partnerSku01",hubProductId:"nuro"}
 ]};
 const saved=structuredClone({input,allPartners,approved,skuMap});
 const canonical=composeCanonicalMonthlyRankingInput({
  context:approved,hubSource:input.hubSource,partnerSources:allPartners,
  skuMap,hubOwnerUid:"owner",month:"2026-11",serverAsOf:"2026-11-09"
 });
 const calculate=(role,publication)=>buildOwnerVisibleCountRanking({
  input:{...canonical,context:role},publication
 });
 const baseline=calculate(approved,pub(["nuro"]));
 assert.deepEqual(baseline.summary,{own:2,partner:10,total:12,unidentified:0});
 assert.equal(baseline.productRanking.length,1);
 assert.equal(baseline.productRanking[0].count,12);
 assert.deepEqual(baseline.productRanking[0].companies.map(x=>x.count)
  .sort((a,b)=>b-a),[5,5,2]);
 for(const [key,id] of [["companyBreakdown","id"],["teamBreakdown","companyId"]]){
  const partnerRanks=baseline[key].filter(r=>
   key==="companyBreakdown"?r.kind==="協力店":r.companyId!=="hub");
  assert.equal(partnerRanks.length,2);
  assert.deepEqual(partnerRanks.map(r=>r.count),[5,5]);
  assert(partnerRanks.every(r=>r.rank===1),
   "equal partner counts share rank 1 in "+key);
 }
 assert.equal(baseline.memberRanking.filter(r=>r.companyId!=="hub"&&r.rank===1).length,2);
 assert.equal(baseline.memberRanking.filter(r=>r.companyId!=="hub")
  .reduce((sum,r)=>sum+r.count,0),baseline.summary.partner);
 assert.equal(baseline.teamBreakdown.reduce((sum,r)=>sum+r.count,0),baseline.summary.total);
 assert.equal(baseline.companyBreakdown.reduce((sum,r)=>sum+r.count,0),baseline.summary.total);
 const partnerScope={...approved,role:"partner_owner",
  viewerUid:"partnerOwner",viewerCompanyId:"partner"};
 const partnerDashboard=calculate(partnerScope,pub(["nuro"]));
 assert.deepEqual(partnerDashboard.publicRanking.products.map(x=>x.count),[12]);
 assert.deepEqual(partnerDashboard.publicRanking.companies.map(x=>x.count),[5,5,2]);
 assert.deepEqual(partnerDashboard.publicRanking.teams.map(x=>x.count),[5,5,2]);
 assert.deepEqual(partnerDashboard.publicRanking.members.map(x=>x.count),[5,5,2]);
 assert(partnerDashboard.publicRanking.companies.slice(0,2).every(x=>x.rank===1));
 assert(partnerDashboard.publicRanking.members.slice(0,2).every(x=>x.rank===1));
 assert(!JSON.stringify(partnerDashboard).includes("revenue"));
 const gate={...pub(["nuro"]),partnerOverrides:[
  {companyId:"partner2",enabledHubProductIds:[]}
 ]};
 const hidden=calculate(approved,gate);
 assert.equal(hidden.summary.total,7);
 assert.equal(hidden.summary.partner,5);
 assert.equal(hidden.productRanking[0].count,7);
 assert.equal(hidden.companyBreakdown.find(x=>x.id==="partner2").rank,null);
 assert.equal(hidden.memberRanking.find(x=>x.companyId==="partner2").rank,null);
 const publicHidden=calculate(partnerScope,gate).publicRanking;
 assert(!publicHidden.companies.some(x=>x.name==="協力店B"));
 assert(!publicHidden.members.some(x=>x.company==="協力店B"));
 assert(!publicHidden.teams.some(x=>x.company==="協力店B"));
 const corrected=structuredClone(canonical);
 const updated=corrected.sources.find(x=>x.companyId==="partner2");
 updated.records[0].totalCount=6;
 updated.lines[0].count=6;
 const correctionResult=buildOwnerVisibleCountRanking({
  input:{...corrected,context:approved},publication:pub(["nuro"])
 });
 assert.deepEqual(correctionResult.summary,{own:2,partner:11,total:13,unidentified:0});
 assert.equal(correctionResult.productRanking[0].count,13);
 assert.equal(correctionResult.companyBreakdown.find(x=>x.id==="partner2").rank,1);
 assert.equal(correctionResult.memberRanking.find(x=>x.companyId==="partner2").count,6);
 assert.deepEqual({input,allPartners,approved,skuMap},saved,
  "read-only ranking, OFF and simulated correction never rewrite originals");
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
test("canonical and isolated count readers reject two partner SKUs sharing one hub product",()=>{
 const data=sources(),partner=data.partnerSources[0];
 partner.products.push({
  companyId:"partner",sourceId:"partnerSku02",
  name:"SBMNP",active:true,sortOrder:1
 });
 const invalid={...map,bindings:[
  {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
  {companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"}
 ]};
 const before=structuredClone({data,invalid});
 for(const reader of [composeCanonicalMonthlyRankingInput,composeIsolatedRankingInput]){
  assert.throws(()=>reader({
   context,...data,skuMap:invalid,hubOwnerUid:"owner",
   month:"2026-11",serverAsOf:"2026-11-09"
  }),/CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/,
  "duplicate destinations must never publish a double-counted ranking");
 }
 assert.deepEqual({data,invalid},before,
  "invalid mapping must not repair or mutate any source history");

 const valid={...invalid,bindings:[
  invalid.bindings[0],
  {...invalid.bindings[1],hubProductId:"air"}
 ]};
 for(const reader of [composeCanonicalMonthlyRankingInput,composeIsolatedRankingInput]){
  const result=reader({
   context,...data,skuMap:valid,hubOwnerUid:"owner",
   month:"2026-11",serverAsOf:"2026-11-09"
  });
  assert.equal(result.productGroups.filter(g=>g.companyId==="partner").length,2,
   "two distinct reviewed hub SKUs remain usable");
 }
});

test("canonical and isolated reader cannot drift without the CI failing",()=>{
 const root=readFileSync(new URL("../ranking/canonical-joint-count-sku-reader.mjs",import.meta.url),"utf8");
 const functions=readFileSync(new URL("../functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs",import.meta.url),"utf8");
 assert.equal(functions,root);
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
test("trusted Tokyo day prevents future month publication",()=>{
 assert.throws(()=>compose({serverAsOf:"2026-11-32"}),
  /CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED/);
});
