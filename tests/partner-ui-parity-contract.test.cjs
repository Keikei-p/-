"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
test("partner count save looks up existing record before hidden OFF category serialization",()=>{
 const start=html.lastIndexOf("const counts=Object.create(null);",html.indexOf("const parsedCb=partnerInlineSelectedCb()"));
 const before=html.lastIndexOf("const before=snap.records.find",start);
 assert.ok(before>0&&before<start,"prior entry must be initialized before count loop");
});
test("count-only team detail includes NURO product counts when CB breakdown is hidden",()=>{
 assert.match(html,/function renderPartnerCountTeamCard\([^]*?showCb=false/);
 assert.match(html,/if\(showCb&&\(nuro>0\|\|tiers\)\)/);
 assert.match(html,/for\(const key of keys\)\{\s*const n=counts\[key\]\?\?0;\s*if\(!n\)continue;/);
});
test("partner input preserves historical OFF values but hides unused categories",()=>{
 assert.match(html,/if\(unavailable&&historicalCount===0\)continue/);
 assert.match(html,/legacyCategoryPublication\?\.some\(x=>x.category===key&&x.acceptsIncrease===false\)/);
});
test("partner and hub team trees use the same count-only card renderer",()=>{
 assert.match(html,/function renderPartnerFlatTeamDetails\(/);
 assert.match(html,/function renderSharedCountTeamDetails\(/);
 assert.ok((html.match(/renderPartnerCountTeamCard\(/g)||[]).length>=4);
});

test("NURO partner input never restores cashback wording after count edit",()=>{
 const render=html.slice(html.indexOf("function renderPartnerEntryTotals()"),html.indexOf("function renderPartnerEntryTotals()")+1700);
 assert.match(render,/NURO光｜件数入力（合計 /);
 assert.doesNotMatch(render,/NURO光｜CB別件数/);
});

test("optional team breakdown labels never reveal cashback monetary tiers",()=>{
 const start=html.indexOf("function renderPartnerCountTeamCard(");
 const end=html.indexOf("function renderPartnerFlatTeamDetails(",start);
 const card=html.slice(start,end);
 assert.match(card,/section\("NURO光｜件数内訳"\)/);
 assert.match(card,/label\.textContent="件数区分 "/);
 assert.doesNotMatch(card,/label\.textContent=tier==="0"\?"CB0"/);
});

test("partner count UI uses competition ties for team person and product ranks",()=>{
 const workspace=fs.readFileSync(path.join(__dirname,"../partner-workspace.html"),"utf8");
 const start=workspace.indexOf("function mapCountRanks(");
 const end=workspace.indexOf("function renderTeamCountDetail()",start);
 assert.ok(start>0&&end>start);
 const vm=require("node:vm");
 const rank=vm.runInNewContext(workspace.slice(start,end)+"\nmapCountRanks");
 const values=[{count:5},{count:5},{count:2},{count:2},{count:1}];
 assert.deepEqual(Array.from(rank(values,x=>x.count,(_,r)=>r)),[1,1,3,3,5]);
 assert.throws(()=>rank([{count:-1}],x=>x.count,(_,r)=>r),/invalid count rank/);
 assert.match(workspace,/mapCountRanks\(summary\.groups/);
 assert.match(workspace,/mapCountRanks\(summary\.people/);
 assert.match(workspace,/mapCountRanks\(people,p=>p\.count/);
 assert.match(workspace,/mapCountRanks\(Object\.entries\(summary\.products\)/);
 assert.match(workspace,/mapCountRanks\(groupedProductCounts\(/);
});
