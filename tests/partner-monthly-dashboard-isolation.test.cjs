"use strict";
// Zero production traffic: synthetic saved-entry records and static UI contract.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {projectPartnerMonth}=require("../functions-partner-workspace/monthly-shared-projection.cjs");
const keys=["NURO","SBMNP"];
const clone=o=>JSON.parse(JSON.stringify(o));
const entry=(date,id,team,counts,privateCounts={})=>{
 const totalCount=Object.values(counts).reduce((a,b)=>a+b,0);
 return {id:date+"__"+id,data:()=>({
  date,staffId:id,teamIdSnapshot:team,staffNameSnapshot:id==="workerA"?"佐藤":"田中",
  companyId:"partner",hubCompanyId:"hub",counts,totalCount,
  privateCounts,privateTotalCount:Object.values(privateCounts).reduce((a,b)=>a+b,0),
  version:1,updatedByUid:"redacted",unitPrice:88888,totalRevenue:99999
 })};
};
const extra=(date,id,team,counts)=>({id:date+"__"+id,data:()=>({
 date,staffId:id,teamIdSnapshot:team,staffNameSnapshot:id==="workerA"?"佐藤":"田中",
 companyId:"partner",hubCompanyId:"hub",counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0),
 version:1,unitPrice:40000,totalRevenue:70000
})});
const legacy=[
 entry("2026-10-01","workerA","team1",{NURO:2,SBMNP:1}),
 entry("2026-10-31","workerA","team2",{NURO:4,SBMNP:0}),
 entry("2026-10-31","workerB","team1",{NURO:1,SBMNP:0}),
 entry("2026-11-01","workerA","team1",{NURO:5,SBMNP:2}),
 entry("2026-11-05","workerB","team2",{NURO:3,SBMNP:0})
];
const additional=[
 extra("2026-10-31","workerA","team2",{fiberNew:3}),
 extra("2026-11-05","workerB","team2",{fiberNew:6})
];
const read=month=>{
 const from=month+"-01",to=month==="2026-10"?"2026-10-31":"2026-11-05";
 return projectPartnerMonth({hubId:"hub",cid:"partner",companyName:"協力店A",
  from,to,keys,teamNames:{team1:"第1班",team2:"第2班"},
  legacyDocs:legacy.filter(x=>x.data().date>=from&&x.data().date<=to),
  extraDocs:additional.filter(x=>x.data().date>=from&&x.data().date<=to),
  publishedIds:["fiberNew"],linkedIds:[]});
};
test("October selects only October: saved teams, people and added products without rewriting history",()=>{
 const frozen=clone([...legacy,...additional].map(x=>x.data()));
 const october=read("2026-10");
 assert.equal(october.totalCount,11,"Oct original 8 + new product 3");
 assert.equal(october.additionalTotalCount,3);
 assert.deepEqual(october.teams.map(x=>[x.name,x.totalCount]),[["第1班",4],["第2班",7]]);
 assert.equal(october.teams.every(x=>x.companyId==="partner"),true);
 assert.equal(october.people.every(x=>x.companyId==="partner"),true);
 assert.deepEqual(october.people.map(x=>x.totalCount).sort((a,b)=>b-a),[10,1]);
 assert.equal(october.people.find(x=>x.name==="佐藤").teamKey,null,
  "moving between teams must not attribute all monthly sales to their current team");
 assert.deepEqual([...legacy,...additional].map(x=>x.data()),frozen);
 assert.doesNotMatch(JSON.stringify(october),/99999|88888|40000|70000|unitPrice|totalRevenue|updatedByUid/);
});
test("November selects only November: no October carryover or same-name identity merging",()=>{
 const november=read("2026-11");
 assert.equal(november.totalCount,16,"Nov original 10 + new product 6");
 assert.equal(november.additionalTotalCount,6);
 assert.deepEqual(november.teams.map(x=>[x.name,x.totalCount]),[["第1班",7],["第2班",9]]);
 assert.deepEqual(november.people.map(x=>x.totalCount).sort((a,b)=>b-a),[9,7]);
 assert.equal(november.people.find(x=>x.name==="佐藤").counts.NURO,5);
 assert.equal(november.people.find(x=>x.name==="田中").extraCounts.fiberNew,6);
 assert.notDeepEqual(november,read("2026-10"));
});
test("month UI and backend enforce company scope, no daily rewrite, missing-report honesty and no finance",()=>{
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const projection=fs.readFileSync(require.resolve("../functions-partner-workspace/monthly-shared-projection.cjs"),"utf8");
 assert.match(html,/id="pInlineDashboardMonth" type="month"/);
 assert.match(html,/id="pInlineDate" type="date"/);
 assert.match(html,/id="pInlineTeamDetailsTitle"/);
 assert.match(html,/id="partnerSharedDetailTitle"/);
 assert.match(html,/async function loadPartnerDashboardMonth\(/);
 assert.match(html,/renderPartnerDashboardMonth\(data,month\)/);
 assert.match(html,/workspace!==partnerInlineWorkspaceCompany/);
 assert.match(html,/pInline\("pInlineDashboardMonth"\)\.onchange=/);
 assert.match(html,/void loadPartnerDashboardMonth\(\{force:true\}\)/);
 const daily=html.slice(html.indexOf("function renderPartnerCountOnlyExtras(){"),
  html.indexOf("function renderPartnerGoalEstimate(){"));
 assert.doesNotMatch(daily,/pPartnerDailyCount|pPartnerStaffCount|pPartnerTeamCount/,
  "daily record rerender must not overwrite the selected monthly dashboard");
 const editor=html.slice(html.indexOf("function partnerInlineRender(){"),
  html.indexOf("async function partnerInlineOpenHistoryCorrection("));
 assert.doesNotMatch(editor,/const details=pInline\("pInlineTeamDetails"\)/,
  "daily edit render must not replace saved monthly detail");
 assert.match(service,/\.{3}\(s\.kind==="partner"\?\{workspaceCompanyId:s\.cid\}:\{\}\)/);
 assert.match(projection,/p=\{key,name,companyName,companyId:cid,teamKey/);
 assert.match(projection,/teams\.set\(key,\{key,name:savedName,companyName,companyId:cid,/);
 assert.doesNotMatch(service.slice(service.indexOf(" async function viewMonthly(request){"),
  service.indexOf(" async function view(request){")),/\btx\.set\(|\btx\.update\(|\btx\.delete\(/);
});
