import test from "node:test";
import assert from "node:assert/strict";
import {buildPartnerCountRankingSource,PARTNER_RANK_SKUS} from
 "../ranking/partner-workspace-count-source.mjs";
import {buildCombinedCountLeaderboard} from
 "../ranking/combined-count-leaderboard.mjs";
import {createRankOnlyPublication} from "../ranking/rank-only-publication.mjs";

const DATE1="2026-11-07",DATE2="2026-11-08",PERIOD="2026-11";
const TIME="2026-11-08T02:00:00Z";
const CATEGORIES=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const blank=()=>Object.fromEntries(CATEGORIES.map(k=>[k,0]));
const counts=(nuro=0,sb=0,mnp=0)=>({
 ...blank(),NURO:nuro,"SB光・AIR":sb,SBMNP:mnp
});
const entry=(date,staff,vals,team="team1")=>({
 id:date+"__"+staff,companyId:"partner",hubCompanyId:"own",staffId:staff,
 date,version:2,teamIdSnapshot:team,staffNameSnapshot:"担当者"+staff,
 counts:vals,totalCount:Object.values(vals).reduce((a,b)=>a+b,0),
 privateCounts:{"custom-secret-product":3},privateTotalCount:3
});
const summary=(date,vals)=>({
 source:"staff-entries-v1",date,hubCompanyId:"own",partnerCompanyId:"partner",
 counts:vals,totalCount:Object.values(vals).reduce((a,b)=>a+b,0)
});
function make(){
 const today=counts(3,2),other=counts(1,0,1),sumToday=counts(3,2);
 return {
  hubCompanyId:"own",partnerCompanyId:"partner",
  companyLabel:"協力店A",period:PERIOD,readTime:TIME,
  relation:{hubCompanyId:"own",partnerCompanyId:"partner",
   active:true,countSharingApproved:true},
  proof:{serverVerified:true,reciprocalOwnersApproved:true,
   completeMonthEntriesRead:true,completeMonthSummariesRead:true,
   historicalTeamsVerified:true,snapshotConsistent:true},
  teams:[{id:"team1",name:"第1班",goalCount:null}],
  entries:[entry(DATE1,"member1",today),entry(DATE2,"member2",other)],
  summaries:[summary(DATE1,sumToday),summary(DATE2,other)]
 };
}
const copy=value=>JSON.parse(JSON.stringify(value));
const build=d=>buildPartnerCountRankingSource(d);
function ownSource(){
 const product={companyId:"own",sourceId:"ownNuro",name:"NURO",active:true,sortOrder:0};
 return {
  companyId:"own",companyLabel:"自社",kind:"own",consentVerified:true,
  isComplete:true,readTime:TIME,
  teams:[{id:"internalTeam",name:"自社班",goalCount:null}],
  records:[{companyId:"own",sourceId:"ownRecord",uid:"ownStaff",
   date:DATE1,teamId:"internalTeam",totalCount:2,reportStatus:"submitted",
   memberNameSnapshot:"自社社員",teamNameSnapshot:"自社班",workLocation:""}],
  lines:[{companyId:"own",recordId:"ownRecord",sourceId:"ownRecord__0000",
   date:DATE1,uid:"ownStaff",teamId:"internalTeam",productId:"ownNuro",count:2}],
  products:[product]
 };
}
test("existing workspace person/day entries reconcile to actual daily summary without sales or private products",()=>{
 const input=make(),original=copy(input),output=build(input);
 assert.deepEqual(input,original,"must never mutate stored history");
 assert.equal(output.kind,"partner");
 assert.equal(output.records.length,2);
 assert.equal(output.records.reduce((sum,r)=>sum+r.totalCount,0),7);
 assert.equal(output.records[0].uid,"member1");
 assert.equal(output.records[0].teamId,"team1");
 assert.equal(output.records[0].reportStatus,"submitted");
 assert.equal(output.products.length,9);
 assert.equal(output.lines.length,4);
 assert.deepEqual(output.lines.filter(l=>l.productId==="partnerSku05")
  .map(l=>l.count),[2]);
 assert(!JSON.stringify(output).includes("custom-secret-product"));
 assert(!JSON.stringify(output).includes("privateCounts"));
 assert(!JSON.stringify(output).includes("totalRevenue"));
 assert(!JSON.stringify(output).includes("unitPrice"));
});
test("live partner ledger becomes a sanitized source for existing combined rank-only engine",()=>{
 const partner=build(make());
 const trusted={
  hubCompanyId:"own",approvedCompanyIds:["own","partner"],period:PERIOD,
  sources:[ownSource(),partner],productGroups:[
   {companyId:"own",productId:"ownNuro",groupId:"nuro",groupName:"NURO"},
   {companyId:"partner",productId:"partnerSku01",groupId:"nuro",groupName:"NURO"}
  ]
 };
 const totals=buildCombinedCountLeaderboard(trusted);
 assert.equal(totals.combinedCount,9);
 assert.equal(totals.productCountRanking.find(p=>p.name==="NURO").count,6);
 assert.equal(totals.productCountRanking.find(p=>
  p.name.includes("旧合算")).count,2);
 assert.equal(totals.needsProductMapping,true,
  "SB光・AIR cannot be mapped to 光 or Air without explicit owner review");
 const publicRanks=createRankOnlyPublication(trusted);
 assert.equal(publicRanks.schema,"nico-combined-rank-only-v1");
 assert.equal(publicRanks.memberRanks.length,3);
 assert.equal(publicRanks.teamRanks.length,2);
 assert(!/"(?:totalCount|revenue|count|score|unitPrice|cashback|privateCounts)":/.test(
  JSON.stringify(publicRanks)));
});
test("legacy SB hikari/Air is ONE original count bucket, never double-counted",()=>{
 const d=make();
 assert.equal(PARTNER_RANK_SKUS[4].id,"partnerSku05");
 assert.match(PARTNER_RANK_SKUS[4].name,/旧合算・未分類/);
 assert(!PARTNER_RANK_SKUS.some(p=>p.name==="SB光"||p.name==="SB AIR"));
 const out=build(d);
 assert.equal(out.records[0].totalCount,5);
 assert.equal(out.lines.filter(x=>x.productId==="partnerSku05")
  .reduce((s,x)=>s+x.count,0),2);
});
test("missing or stale summary, truncated query proof, revoked relation and wrong company reject entire ranking",()=>{
 const mutations=[
  d=>{d.summaries.pop();},
  d=>{d.summaries[0].counts.NURO=4;d.summaries[0].totalCount=6;},
  d=>{d.summaries[0].source="legacy-counts";},
  d=>{d.summaries.push(copy(d.summaries[0]));},
  d=>{d.proof.completeMonthEntriesRead=false;},
  d=>{d.proof.completeMonthSummariesRead=false;},
  d=>{d.proof.reciprocalOwnersApproved=false;},
  d=>{d.proof.serverVerified=false;},
  d=>{d.proof.historicalTeamsVerified=false;},
  d=>{d.proof.snapshotConsistent=false;},
  d=>{d.relation.countSharingApproved=false;},
  d=>{d.relation.active=false;},
  d=>{d.entries[0].companyId="other";},
  d=>{d.entries[0].hubCompanyId="other";},
  d=>{d.entries.push(copy(d.entries[0]));},
  d=>{d.entries[0].counts.NURO=4;},
  d=>{d.entries[0].teamIdSnapshot=null;},
  d=>{d.entries[0].teamIdSnapshot="currentTeamNotHistorical";},
  d=>{d.entries[0].id="wrong";},
  d=>{d.entries[0].date="2026-11-32";},
  d=>{d.entries[0].staffNameSnapshot="CB20000担当";},
  d=>{d.entries[0].counts.NURO="3";},
  d=>{d.entries[0].counts["injected"]=1;},
  d=>{d.entries[0].totalCount=999;},
  d=>{d.teams[0].name="売上10万円";},
  d=>{d.entries[0].version=0;}
 ];
 for(let i=0;i<mutations.length;i++){
  const d=make();mutations[i](d);
  assert.throws(()=>build(d),undefined,"blocked unsafe fixture "+i);
 }
});
test("fullwidth financial labels cannot enter verified partner count ranking sources",()=>{
 for(const inject of [
  d=>{d.companyLabel="協力店 ＣＢ２００００";},
  d=>{d.teams[0].name="第一班 ＣＢ２００００";},
  d=>{d.entries[0].staffNameSnapshot="担当 ＣＢ２００００";}
 ]){
  const fixture=make();inject(fixture);
  const before=copy(fixture);
  assert.throws(()=>build(fixture),/PARTNER_RANK_SOURCE_INCOMPLETE_OR_UNVERIFIED/);
  assert.deepEqual(fixture,before,"never rewrite source names or historical counts");
 }
});

test("same staff on separate dates is valid, zero submission is distinct from absent report",()=>{
 const d=make();
 const zeros=entry(DATE2,"member1",blank());
 d.entries.push(zeros);
 const out=build(d);
 assert.equal(out.records.length,3);
 assert.equal(out.records.filter(x=>x.uid==="member1").length,2);
 assert.equal(out.records.find(x=>x.sourceId===DATE2+"__member1").reportStatus,
  "no_result");
 assert.equal(out.lines.length,4,"zero reports never fabricate contract lines");
 const missing=make();missing.entries=[];
 assert.throws(()=>build(missing),"daily summary cannot exist with missing entries");
});
