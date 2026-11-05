"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs");
const {isDirectCountIntegrityError,MONTHLY_DIRECT_COUNTS_UNVERIFIED}=
 require("../functions-partner-workspace/monthly-integrity-gate.cjs");
test("all known historic direct quantity violations withhold entire monthly rankings",()=>{
 for(const kind of ["DIRECT_TOTAL_UNVERIFIED","DIRECT_INVALID_QUANTITY",
  "DIRECT_TOTAL_MISMATCH","DIRECT_CATEGORY_MISMATCH",
  "DIRECT_DUPLICATE_PERSON_DAY","DIRECT_RECORD_SHAPE_UNVERIFIED"])
  assert.equal(isDirectCountIntegrityError(Error(kind)),true,kind);
});
test("unrelated network, privilege, scope and malformed errors never pretend to be a known count mismatch",()=>{
 for(const item of [null,undefined,{},Error("Permission denied"),
  Error("DIRECT_SCOPE_MISMATCH"),Error("DIRECT_READ_BUDGET_EXCEEDED"),
  Error("DIRECT_TOTAL_MISMATCH: user=a"),"DIRECT_TOTAL_MISMATCH"])
  assert.equal(isDirectCountIntegrityError(item),false,String(item));
});
test("raw amounts, IDs, prices and document contents never form the public reason marker",()=>{
 assert.equal(MONTHLY_DIRECT_COUNTS_UNVERIFIED,"MONTHLY_DIRECT_COUNTS_UNVERIFIED");
 assert.doesNotMatch(MONTHLY_DIRECT_COUNTS_UNVERIFIED,/uid|email|price|revenue|円|amount/i);
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const from=service.indexOf(" async function viewMonthly(request){");
 const to=service.indexOf(" async function view(request){",from);
 assert.ok(from>0&&to>from);
 const fragment=service.slice(from,to);
 assert.match(fragment,/isDirectCountIntegrityError\(error\)/);
 assert.match(fragment,/new HttpsError\("failed-precondition",MONTHLY_DIRECT_COUNTS_UNVERIFIED\)/);
 assert.match(fragment,/maxRecords:10000/);
 assert.match(fragment,/complete:false/);
 assert.doesNotMatch(fragment,/tx\.(set|create|update|delete)\(/);
});
test("month dashboard and rankings clear old cards and never show a fabricated zero during an integrity block",()=>{
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 const start=html.indexOf("async function loadPartnerDashboardMonth(");
 const end=html.indexOf('pInline("pInlineDashboardMonth").value=',start);
 const section=html.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(section,/MONTHLY_DIRECT_COUNTS_UNVERIFIED/);
 assert.match(section,/pInline\(id\)\.textContent="-"/);
 assert.match(section,/pInline\(id\)\.replaceChildren\(\)/);
 assert.match(section,/未確認の件数を0件とせず/);
 const ranking=html.slice(html.indexOf("async function loadPartnerMonthlySharedRankings("));
 assert.match(ranking,/MONTHLY_DIRECT_COUNTS_UNVERIFIED/);
 assert.match(ranking,/status\.textContent=historicalCountMismatch\?/);
 assert.match(ranking,/content\.replaceChildren\(\)/);
});
