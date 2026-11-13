"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildApprovedPartnerCountStandings,KEYS}=
 require("../functions-partner-workspace/shared-count-standings.cjs");
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const create=(count=4)=>({
 cid:"partner",name:"協力店",approved:true,allowedCategories:["NURO"],
 teams:[],entries:[],
 reports:[{date:"2026-09-30",data:{
  source:"quick-counts-v1",hubCompanyId:"hub",partnerCompanyId:"partner",
  date:"2026-09-30",counts:{...zero(),NURO:count},totalCount:count,
  cashback:19000,unitPrice:99999
 }}]
});
const run=(start,end,sources=[create()])=>
 buildApprovedPartnerCountStandings({hubId:"hub",start,end,sources});
test("a real Sep-Oct weekly company count is visible once, never assigned to staff",()=>{
 const value=run("2026-09-28","2026-10-04");
 assert.equal(value.start,"2026-09-28");
 assert.equal(value.end,"2026-10-04");
 assert.equal(value.totalCount,4);
 assert.equal(value.companies[0].totalCount,4);
 assert.equal(value.companies[0].reportedDays,1);
 assert.equal(value.people.length,0);
 assert.equal(value.teams.length,0);
 assert.equal(value.historicalCompanyOnlyCount,4);
 assert.equal(value.peopleComplete,false);
 assert.deepEqual(value.products.map(p=>[p.name,p.totalCount]),[["NURO",4]]);
 assert.doesNotMatch(JSON.stringify(value),/cashback|unitPrice|19000|99999/i);
});
test("the same backend never accepts an arbitrary cross-month date range wider than 31 days",()=>{
 for(const [from,to] of [
  ["2026-09-01","2026-10-02"],
  ["2026-10-05","2026-09-28"],
  ["2026-09-28","2026-11-01"],
  ["2026-02-30","2026-03-01"],
  ["2026-09-30","2026-11-01"]
 ])
  assert.throws(()=>run(from,to),/PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
});
test("out-of-window, duplicate, missing or contradictory staff-day summaries are blocked",()=>{
 const source=create();
 for(const bad of [
  {...source,reports:[{...source.reports[0],date:"2026-09-27"}]},
  {...source,reports:[...source.reports,...source.reports]},
  {...source,reports:[{date:"2026-09-30",data:null}],
   entries:[{id:"2026-09-30__worker",data:{
    companyId:"partner",hubCompanyId:"hub",date:"2026-09-30",
    staffId:"worker",counts:{...zero(),NURO:1},
    totalCount:1,version:1,staffNameSnapshot:"担当"
   }}]},
  {...source,reports:[{date:"2026-09-30",data:{
   ...source.reports[0].data,source:"staff-entries-v1"
  }}]}
 ])
  assert.throws(()=>run("2026-09-28","2026-10-04",[bad]),
   /PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
});
test("unreported company has no company ranking; genuine submitted zero has a rank",()=>{
 const silent={...create(0),reports:[]};
 const unreported=run("2026-09-28","2026-10-04",[silent]);
 assert.equal(unreported.companies.length,0);
 assert.equal(unreported.unreportedCompanies.length,1);
 const report=run("2026-09-28","2026-10-04",[create(0)]);
 assert.equal(report.companies.length,1);
 assert.equal(report.companies[0].totalCount,0);
 assert.equal(report.companies[0].rank,1);
});


test("all OFF products hide company name and all attribution/status metadata without touching originals",()=>{
 const s=create(7);
 s.allowedCategories=[];
 const before=JSON.stringify(s);
 const value=run("2026-09-28","2026-10-04",[s]);
 assert.deepEqual(value.companies,[]);
 assert.deepEqual(value.teams,[]);
 assert.deepEqual(value.people,[]);
 assert.deepEqual(value.products,[]);
 assert.deepEqual(value.unreportedCompanies,[]);
 assert.equal(value.totalCount,0);
 assert.equal(value.reportCount,0);
 assert.doesNotMatch(JSON.stringify(value),/協力店|cashback|99999|partner/);
 assert.equal(JSON.stringify(s),before,"OFF is not a destructive migration");
});
test("real zero-count staff report without verifiable name/team never advertises complete staff ranking",()=>{
 const entry={
  companyId:"partner",hubCompanyId:"hub",date:"2026-09-30",
  staffId:"worker",counts:zero(),totalCount:0,version:1,
  staffNameSnapshot:null,teamIdSnapshot:null
 };
 const src={...create(0),entries:[{id:"2026-09-30__worker",data:entry}],
  reports:[{date:"2026-09-30",data:{
   ...create(0).reports[0].data,source:"staff-entries-v1"
  }}]};
 const value=run("2026-09-28","2026-10-04",[src]);
 assert.equal(value.totalCount,0);
 assert.equal(value.companies[0].rank,1,"submitted zero is real");
 assert.equal(value.people.length,0);
 assert.equal(value.teams.length,0);
 assert.equal(value.peopleComplete,false);
 assert.equal(value.teamComplete,false);
 assert.equal(value.unverifiedPersonCount,0);
 assert.equal(value.unverifiedTeamCount,0);
 assert.equal(value.companies[0].peopleVerified,false);
});
test("an aggregate 0 without a verified staff original is refused rather than called submitted",()=>{
 const src=create(0);
 src.reports[0].data.source="staff-entries-v1";
 assert.throws(()=>run("2026-09-28","2026-10-04",[src]),
  /PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
});
test("per-product IDs stay stable when the earlier hub-approved categories turn OFF",()=>{
 const first={...create(2),allowedCategories:["NURO","SBMNP"]};
 first.reports[0].data.counts={...zero(),NURO:2,SBMNP:3};
 first.reports[0].data.totalCount=5;
 const both=run("2026-09-28","2026-10-04",[first]);
 assert.deepEqual(both.products.map(x=>[x.key,x.name,x.totalCount]),
  [["product-1","NURO",2],["product-2","SBMNP",3]]);
 const onlySecond={...first,allowedCategories:["SBMNP"]};
 const after=run("2026-09-28","2026-10-04",[onlySecond]);
 assert.deepEqual(after.products.map(x=>[x.key,x.name,x.totalCount]),
  [["product-2","SBMNP",3]]);
 assert.equal(after.totalCount,3);
});
