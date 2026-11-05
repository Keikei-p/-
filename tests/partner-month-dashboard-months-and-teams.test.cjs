"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {projectPartnerMonth}=require("../functions-partner-workspace/monthly-shared-projection.cjs");
const keys=["NURO","SBMNP","YMMNP"];
const legacy=(date,staffId,teamIdSnapshot,counts)=>({
 id:date+"__"+staffId,
 data:()=>({companyId:"partner",hubCompanyId:"hub",date,
  staffId,teamIdSnapshot,staffNameSnapshot:staffId==="a"?"佐藤":"田中",
  counts:{NURO:0,SBMNP:0,YMMNP:0,...counts},
  totalCount:Object.values(counts).reduce((a,b)=>a+b,0),version:1,
  totalRevenue:123456789,unitPrice:999999})
});
const extra=(date,staffId,teamIdSnapshot,counts)=>({
 id:date+"__"+staffId,
 data:()=>({companyId:"partner",hubCompanyId:"hub",date,
  staffId,teamIdSnapshot,staffNameSnapshot:staffId==="a"?"佐藤":"田中",
  counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0),
  version:1,price:987654321})
});
const legacyDocs=[
 legacy("2026-10-12","a","oldTeam",{NURO:2}),
 legacy("2026-10-22","a","newTeam",{NURO:1}),
 legacy("2026-10-21","b","newTeam",{SBMNP:1}),
 legacy("2026-11-01","a","newTeam",{NURO:6})
];
const extraDocs=[
 extra("2026-10-12","a","oldTeam",{newProduct:3,retired:8}),
 extra("2026-10-21","b","newTeam",{newProduct:2}),
 extra("2026-11-02","a","newTeam",{newProduct:4})
];
const names={oldTeam:"旧班",newTeam:"新班"};
const read=(month,visible=["newProduct"])=>projectPartnerMonth({
 hubId:"hub",cid:"partner",companyName:"協力店A",
 from:month+"-01",to:month==="2026-10"?"2026-10-31":"2026-11-05",
 legacyDocs:legacyDocs.filter(x=>x.data().date.startsWith(month)),
 extraDocs:extraDocs.filter(x=>x.data().date.startsWith(month)),
 keys,publishedIds:visible,linkedIds:[],teamNames:names
});
test("October and November are independent 1-month company/team/person totals and retain historic team attribution",()=>{
 const untouched=JSON.stringify([...legacyDocs,...extraDocs].map(x=>x.data()));
 const october=read("2026-10"),november=read("2026-11");
 assert.equal(october.totalCount,9,"October 4 fixed + 5 new products");
 assert.equal(october.additionalTotalCount,5);
 assert.equal(november.totalCount,10,"November 6 fixed + 4 new products");
 assert.equal(november.additionalTotalCount,4);
 assert.deepEqual(october.teams.map(t=>[t.name,t.totalCount,t.extraCounts]).sort((a,b)=>a[0].localeCompare(b[0],"ja")),[
  ["旧班",5,{newProduct:3}],["新班",4,{newProduct:2}]
 ].sort((a,b)=>a[0].localeCompare(b[0],"ja")));
 assert.deepEqual(november.teams.map(t=>[t.name,t.totalCount,t.extraCounts]),[
  ["新班",10,{newProduct:4}]
 ]);
 assert.equal(october.people.length,2);
 const staffA=october.people.find(x=>x.name==="佐藤");
 assert.equal(staffA.totalCount,6);
 assert.equal(staffA.teamKey,null,"same person across 2 historical teams must not move old records");
 assert.equal(staffA.extraCounts.newProduct,3);
 assert.equal(october.teams.reduce((sum,team)=>sum+team.totalCount,0),october.totalCount);
 assert.equal(JSON.stringify([...legacyDocs,...extraDocs].map(x=>x.data())),untouched);
 assert.doesNotMatch(JSON.stringify(october),/123456789|999999|987654321|totalRevenue|price|unitPrice|retired/);
});
test("OFF hides only new product monthly ranking counts without deleting saved ledgers",()=>{
 const before=JSON.stringify(extraDocs.map(x=>x.data()));
 const visible=read("2026-10");
 const hidden=read("2026-10",[]);
 assert.equal(visible.totalCount,9);
 assert.equal(hidden.totalCount,4);
 assert.equal(hidden.additionalTotalCount,0);
 assert.deepEqual(hidden.teams.map(t=>t.extraCounts),[{},{}]);
 assert.equal(JSON.stringify(extraDocs.map(x=>x.data())),before);
 assert.deepEqual(read("2026-10"),visible,"ON returns the exact original totals");
});
test("shared monthly API response explicitly identifies the approved workspace and strips finance",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const read=service.slice(service.indexOf(" async function viewMonthly(request){"),
  service.indexOf(" async function view(request){"));
 assert.match(read,/await sharedRankScope\(a\.uid,d\.workspaceCompanyId\)/);
 assert.match(read,/workspaceCompanyId:s\.cid/);
 assert.match(read,/publishedProducts:rankableProducts\.map/);
 assert.match(read,/complete:false/);
 assert.doesNotMatch(read,/tx\.(?:set|update|create|delete)\(/);
 const projection=fs.readFileSync(require.resolve("../functions-partner-workspace/monthly-shared-projection.cjs"),"utf8");
 assert.match(projection,/companyId:cid/);
 assert.match(projection,/t\.extraCounts\[productId\]/);
});
test("dashboard month selector and team detail use monthly API, not daily date or finance reads",()=>{
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 assert.match(html,/id="pInlineDashboardMonth" type="month"/);
 assert.match(html,/id="pInlineDate" type="date"/);
 assert.match(html,/id="pInlineTeamDetailsTitle"/);
 assert.match(html,/id="partnerSharedDetailTitle"/);
 const start=html.indexOf("async function loadPartnerDashboardMonth(");
 const end=html.indexOf("pInline(\"pInlineDashboardMonth\").value=",start);
 assert.ok(start>0&&end>start);
 const source=html.slice(start,end);
 assert.match(source,/await readPartnerMonthlySharedCounts\(payload\)/);
 assert.match(source,/renderPartnerDashboardMonth\(data,month\)/);
 assert.match(source,/auth\.currentUser\?\.uid!==uid/);
 assert.match(source,/workspace!==partnerInlineWorkspaceCompany/);
 assert.match(source,/pInline\("pInlineDashboardMonth"\)\.value!==month/);
 assert.doesNotMatch(source,/setDoc\(|updateDoc\(|deleteDoc\(|addDoc\(/);
 const render=html.slice(html.indexOf("function renderPartnerDashboardMonth("),start);
 assert.match(render,/team\.totalCount/);
 assert.match(render,/company\.totalCount/);
 assert.match(render,/partner_month_team_total_mismatch/);
 assert.match(render,/partnerPublishedProductNames=monthNames/);
 assert.match(render,/appendPartnerMonthCompany/);
 assert.match(render,/pPartnerDailyCount/);
 assert.doesNotMatch(render,/readPartnerWorkDay\(/);
 // No one-day saved report can replace the displayed month on re-render.
 const day=html.slice(html.indexOf("function partnerInlineRender(){"),
  html.indexOf("// Open a saved person's latest counts directly",html.indexOf("function partnerInlineRender(){")));
 assert.doesNotMatch(day,/pInline\("pInlineTeamDetails"\)\.replaceChildren/);
 assert.doesNotMatch(day,/pInline\("pPartnerDailyCount"\)\.textContent/);
});
