"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {projectPartnerProductMonth}=require("../functions-partner-workspace/partner-product-monthly.cjs");
const {KEYS}=require("../functions-partner-workspace/service.cjs");
const zeros=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const doc=(date,id,data)=>({id:date+"__"+id,data:()=>({
 companyId:"partnerA",hubCompanyId:"hubA",staffId:id,date,version:1,...data
})});
const month=(workDocs=[],extraDocs=[])=>projectPartnerProductMonth({
 hubId:"hubA",cid:"partnerA",month:"2026-11",keys:KEYS,workDocs,extraDocs
});
function saved(date,id,nums,privateNums={}){
 const counts={...zeros(),...nums};
 return doc(date,id,{counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0),
  privateCounts:privateNums,privateTotalCount:Object.values(privateNums).reduce((a,b)=>a+b,0)});
}
function extra(date,id,counts){
 return doc(date,id,{counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0)});
}
test("two saved days produce month totals across 9 parent categories, private and added products",()=>{
 const result=month([
  saved("2026-11-01","one",{NURO:2,SBMNP:1},{privateA:2}),
  saved("2026-11-02","one",{NURO:2},{privateA:4})
 ],[
  extra("2026-11-01","one",{extraSolar:1}),
  extra("2026-11-02","one",{extraSolar:3})
 ]);
 assert.equal(result.primaryTotalCount,5);
 assert.equal(result.counts.NURO,4);
 assert.equal(result.counts.SBMNP,1);
 assert.equal(result.privateTotalCount,6);
 assert.equal(result.privateCounts.privateA,6);
 assert.equal(result.additionalTotalCount,4);
 assert.equal(result.additionalCounts.extraSolar,4);
 assert.equal(result.totalCount,15);
 assert.equal(result.verifiedWorkRows,2);
 assert.equal(result.verifiedExtraRows,2);
 assert.equal(result.complete,false);
 assert.deepEqual(result.categories,KEYS);
});
test("missing reports are unverified, not a confirmed zero-sales month",()=>{
 const result=month();
 assert.equal(result.totalCount,0);
 assert.equal(result.complete,false);
 assert.equal(result.verifiedWorkRows,0);
 assert.equal(result.verifiedExtraRows,0);
});
test("historical retired private and unpublished extra quantities remain counted, not deleted",()=>{
 const result=month([saved("2026-11-01","departed",{YMMNP:2},{retired:3})],
  [extra("2026-11-01","departed",{archivedExtra:5})]);
 assert.equal(result.totalCount,10);
 assert.equal(result.privateCounts.retired,3);
 assert.equal(result.additionalCounts.archivedExtra,5);
 assert.deepEqual(result.counts,{...zeros(),YMMNP:2});
});
test("reject misattributed, damaged, duplicated and missing monthly originals without writes",()=>{
 const valid=saved("2026-11-01","one",{NURO:1},{privateA:2});
 const mutations=[
  {counts:{NURO:1}}, {totalCount:55}, {totalCount:null},
  {counts:{...zeros(),NURO:null}},
  {privateTotalCount:3}, {privateCounts:{privateA:null}},
  {companyId:"different"}, {hubCompanyId:"other"}, {date:"2026-10-01"},
  {version:0}, {staffId:"different"}
 ];
 for(const patch of mutations){
  const damaged=doc("2026-11-01","one",{...valid.data(),...patch});
  assert.throws(()=>month([damaged]),/UNVERIFIED/,JSON.stringify(patch));
 }
 assert.throws(()=>month([valid,valid]),/UNVERIFIED/);
 assert.throws(()=>month([valid],[extra("2026-11-01","one",{a:1}),extra("2026-11-01","one",{a:1})]),/UNVERIFIED/);
 assert.throws(()=>month([], [doc("2026-11-01","one",{counts:{extra:2},totalCount:3})]),/UNVERIFIED/);
});
test("linked master product cannot be double-counted as an additional sale",()=>{
 assert.throws(()=>projectPartnerProductMonth({
  hubId:"hubA",cid:"partnerA",month:"2026-11",keys:KEYS,
  workDocs:[saved("2026-11-01","one",{NURO:2})],
  extraDocs:[extra("2026-11-01","one",{linkedMaster:2})],
  linkedIds:["linkedMaster"]
 }),/UNVERIFIED/);
 assert.equal(projectPartnerProductMonth({
  hubId:"hubA",cid:"partnerA",month:"2026-11",keys:KEYS,
  workDocs:[saved("2026-11-01","one",{NURO:2})],
  extraDocs:[extra("2026-11-01","one",{newProduct:3})],
  linkedIds:["linkedMaster"]
 }).totalCount,5);
});
test("return contract is count-only, even with deliberately planted fake finance fields",()=>{
 const a=saved("2026-11-01","one",{NURO:4},{privateA:2});
 const rec=doc("2026-11-01","one",{...a.data(),revenue:543210,unitPrice:90000,price:25000,
  staffEmail:"secret@example.test"});
 const actual=month([rec],[extra("2026-11-02","one",{extraSolar:1})]);
 const wire=JSON.stringify(actual);
 assert.equal(actual.totalCount,7);
 assert.doesNotMatch(wire,/543210|90000|25000|secret@example|revenue|price|email|staffId|uid/i);
});
test("server requires verified partner scope and reads only its own count-only collections",()=>{
 const service=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/service.cjs"),"utf8");
 const backend=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/index.js"),"utf8");
 const start=service.indexOf(" async function viewProductMonthly(request){");
 const end=service.indexOf(" async function viewMonthly(request){",start);
 assert.ok(start>=0&&end>start);
 const scoped=service.slice(start,end);
 assert.match(scoped,/const a=await actor\(request\)/);
 assert.match(scoped,/await scope\(a.uid,null,d.workspaceCompanyId\)/);
 assert.match(scoped,/s.kind!=="partner"/);
 assert.match(scoped,/collection\(s.cid,"partnerWorkEntries"\)/);
 assert.match(scoped,/collection\(s.cid,"partnerAdditionalCountEntries"\)/);
 assert.match(scoped,/limit\(2001\)/);
 assert.match(scoped,/countLinksRef\(s\.hubId\)\.get\(\)/);
 assert.match(scoped,/linkedIds:linked\.map\(link=>link\.productId\)/);
 assert.match(scoped,/if\(work.size>2000\|\|extra.size>2000\)/);
 assert.doesNotMatch(scoped,/db\.collection\("(records|products|revenueGoals|recordCorrections)"\)|(?:tx\.)?(?:set|create|update|delete)\(/);
 assert.match(backend,/exports\.getPartnerProductMonthlyTotals=onCall\(opts,service.viewProductMonthly\)/);
});
test("partner product and management tabs use HQ summary-row and verified monthly API, not daily-only rows",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(app,/id="partnerProductMonth"/);
 assert.match(app,/id="partnerCatalogMonth"/);
 assert.match(app,/id="pPartnerProductSummary"/);
 assert.match(app,/id="partnerCatalogProductMonthlyRows"/);
 assert.match(app,/readPartnerProductMonthlyTotals\(partnerInlinePayload\(\{month\}\)\)/);
 assert.match(app,/renderPartnerProductMonthlySummary\(data\)/);
 assert.match(app,/row\.className="summary-row"/);
 assert.match(app,/amount\.textContent=item\.count\+"件"/);
 assert.match(app,/complete!==false/);
 assert.match(app,/未報告の日を0件として集計していません/);
 const section=app.slice(app.indexOf("const byProduct=new Map(categories.map"),app.indexOf("const lines=[snap.companyName",app.indexOf("const byProduct=new Map(categories.map")));
 assert.doesNotMatch(section,/pPartnerProductSummary/);
 assert.doesNotMatch(section,/partnerMainAppendRow\(products/);
 assert.doesNotMatch(app.slice(app.indexOf("function renderPartnerProductMonthlySummary("),
  app.indexOf("function renderPartnerPrivateProductCatalog(")),/totalRevenue|revenuePerUnit|unitPrice|pricingOptions|formatYen/);
});
