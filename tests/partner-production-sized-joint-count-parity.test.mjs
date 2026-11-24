/**
 * NO DEPLOY / synthetic source conservation regression.
 * The counts 3 companies, 87 original staff entries, 230 partner counts,
 * 32 distinct company/day summaries and 34 combined light/AIR counts are
 * grounded in the 2026-11-21 20:50 JST READ-ONLY live inventory.
 *
 * Synthetic product/staff distribution below is INVENTED test data, NOT
 * a report of which live products/people earned the 230 cases.
 * No Firebase access, writes, secrets, sales prices or real identities.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {buildPartnerCountRankingSource,PARTNER_RANK_SKUS}
 from "../functions-ranking-approvals/ranking/partner-workspace-count-source.mjs";
import {composeCanonicalMonthlyRankingInput}
 from "../functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs";
import {buildVerifiedCountDashboard}
 from "../functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs";
import {buildOwnerVisibleCountRanking}
 from "../functions-ranking-approvals/ranking/owner-product-visibility-rankings.mjs";
import {buildSameAppJointCountProjection as project}
 from "../ranking/same-app-joint-count-projection.mjs";

const asOf="2026-11-21",month="2026-11",time="2026-11-21T11:50:20.527Z";
const categories=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const zero=()=>Object.fromEntries(categories.map(x=>[x,0]));
const scenario=[
 {cid:"partner1",entryCount:5,reportDays:5,total:18,linked:0,combined:5,zeros:0},
 {cid:"partner2",entryCount:19,reportDays:7,total:36,linked:1,combined:12,zeros:0},
 {cid:"partner3",entryCount:63,reportDays:20,total:176,linked:5,combined:17,zeros:4}
];

function sourceFor({cid,entryCount,reportDays,total,linked,combined,zeros,energy=0}){
 const relation={hubCompanyId:"hub",partnerCompanyId:cid,
  active:true,countSharingApproved:true};
 const ledger=[],daily=new Map();
 const positive=entryCount-zeros,other=total-linked-combined-energy;
 assert(other>=positive,"every nonzero report gets at least one synthetic count");
 for(let i=0;i<entryCount;i++){
  const date=month+"-"+String(1+i%reportDays).padStart(2,"0");
  const staffId="worker"+Math.floor(i/reportDays);
  const counts=zero(),isPositive=i<positive;
  if(isPositive)counts.SBMNP=1+(i===0?other-positive:0);
  if(i===0){counts.NURO=linked;counts["SB光・AIR"]=combined;counts["つばさ・HTB"]=energy;}
  const totalCount=Object.values(counts).reduce((n,v)=>n+v,0);
  const row={id:date+"__"+staffId,companyId:cid,hubCompanyId:"hub",
   date,staffId,teamIdSnapshot:"team1",staffNameSnapshot:"担当者",
   version:1,counts,totalCount};
  ledger.push(row);
  if(!daily.has(date))daily.set(date,zero());
  const agg=daily.get(date);
  for(const [sku,count] of Object.entries(counts))agg[sku]+=count;
 }
 assert.equal(ledger.reduce((n,e)=>n+e.totalCount,0),total);
 assert.equal(ledger.filter(x=>x.totalCount===0).length,zeros);
 const summaries=[...daily].map(([date,counts])=>({
  source:"staff-entries-v1",hubCompanyId:"hub",partnerCompanyId:cid,
  date,counts,totalCount:Object.values(counts).reduce((n,v)=>n+v,0)
 }));
 assert.equal(summaries.length,reportDays);
 const input={hubCompanyId:"hub",partnerCompanyId:cid,
  companyLabel:"協力店"+cid.slice(-1),period:month,readTime:time,
  relation,proof:{serverVerified:true,countSharingVerified:true,
   completeMonthEntriesRead:true,completeMonthSummariesRead:true,
   historicalTeamsVerified:true,snapshotConsistent:true},
  teams:[{id:"team1",name:"1班",goalCount:null}],
  entries:ledger,summaries};
 const before=structuredClone(input);
 const result=buildPartnerCountRankingSource(input);
 assert.deepEqual(input,before,"reader must not mutate any original report");
 assert.equal(result.records.length,entryCount);
 assert.equal(result.lines.reduce((n,r)=>n+r.count,0),total);
 assert.equal(result.products.length,PARTNER_RANK_SKUS.length);
 return {result,input};
}
function fixture(specs=scenario){
 const input=specs.map(sourceFor);
 const hubRecord={companyId:"hub",sourceId:"own1",uid:"ownerStaff",
  date:"2026-11-18",teamId:"team1",totalCount:5,reportStatus:"submitted",
  memberNameSnapshot:"直営担当",teamNameSnapshot:"1班",workLocation:""};
 const ownSource={companyId:"hub",companyLabel:"直営",kind:"own",
  consentVerified:true,isComplete:true,readTime:time,
  completeWindows:{current:true,previous:false},
  teams:[{id:"team1",name:"1班",goalCount:null}],
  roster:[{uid:"ownerStaff",name:"直営担当",teamId:"team1"}],
  products:[{companyId:"hub",sourceId:"nuro",name:"NURO光",
   active:true,sortOrder:0}],
  records:[hubRecord],
  lines:[{companyId:"hub",recordId:"own1",sourceId:"ownline",
   date:"2026-11-18",uid:"ownerStaff",teamId:"team1",
   productId:"nuro",count:5}]};
 const approvedCompanyIds=["hub",...specs.map(x=>x.cid)];
 const context={serverVerified:true,userActive:true,memberActive:true,
  companyActive:true,activeCountSharingVerified:true,
  completeSnapshotBudgetApproved:true,individualNamesApproved:false,
  viewerUid:"owner",viewerCompanyId:"hub",hubCompanyId:"hub",
  role:"hub_owner",approvedCompanyIds};
 const joined=composeCanonicalMonthlyRankingInput({
  context,hubSource:ownSource,partnerSources:input.map(x=>x.result),
  skuMap:{hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
   active:true,version:1,bindings:specs.map(({cid})=>({
    companyId:cid,productId:"partnerSku01",hubProductId:"nuro"
   }))},
  zeroSetupLink:true,hubOwnerUid:"owner",month,serverAsOf:asOf
 });
 const period={kind:"month",day:month+"-01",asOf};
 return {joined,context,period,input};
}

test("audit-size: all 87 saved reports / 32 daily summaries / 230 partner cases survive as verified originals",()=>{
 const {joined,context,period,input}=fixture();
 assert.equal(input.reduce((n,x)=>n+x.input.entries.length,0),87);
 assert.equal(input.reduce((n,x)=>n+x.input.summaries.length,0),32);
 assert.equal(input.reduce((n,x)=>n+x.input.entries.filter(r=>r.totalCount===0).length,0),4);
 assert.equal(input.reduce((n,x)=>n+x.result.lines
  .filter(y=>y.productId==="partnerSku05")
  .reduce((sum,y)=>sum+y.count,0),0),34);
 const before=structuredClone({joined,input});
 const raw=buildVerifiedCountDashboard({...joined,context,period});
 const view=project(raw);
 assert.equal(raw.summary.own,5);
 assert.equal(raw.summary.partner,230);
 assert.equal(raw.summary.total,235);
 assert.equal(view.partnerCount,230);
 assert.equal(view.total,235);
 assert.equal(view.productRows.reduce((n,p)=>n+p.count,0),235);
 assert.equal(view.productRows.find(x=>x.name==="SB光・AIR（旧合算・未分類）").count,34);
 assert.equal(view.productRows.find(x=>x.name==="SBMNP").count,190);
 assert.equal(view.productRows.find(x=>x.name==="NURO光").count,11);
 for(const spec of scenario){
  const company=raw.companyBreakdown.find(c=>c.id===spec.cid);
  assert.equal(company.count,spec.total);
 }
 assert.deepEqual({joined,input},before);
 assert(!/(?:unitPrice|revenue|cashback|privateCounts)/i.test(JSON.stringify(raw)));
});

test("audit-size: published partner view uses same 230 count source, with no other-company finance or private details",()=>{
 const {joined,context,period}=fixture();
 const ctx={...context,role:"partner_owner",
  viewerUid:"partnerOwner",viewerCompanyId:"partner2"};
 const raw=buildVerifiedCountDashboard({...joined,context:ctx,period});
 const view=project(raw,{partner:true});
 assert.equal(view.ownCount,36);
 assert.equal(view.productRows.reduce((n,p)=>n+p.count,0),235);
 assert.equal(view.financeIncluded,false);
 assert(!("summary" in raw),"full owner totals never reach partner");
 const ownTeams=view.teamDetails.filter(t=>t.name.startsWith("協力店2・"));
 const otherTeams=view.teamDetails.filter(t=>!t.name.startsWith("協力店2・"));
 assert.equal(ownTeams.length,1);
 assert.equal(ownTeams[0].count,36);
 assert.equal(otherTeams.length,3,"other company/team count cards remain visible");
 assert(otherTeams.every(t=>t.members.length===0&&t.products.length===0),
  "other companies' team members and product breakdown must stay private");
 assert(!/(?:unitPrice|revenue|cashback)/i.test(JSON.stringify(view)));
});

test("audit-size: Owner ON-only publication is explicit; 224 unmatched historic counts remain in originals",()=>{
 const {joined,context,period,input}=fixture();
 const immutable=structuredClone(input.map(x=>x.input.entries));
 const publication={serverVerified:true,ownerSettingsRead:true,
  ownerUidVerified:true,productMappingsReviewed:true,
  hubCompanyId:"hub",revision:1,enabledHubProductIds:["nuro"],
  partnerOverrides:[]};
 const raw=buildOwnerVisibleCountRanking({
  input:{...joined,context,period},publication
 });
 // Only test-fixture NURO matches existing hub SKU. All others remain saved,
 // but are NOT allowed to bypass Owner's product publication setting.
 assert.equal(raw.summary.total,11);
 assert.equal(raw.summary.partner,6);
 assert.equal(raw.productRanking.reduce((n,r)=>n+r.count,0),11);
 assert.deepEqual(input.map(x=>x.input.entries),immutable);
 assert.equal(input.reduce((n,x)=>n+x.result.lines.reduce((s,r)=>s+r.count,0),0),230);
 // Prevent claiming all 230 are published when only 6 are matched and ON.
 assert.notEqual(raw.summary.partner,230);
});


// Uses the latest AUDITED totals only. Staff/day/SKU distribution and the
// later 5 new cases below are entirely synthetic; no live product approval.
// Latest audited totals are reused only as sizes. Dates, people, source IDs
// and per-record distribution below are synthetic, not production history.
test("245 historical cases plus new separate inputs keep both combined histories in all four ranking dimensions",()=>{
 const specs=[
  {cid:"partner1",entryCount:5,reportDays:5,total:18,linked:0,combined:5,energy:0,zeros:1},
  {cid:"partner2",entryCount:69,reportDays:20,total:187,linked:5,combined:18,energy:83,zeros:3},
  {cid:"partner3",entryCount:19,reportDays:10,total:40,linked:1,combined:12,energy:3,zeros:0}
 ];
 const f=fixture(specs),past=structuredClone(f.input.map(x=>x.input.entries));
 assert.equal(past.flat().length,93);
 assert.equal(f.input.reduce((n,x)=>n+x.input.summaries.length,0),35);
 const initial=buildVerifiedCountDashboard({...f.joined,context:f.context,period:f.period});
 assert.equal(initial.summary.partner,245);
 const next=f.input.map(x=>structuredClone(x.input)),p=next[1],date="2026-11-21";
 p.includePrivateCounts=true;p.proof.completePrivateProductCatalogueRead=true;
 p.privateProducts=[{id:"newHtb",companyId:p.partnerCompanyId,name:"HTB",active:true,origin:"partner_custom",visibility:"private"},
  {id:"newTsubasa",companyId:p.partnerCompanyId,name:"つばさ電気",active:true,origin:"partner_custom",visibility:"private"}];
 p.entries.push({id:date+"__futureWorker",companyId:p.partnerCompanyId,hubCompanyId:"hub",date,
  staffId:"futureWorker",teamIdSnapshot:"team1",staffNameSnapshot:"新規担当",version:1,
  counts:zero(),totalCount:0,privateCounts:{newHtb:3,newTsubasa:2},privateTotalCount:5});
 p.summaries.push({source:"staff-entries-v1",hubCompanyId:"hub",partnerCompanyId:p.partnerCompanyId,date,counts:zero(),totalCount:0});
 const own=structuredClone(f.joined.sources[0]);
 own.products.push({companyId:"hub",sourceId:"newHtb",name:"HTB",active:true,sortOrder:1},
  {companyId:"hub",sourceId:"newTsubasa",name:"つばさ電気",active:true,sortOrder:2});
 const joined=composeCanonicalMonthlyRankingInput({context:f.context,hubSource:own,
  partnerSources:next.map(buildPartnerCountRankingSource),zeroSetupLink:true,hubOwnerUid:"owner",
  skuMap:{hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",active:true,version:1,
   bindings:specs.map(({cid})=>({companyId:cid,productId:"partnerSku01",hubProductId:"nuro"}))},
  month,serverAsOf:asOf});
 const raw=buildVerifiedCountDashboard({...joined,context:f.context,period:f.period}),view=project(raw);
 assert.equal(raw.summary.partner,250);assert.equal(raw.summary.total,255);
 for(const rows of [raw.companyBreakdown,raw.teamBreakdown,raw.memberRanking,raw.productRanking])
  assert.equal(rows.reduce((n,r)=>n+r.count,0),255);
 for(const [name,n] of [["SB光・AIR（旧合算・未分類）",35],["つばさ・HTB",86],["HTB",3],["つばさ電気",2]])
  assert.equal(view.productRows.find(x=>x.name===name)?.count,n);
 for(let i=0;i<next.length;i++)assert.deepEqual(next[i].entries.slice(0,past[i].length),past[i]);
 assert.equal(raw.companyBreakdown.find(c=>c.id==="partner2").count,192);
 for(const [kind,total,partner] of [["day",5,5],["week",25,20]]){
  const v=buildVerifiedCountDashboard({...joined,context:f.context,period:{kind,day:asOf,asOf}});
  assert.equal(v.summary.total,total);assert.equal(v.summary.partner,partner);
  for(const rows of [v.companyBreakdown,v.teamBreakdown,v.memberRanking,v.productRanking])
   assert.equal(rows.reduce((n,r)=>n+r.count,0),total);
 }

 // Source/engine/projection proof only: no claim that unresolved historical
 // categories bypass the real Owner publication gate or are already public.
});
