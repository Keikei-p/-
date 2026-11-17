import test from "node:test";
import assert from "node:assert/strict";
import {linkAllRegisteredCountsWithoutSetup}
 from "../ranking/zero-setup-count-linker.mjs";
import {PARTNER_RANK_SKUS}
 from "../ranking/partner-workspace-count-source.mjs";
const TIME="2026-11-17T09:00:00.000Z";
const hubProducts=[
 {companyId:"hub",sourceId:"nuro",name:"NURO光",active:true,sortOrder:0},
 {companyId:"hub",sourceId:"air",name:"SoftBank Air",active:true,sortOrder:1},
 {companyId:"hub",sourceId:"combined",name:"SB光・AIR（旧合算・未分類）",active:true,sortOrder:2},
 {companyId:"hub",sourceId:"mnp",name:"SoftBank MNP",active:true,sortOrder:3}
];
function fixture(){
 const hubSource={companyId:"hub",kind:"own",consentVerified:true,
  isComplete:true,readTime:TIME,products:structuredClone(hubProducts)};
 const partnerSources=["partner1","partner2","partner3"].map(companyId=>({
  companyId,kind:"partner",consentVerified:true,isComplete:true,readTime:TIME,
  products:PARTNER_RANK_SKUS.map(p=>({companyId,sourceId:p.id,name:p.name,active:true}))
 }));
 return {hubCompanyId:"hub",hubSource,partnerSources};
}
test("all 3 partner companies x 9 saved SKU categories remain ranked, even with zero mapping documents",()=>{
 const f=fixture(),actual=linkAllRegisteredCountsWithoutSetup(f);
 assert.equal(actual.length,4+3*9);
 assert.equal(actual.filter(x=>x.companyId!=="hub").length,27);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku01")
  .map(x=>x.groupId),["nuro","nuro","nuro"]);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku02")
  .map(x=>x.groupId),["mnp","mnp","mnp"]);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku05")
  .map(x=>x.groupId),["combined","combined","combined"]);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku09")
  .map(x=>x.groupId),[
   "partnerUnmatched:partnerSku09",
   "partnerUnmatched:partnerSku09",
   "partnerUnmatched:partnerSku09"
  ]);
 assert.deepEqual(f.hubSource.products,hubProducts,
  "original owner products and stored counts never mutated");
 assert(!/(unitPrice|revenue|cashback|売上|単価)/i.test(JSON.stringify(actual)));
});
test("ambiguous same-named hub products do not guess a master product",()=>{
 const f=fixture();
 f.hubSource.products.push({companyId:"hub",sourceId:"nuro2",
  name:"NURO",active:true,sortOrder:9});
 const result=linkAllRegisteredCountsWithoutSetup(f);
 assert(result.filter(x=>x.productId==="partnerSku01"&&x.companyId!=="hub")
  .every(x=>x.groupId==="partnerUnmatched:partnerSku01"),
  "two legitimate hub products are never merged by a guess");
});
test("legacy combined 光/AIR never silently splits into separate Hikari or Air",()=>{
 const f=fixture();
 f.hubSource.products=f.hubSource.products.filter(p=>p.sourceId!=="combined");
 const result=linkAllRegisteredCountsWithoutSetup(f);
 assert(result.filter(x=>x.productId==="partnerSku05")
  .every(x=>x.groupId==="partnerUnmatched:partnerSku05"));
 assert(!result.some(x=>x.productId==="partnerSku05"&&x.groupId==="air"));
});
test("active products with nonmatching names remain separate, not suppressed by an old OFF setting",()=>{
 const f=fixture();
 f.hubSource.products.push({companyId:"hub",sourceId:"new-2026",
  name:"新規商材",active:true,sortOrder:4});
 const result=linkAllRegisteredCountsWithoutSetup(f);
 assert(result.some(x=>x.companyId==="hub"&&x.productId==="new-2026"));
 assert(result.filter(x=>x.companyId==="partner1").length===9);
});
test("invalid source identities, amount-coded labels, private unknown partner SKUs are refused",()=>{
 const mutators=[
  x=>{x.partnerSources[0].readTime="2026-11-17T09:01:00.000Z"},
  x=>{x.partnerSources[0].companyId="hub"},
  x=>{x.partnerSources[1].companyId=x.partnerSources[0].companyId},
  x=>{x.partnerSources[0].consentVerified=false},
  x=>{x.hubSource.products[0].name="NURO単価12000"},
  x=>{x.partnerSources[0].products[0].name="収益Nuro"},
  x=>{x.partnerSources[0].products[0].sourceId="privateSku"},
  x=>{x.partnerSources[0].products[0].name="U-NEXT"},
  x=>{x.hubSource.products[1].sourceId=x.hubSource.products[0].sourceId}
 ];
 for(const mutate of mutators){
  const f=fixture();mutate(f);
  assert.throws(()=>linkAllRegisteredCountsWithoutSetup(f),
   /ZERO_SETUP_COUNT_SOURCE_UNVERIFIED|FINANCIAL/);
 }
});

