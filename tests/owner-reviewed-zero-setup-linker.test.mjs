import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PARTNER_RANK_SKUS}
 from "../functions-ranking-approvals/ranking/partner-workspace-count-source.mjs";
import {linkAllRegisteredCountsWithoutSetup}
 from "../functions-ranking-approvals/ranking/zero-setup-count-linker.mjs";
import {composeCanonicalMonthlyRankingInput}
 from "../functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs";
import {buildVerifiedCountDashboard}
 from "../functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs";

const readTime="2026-11-21T11:50:20.527Z",month="2026-11";
const context={serverVerified:true,userActive:true,memberActive:true,
 companyActive:true,activeCountSharingVerified:true,
 individualNamesApproved:false,completeSnapshotBudgetApproved:true,
 viewerUid:"owner",viewerCompanyId:"hub",hubCompanyId:"hub",
 role:"hub_owner",approvedCompanyIds:["hub","partner"]};
function fixture(){
 const products=[
  {companyId:"hub",sourceId:"nuro",name:"NURO光",active:true,sortOrder:0},
  {companyId:"hub",sourceId:"special",name:"法人専用プラン",active:true,sortOrder:0},
  {companyId:"hub",sourceId:"combined",name:"SB光・AIR",active:true,sortOrder:0},
  {companyId:"hub",sourceId:"air",name:"SoftBank Air",active:true,sortOrder:0}
 ];
 const hubSource={companyId:"hub",companyLabel:"直営",kind:"own",
  consentVerified:true,isComplete:true,readTime,
  completeWindows:{current:true,previous:false},
  products,teams:[{id:"t1",name:"1班",goalCount:null}],
  roster:[],records:[],lines:[]};
 const partnerProducts=PARTNER_RANK_SKUS.map(p=>({
  companyId:"partner",sourceId:p.id,name:p.name,active:true,sortOrder:0
 }));
 const record={companyId:"partner",sourceId:"entry1",uid:"worker",
  date:"2026-11-21",teamId:"t1",totalCount:14,reportStatus:"submitted",
  memberNameSnapshot:"担当者",teamNameSnapshot:"1班",workLocation:""};
 const lines=[
  {companyId:"partner",sourceId:"line1",recordId:"entry1",uid:"worker",
   date:"2026-11-21",teamId:"t1",productId:"partnerSku01",count:3},
  {companyId:"partner",sourceId:"line2",recordId:"entry1",uid:"worker",
   date:"2026-11-21",teamId:"t1",productId:"partnerSku02",count:7},
  {companyId:"partner",sourceId:"line3",recordId:"entry1",uid:"worker",
   date:"2026-11-21",teamId:"t1",productId:"partnerSku05",count:4}
 ];
 const partnerSource={companyId:"partner",companyLabel:"協力店A",
  kind:"partner",consentVerified:true,isComplete:true,readTime,
  products:partnerProducts,teams:[{id:"t1",name:"1班",goalCount:null}],
  records:[record],lines};
 return {hubSource,partnerSource};
}
const binding=(productId,hubProductId)=>({
 companyId:"partner",productId,hubProductId
});
const reviewed=bindings=>({
 hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
 active:true,version:3,bindings
});
function compose({hubSource,partnerSource},skuMap=null){
 return composeCanonicalMonthlyRankingInput({
  context,hubSource,partnerSources:[partnerSource],skuMap,
  hubOwnerUid:"owner",month,serverAsOf:"2026-11-21",zeroSetupLink:true
 });
}
const groupsOf=(input,companyId="partner")=>Object.fromEntries(
 input.productGroups.filter(x=>x.companyId===companyId)
  .map(x=>[x.productId,x.groupId])
);
const sum=x=>x.reduce((n,r)=>n+r.count,0);
test("no reviewed SKU map is optional; all original count categories survive",()=>{
 const f=fixture(),before=structuredClone(f);
 const input=compose(f),map=groupsOf(input);
 assert.equal(map.partnerSku01,"nuro");
 assert.equal(map.partnerSku02,"partnerUnmatched:partnerSku02");
 assert.equal(map.partnerSku05,"combined");
 const dashboard=buildVerifiedCountDashboard({...input,context,
  period:{kind:"month",day:"2026-11-01",asOf:"2026-11-21"}});
 assert.equal(dashboard.summary.partner,14);
 assert.equal(dashboard.summary.total,14);
 assert.equal(sum(dashboard.productRanking),14);
 assert.deepEqual(f,before);
 assert(!/(?:unitPrice|revenue|cashback)/i.test(JSON.stringify(dashboard)));
});
test("existing exact Owner-reviewed SKU ID takes priority over missing aliases",()=>{
 const f=fixture(),before=structuredClone(f);
 const input=compose(f,reviewed([binding("partnerSku02","special")]));
 const map=groupsOf(input);
 assert.equal(map.partnerSku01,"nuro");
 assert.equal(map.partnerSku02,"special","Owner mapping may use a different display name");
 assert.equal(map.partnerSku05,"combined");
 const dashboard=buildVerifiedCountDashboard({...input,context,
  period:{kind:"month",day:"2026-11-01",asOf:"2026-11-21"}});
 assert.equal(sum(dashboard.productRanking),14);
 assert.equal(dashboard.productRanking.find(x=>x.id==="special").count,7);
 assert.equal(dashboard.productRanking.find(x=>x.id==="nuro").count,3);
 assert.equal(dashboard.productRanking.find(x=>x.id==="combined").count,4);
 assert.deepEqual(f,before);
});
test("pre-reserved Owner target stops a different alias from double-claiming it",()=>{
 const f=fixture(),input=compose(f,reviewed([binding("partnerSku02","nuro")]));
 const map=groupsOf(input);
 assert.equal(map.partnerSku02,"nuro");
 assert.equal(map.partnerSku01,"partnerUnmatched:partnerSku01");
 assert.equal(map.partnerSku05,"combined");
 const dashboard=buildVerifiedCountDashboard({...input,context,
  period:{kind:"month",day:"2026-11-01",asOf:"2026-11-21"}});
 assert.equal(dashboard.summary.partner,14);
 assert.equal(sum(dashboard.productRanking),14);
 assert.equal(dashboard.productRanking.find(x=>x.id==="nuro").count,7);
 assert.equal(dashboard.productRanking.find(x=>x.id==="partnerUnmatched:partnerSku01").count,3);
});
test("missing, disabled or non-Owner-reviewed maps never grant authority",()=>{
 const f=fixture();
 const mappings=[
  {...reviewed([binding("partnerSku02","special")]),reviewedByUid:"other"},
  {...reviewed([]),active:false},
  {...reviewed([]),ownerUid:"other"},
  {...reviewed([]),version:0},
  reviewed([binding("partnerSku02","missingHubSku")]),
  reviewed([{companyId:"other",productId:"partnerSku02",hubProductId:"special"}]),
  reviewed([binding("partnerSku02","special"),binding("partnerSku02","nuro")]),
  reviewed([binding("partnerSku01","nuro"),binding("partnerSku02","nuro")]),
  reviewed([binding("partnerSku05","air")]),
  reviewed([binding("partnerSku10","special")])
 ];
 for(const mapping of mappings)
  assert.throws(()=>compose(f,mapping),/UNVERIFIED/);
});
test("a second partner cannot borrow another company's reviewed SKU mapping",()=>{
 const f=fixture(),other=structuredClone(f.partnerSource);
 other.companyId="partnerB";other.companyLabel="協力店B";
 for(const p of other.products)p.companyId="partnerB";
 for(const r of other.records)r.companyId="partnerB";
 for(const l of other.lines)l.companyId="partnerB";
 const linked=linkAllRegisteredCountsWithoutSetup({
  hubCompanyId:"hub",hubSource:f.hubSource,
  partnerSources:[f.partnerSource,other],
  reviewedBindings:[binding("partnerSku02","special")]
 });
 const select=(cid,sku)=>linked.find(x=>x.companyId===cid&&x.productId===sku);
 assert.equal(select("partner","partnerSku02").groupId,"special");
 assert.equal(select("partnerB","partnerSku02").groupId,
  "partnerUnmatched:partnerSku02");
 assert.equal(linked.filter(x=>x.companyId!=="hub").length,18);
});
test("canonical loader fetches existing reviewed map with the same read-only transaction",()=>{
 const code=readFileSync(new URL(
  "../functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs",
  import.meta.url),"utf8");
 assert.match(code,/tx\.get\(hubRef\),tx\.get\(mappingRef\)/);
 assert.match(code,/if\(mappingSnap\?\.exists\)sameTime\(mappingSnap,hubSource\.readTime\)/);
 assert.match(code,/skuMap:mappingSnap\.exists\?doc\(mappingSnap\):null/);
 assert.doesNotMatch(code,/zeroSetupLink===true\?null:doc\(mappingSnap\)/);
});

