"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs");
const {isDirectCountIntegrityError,MONTHLY_DIRECT_COUNTS_UNVERIFIED}=
 require("../functions-partner-workspace/monthly-integrity-gate.cjs");
const {readDirectRangeCounts}=require("../functions-partner-workspace/shared-direct-counts.cjs");
const {projectPartnerMonth}=require("../functions-partner-workspace/monthly-shared-projection.cjs");
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
 assert.match(fragment,/directIntegrityUnverified=true/);
 assert.match(fragment,/if\(!isDirectCountIntegrityError\(error\)\)fail\("failed-precondition"\)/);
 assert.match(fragment,/includesDirect:!directIntegrityUnverified/);
 assert.match(fragment,/direct\?\.recordsVerified\?\?null/);
 assert.match(fragment,/if\(!directIntegrityUnverified\)/);
 assert.match(fragment,/groupStandings=\[\]/);
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
 const render=html.slice(html.indexOf("function renderPartnerDashboardMonth("),
  html.indexOf("async function loadPartnerDashboardMonth("));
 assert.match(render,/directPending=data\.directIntegrityUnverified===true/);
 assert.match(render,/includesDirect!==false/);
 assert.match(render,/partnerMainAppendRow\(shared,"🏢 直営｜件数未照合"/);
 assert.match(render,/合同ランキングは非表示・未確定/);
 assert.match(html,/throw Error\("monthly_direct_integrity_unverified"\)/);
 assert.match(html,/協力店の月別ダッシュボードは確認できます/);
 assert.match(section,/pInline\(id\)\.textContent="-"/);
 assert.match(section,/pInline\(id\)\.replaceChildren\(\)/);
 assert.match(section,/未確認の件数を0件とせず/);
 const ranking=html.slice(html.indexOf("async function loadPartnerMonthlySharedRankings("));
 assert.match(ranking,/MONTHLY_DIRECT_COUNTS_UNVERIFIED/);
 assert.match(ranking,/status\.textContent=historicalCountMismatch\?/);
 assert.match(ranking,/content\.replaceChildren\(\)/);
});


test("one inconsistent legacy company record never deletes independently saved partner October ledger",async()=>{
 const directRow={companyId:"hub",date:"2026-10-20",uid:"u1",
  teamId:"internalTeam",memberNameSnapshot:"直営担当",totalCount:1,
  results:[{productId:"nuro",productNameSnapshot:"NURO光",count:2}],
  totalRevenue:99887766,unitPrice:887766};
 const partnerSaved={companyId:"partner",hubCompanyId:"hub",date:"2026-10-20",
  staffId:"staff1",staffNameSnapshot:"協力店担当",teamIdSnapshot:"team1",
  counts:{NURO:3},totalCount:3,version:1,privateCounts:{},
  privateTotalCount:0,totalRevenue:1234567};
 const before=JSON.stringify([directRow,partnerSaved]);
 const db={collection(name){
  return {where(){return this;},limit(){return this;},
   async get(){const docs=name==="records"?[{id:"old",data:()=>directRow}]:[];
    return {size:docs.length,docs};}};
 }};
 await assert.rejects(readDirectRangeCounts(db,"hub","2026-10-01",
  "2026-10-31",["NURO"],{maxRecords:10000}),/DIRECT_TOTAL_MISMATCH/);
 const result=projectPartnerMonth({
  hubId:"hub",cid:"partner",companyName:"協力店A",
  from:"2026-10-01",to:"2026-10-31",keys:["NURO"],
  teamNames:{team1:"協力店第1班"},publishedIds:[],linkedIds:[],
  legacyDocs:[{id:"2026-10-20__staff1",data:()=>partnerSaved}],extraDocs:[]
 });
 assert.equal(result.totalCount,3);
 assert.equal(result.verifiedEntryCount,1);
 assert.equal(result.teams[0].totalCount,3);
 assert.deepEqual(result.counts,{NURO:3});
 assert.equal(JSON.stringify([directRow,partnerSaved]),before,
  "no re-price, zero-fill, record rewrite, or historical deletion");
 assert.doesNotMatch(JSON.stringify(result),/99887766|887766|1234567|totalRevenue|unitPrice/);
});
