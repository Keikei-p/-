"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {projectPartnerMonthTeamDetails}=require("../functions-partner-workspace/partner-monthly-team-detail.cjs");
const {KEYS}=require("../functions-partner-workspace/service.cjs");
const zeros=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const row=(date,staffId,team,counts,extra=false,opts={})=>({
 id:date+"__"+staffId,
 data:()=>({companyId:"partner",hubCompanyId:"hub",date,staffId,
  staffNameSnapshot:staffId==="personA"?"佐藤":"鈴木",
  teamIdSnapshot:team,version:1,counts,
  totalCount:Object.values(counts).reduce((n,v)=>n+v,0),...opts})
});
const project=(month,workDocs=[],extraDocs=[],more={})=>projectPartnerMonthTeamDetails({
 hubId:"hub",cid:"partner",companyName:"協力店",month,keys:KEYS,
 workDocs,extraDocs,teamNames:{teamA:"1班",teamB:"2班"},
 privateProducts:[{id:"privateA",name:"協力店商材"}],
 publishedProducts:[{id:"newProduct",name:"新商材"}],linkedIds:[],
 ...more
});
test("October/November dashboard and team detail only count saved rows from their own month",()=>{
 const oct=[row("2026-10-01","personA","teamA",{...zeros(),NURO:3},false,{
  privateCounts:{privateA:2},privateTotalCount:2
 })];
 const nov=[row("2026-11-01","personA","teamB",{...zeros(),NURO:1}),
  row("2026-11-02","personB","teamA",{...zeros(),YMMNP:4})];
 const extras=[row("2026-11-02","personB","teamA",{newProduct:3,oldHidden:6},true)];
 const o=project("2026-10",oct,[]);
 assert.equal(o.totalCount,5);
 assert.equal(o.reportedStaffCount,1);assert.equal(o.reportedTeamCount,1);
 assert.equal(o.teams[0].name,"1班");
 assert.equal(o.teams[0].people[0].counts["協力店専用：協力店商材"],2);
 assert.equal(o.teams[0].cbCounts.NURO.unclassified,3);
 const n=project("2026-11",nov,extras);
 assert.equal(n.totalCount,14);
 assert.equal(n.primaryTotalCount,5);assert.equal(n.additionalTotalCount,9);
 assert.equal(n.reportedStaffCount,2);assert.equal(n.reportedTeamCount,2);
 assert.equal(n.teams.find(t=>t.name==="2班").totalCount,1);
 assert.equal(n.teams.find(t=>t.name==="1班").totalCount,13);
 assert.equal(n.teams.find(t=>t.name==="1班").people.find(p=>p.name==="鈴木").totalCount,13);
 assert.equal(n.teams.find(t=>t.name==="1班").counts["追加：新商材"],3);
 assert.equal(n.teams.find(t=>t.name==="1班").counts["過去・非公開の追加商材"],6);
 assert.equal(n.complete,false,"unreported days are not confirmed zero");
 assert.equal(n.reportedDayCount,2);
 assert.doesNotMatch(JSON.stringify(n),/oldHidden|newProduct|privateA|hubCompanyId|staffId|unitPrice|revenue|commission/);
});
test("team transfers use saved snapshots, never current team or false person merging",()=>{
 const work=[row("2026-11-01","personA","teamA",{...zeros(),NURO:2}),
  row("2026-11-03","personA","teamB",{...zeros(),NURO:3})];
 const month=project("2026-11",work,[]);
 assert.equal(month.totalCount,5);
 assert.deepEqual(month.teams.map(t=>[t.name,t.totalCount]).sort(),
  [["1班",2],["2班",3]]);
 assert.equal(month.reportedStaffCount,1,"one unique staff despite 2 teams");
 assert.equal(month.teams[0].people.length,1);
 assert.equal(month.teams[1].people.length,1);
});
test("corrupted totals, linked duplicate ledger, wrong company and double day docs all fail closed",()=>{
 const work=row("2026-11-01","personA","teamA",{...zeros(),NURO:2});
 assert.throws(()=>project("2026-11",[work,work],[]),/UNVERIFIED/);
 assert.throws(()=>project("2026-11",[row("2026-11-01","personA","teamA",
  {...zeros(),NURO:2},false,{totalCount:500})],[]),/UNVERIFIED/);
 assert.throws(()=>project("2026-11",[],[row("2026-11-01","personA","teamA",
  {newProduct:2},true,{companyId:"foreign"})]),/UNVERIFIED/);
 assert.throws(()=>project("2026-11",[],[row("2026-11-01","personA","teamA",
  {newProduct:2},true)],{linkedIds:["newProduct"],publishedProducts:[]}),/UNVERIFIED/);
});
test("no reports do not imply everyone recorded zero; own read is pure",()=>{
 const m=project("2026-11",[],[]);
 assert.equal(m.totalCount,0);assert.equal(m.reportedDayCount,0);
 assert.equal(m.savedWorkRows,0);assert.equal(m.savedExtraRows,0);
 assert.deepEqual(m.teams,[]);assert.equal(m.complete,false);
 const raw=row("2026-11-01","personA","teamA",{...zeros(),NURO:4});
 const before=JSON.stringify(raw.data());
 assert.equal(project("2026-11",[raw],[]).totalCount,4);
 assert.equal(JSON.stringify(raw.data()),before);
});
test("partner month screen retains existing day input, shows only one selected month and hides finance",()=>{
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 const backend=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const functions=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
 assert.match(html,/id="pInlineDashboardMonth" type="month"/);
 assert.match(html,/id="partnerMonthlyTeamDetails"/);
 assert.match(html,/id="pInlineDate" type="date"/);
 assert.match(html,/id="pInlineRecordDate" type="date"/);
 assert.match(html,/readPartnerMonthlyTeamDetails\(partnerInlinePayload\(\{month\}\)\)/);
 assert.match(html,/partnerInlineData=snap;partnerInlineRender\(\);\s*void loadPartnerDashboardMonth\(\)/);
 assert.match(backend,/async function viewPartnerMonthTeam\(request\)/);
 assert.match(backend,/s\.kind!=="partner"/);
 assert.match(backend,/visibility:s\.role==="member"\?"self":"company"/);
 assert.match(functions,/exports\.getPartnerMonthlyTeamDetails=onCall\(opts,service\.viewPartnerMonthTeam\)/);
});