test("same actual 3-company ledger produces matching joint company, team, person and product rankings",async()=>{
 const {buildVerifiedCountDashboard}=await import(
  "../ranking/verified-dual-count-dashboards.mjs");
 const fixtureData=fixture(),day="2026-11-17";
 const ids=["hub","partner1","partner2","partner3"];
 const totals=[2,5,5,0];
 const sourceOf=(companyId,n)=>({
  companyId,companyLabel:companyId==="hub"?"自社":companyId,
  kind:companyId==="hub"?"own":"partner",
  consentVerified:true,isComplete:true,readTime:TIME,
  completeWindows:{current:true,previous:false},
  teams:[{id:"team1",name:"第一班",goalCount:null}],
  roster:[{uid:"staff1",name:companyId+"担当",teamId:"team1"}],
  records:[{companyId,sourceId:day+"_"+companyId,uid:"staff1",
   teamId:"team1",date:day,totalCount:n,
   reportStatus:n===0?"no_result":"submitted",
   memberNameSnapshot:companyId+"担当",
   teamNameSnapshot:"第一班",workLocation:""}],
  lines:n>0?[{companyId,recordId:day+"_"+companyId,
   sourceId:day+"_line_"+companyId,
   uid:"staff1",teamId:"team1",date:day,
   productId:companyId==="hub"?"nuro":"partnerSku01",count:n}]:[],
  products:companyId==="hub"?structuredClone(hubProducts):
   PARTNER_RANK_SKUS.map(p=>({companyId,sourceId:p.id,
    name:p.name,active:true,sortOrder:0}))
 });
 const sources=ids.map((id,i)=>sourceOf(id,totals[i]));
 const productGroups=linkAllRegisteredCountsWithoutSetup({
  ...fixtureData,hubSource:sources[0],partnerSources:sources.slice(1)
 });
 const common={hubCompanyId:"hub",approvedCompanyIds:ids,
  sources,productGroups,unassigned:[],personGoals:[],historicalBest:[],
  period:{kind:"day",day,asOf:day}};
 const roleContext=(role)=>({
  serverVerified:true,userActive:true,memberActive:true,
  companyActive:true,activeCountSharingVerified:true,
  completeSnapshotBudgetApproved:true,viewerUid:role==="hub_owner"?
   "owner":"partner1Owner",
  viewerCompanyId:role==="hub_owner"?"hub":"partner1",
  hubCompanyId:"hub",approvedCompanyIds:ids,role,
  publicNameCompanyIds:["hub","partner1","partner2","partner3"]
 });
 const views=["hub_owner","partner_owner"].map(role=>
  buildVerifiedCountDashboard({...common,context:roleContext(role)}));
 for(const view of views){
  const products=view.role==="hub_owner"?view.productRanking:
   view.publicRanking.products;
  const nuro=products.find(x=>x.name==="NURO光");
  assert(nuro,"all three companies share the existing product label");
  assert.equal(nuro.count,12);
  assert.equal(nuro.rank,1);
  assert(!/unitPrice|revenue|cashback|salary|[¥￥]/i.test(JSON.stringify(view)));
 }
 const owner=views[0],partner=views[1];
 assert.equal(owner.summary.total,12);
 assert.equal(owner.summary.own,2);
 assert.equal(owner.summary.partner,10);
 assert.deepEqual(owner.companyBreakdown.filter(x=>x.count>0)
  .map(x=>x.count).sort((a,b)=>a-b),[2,5,5]);
 assert.deepEqual(owner.teamBreakdown.filter(x=>x.count>0)
  .map(x=>x.count).sort((a,b)=>a-b),[2,5,5]);
 assert(owner.memberRanking.some(x=>x.count===0&&x.rank===null),
  "unreported staff are not ranked; submitted zero may be ranked");
 assert.deepEqual(partner.publicRanking.products.map(x=>[x.name,x.count]),
  owner.productRanking.map(x=>[x.name,x.count]));
 assert(!("companyBreakdown" in partner));
});