test("an Owner OFF target never receives counts through a stale reviewed binding",()=>{
 const f=fixture();
 const target=f.hubSource.products.find(p=>p.sourceId==="special");
 target.active=false;
 const before=structuredClone(f);
 // Existing approved mapping must not resurrect a disabled hub product.
 assert.throws(()=>compose(f,reviewed([binding("partnerSku02","special")])),/UNVERIFIED/);
 assert.deepEqual(f,before,"no saved count or visibility write");
 // The zero-setup path has no authority to guess another SKU for the 7 old counts.
 const unreviewed=compose(f);
 const group=groupsOf(unreviewed);
 assert.equal(group.partnerSku02,"partnerUnmatched:partnerSku02");
 assert.notEqual(group.partnerSku02,"special");
 assert.deepEqual(f,before);
});
test("an Owner OFF combined Hikari/AIR target cannot be re-enabled via old mapping",()=>{
 const f=fixture();
 f.hubSource.products.find(p=>p.sourceId==="combined").active=false;
 const before=structuredClone(f);
 assert.throws(()=>compose(f,reviewed([binding("partnerSku05","combined")])),/UNVERIFIED/);
 const unmapped=groupsOf(compose(f));
 assert.equal(unmapped.partnerSku05,"partnerUnmatched:partnerSku05");
 assert.deepEqual(f,before);
});
