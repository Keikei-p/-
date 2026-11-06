"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function fixture() {
  const start = html.indexOf("function readOnlyRecordCountEvidence(");
  const end = html.indexOf("async function persistDailyRecord(", start);
  assert.ok(start > 0 && end > start, "read-only helpers are bounded by unchanged write function");
  const owner = {
    currentUser: {uid:"hubOwner"},
    currentUserData: {companyId:"hub", companyRole:"owner", accessKind:"internal", memberType:"internal"},
    currentCompanyData: {ownerUid:"hubOwner",companyKind:"internal"},
    partnerInlineWorkspaceCompany: null,
    isCurrentCompanyOwner: () => true,
    canCurrentUserViewRevenue: () => true
  };
  const context = vm.createContext(owner);
  vm.runInContext(html.slice(start, end), context);
  return context;
}
function asJson(x) { return JSON.parse(JSON.stringify(x)); }
function row(patch={}) {
  return {companyId:"hub", date:"2026-10-21",totalCount:2,
    results:{a:{count:1,revenuePerUnit:90000},b:{count:2,revenuePerUnit:0}},
    ...patch};
}
test("stored count differs from product lines; never guesses which is true",()=>{
  const c=fixture(), original=row(), before=JSON.stringify(original);
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(original)),{saved:2,lines:3});
  assert.deepEqual(asJson(c.selectOwnerCountIntegrityRows([original],"2026-10")),[original]);
  assert.equal(JSON.stringify(original),before,"no deletion, reprice, recomputation or source write");
});
test("consistent saved records and explicit zero-count reports are not false mismatches",()=>{
  const c=fixture();
  assert.equal(c.readOnlyRecordCountEvidence(row({totalCount:3})),null);
  assert.equal(c.readOnlyRecordCountEvidence(row({results:{},totalCount:0})),null);
  assert.equal(c.readOnlyRecordCountEvidence(row({results:[{count:2}],totalCount:2})),null);
  assert.equal(c.readOnlyRecordCountEvidence(row({
    results:null,productId:"a",count:2,totalCount:2})),null);
  assert.deepEqual(asJson(c.selectOwnerCountIntegrityRows([row({totalCount:3})],"2026-10")),[]);
});
test("missing, invalid and overflowing counts are unknown, never invented zeros",()=>{
  const c=fixture();
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(row({totalCount:undefined}))),
    {saved:null,lines:3});
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(row({results:{a:{count:null}}}))),
    {saved:2,lines:null});
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(row({results:{a:{count:-1}}}))),
    {saved:2,lines:null});
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(row({
    results:{a:{count:Number.MAX_SAFE_INTEGER},b:{count:3}}}))),
    {saved:2,lines:null});
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(row({totalCount:"2"}))),
    {saved:2,lines:3});
  assert.deepEqual(asJson(c.readOnlyRecordCountEvidence(row({totalCount:"not_number"}))),
    {saved:null,lines:3});
});
test("only actual current hub Owner can inspect selected month; partner identities and other companies denied",()=>{
  const c=fixture(), target=row(), foreign=row({companyId:"other",date:"2026-10-22"});
  assert.deepEqual(asJson(c.selectOwnerCountIntegrityRows([
    target,foreign,row({date:"2026-11-22"}),"bad",null
  ],"2026-10")),[target]);
  const denied=[
    ["no-uid"],
    ["partner-workspace"],
    ["partner-access"],
    ["dual-role"],
    ["partner-company"],
    ["foreign-owner"],
    ["foreign-company"],
    ["invalid-month"],
    ["not-owner"],
    ["no-revenue-right"]
  ];
  for(const [label] of denied){
    const sandbox=fixture();
     // Apply each scenario to its own context rather than share state.
    if(label==="no-uid")sandbox.currentUser=null;
    if(label==="partner-workspace")sandbox.partnerInlineWorkspaceCompany="partner";
    if(label==="partner-access")sandbox.currentUserData.accessKind="partner";
    if(label==="dual-role")sandbox.currentUserData.memberType="cooperator";
    if(label==="partner-company")sandbox.currentCompanyData.companyKind="partner";
    if(label==="foreign-owner")sandbox.currentCompanyData.ownerUid="different";
    if(label==="foreign-company")sandbox.currentUserData.companyId="other";
    if(label==="not-owner")sandbox.isCurrentCompanyOwner=()=>false;
    if(label==="no-revenue-right")sandbox.canCurrentUserViewRevenue=()=>false;
    const month=label==="invalid-month"?"2026-13":"2026-10";
    assert.equal(sandbox.selectOwnerCountIntegrityRows([target],month).length,0,label);
  }
});
test("Owner warning is scoped to existing monthly history; editing invalid record is disabled",()=>{
  assert.match(html,/id="ownerCountIntegrityReview"[^>]*hidden/);
  const start=html.indexOf("function renderRecordHistory(");
  const end=html.indexOf("function editRecord(",start);
  assert.ok(start>0&&end>start);
  const history=html.slice(start,end);
  for(const token of [
    'selectOwnerCountIntegrityRows(currentRecordHistoryMonthly, selectedMonth)',
    "review.hidden = true;","review.replaceChildren();","review.hidden = false;",
    "recordHistoryDate.value = record.date;",
    "renderRecordHistory(currentRecordHistoryMonthly);",
    "const canCorrect = !inconsistent &&",
    "readOnlyRecordCountEvidence(record) !== null"
  ])assert.ok(history.includes(token),token);
  assert.doesNotMatch(history,/\b(runTransaction|setDoc|updateDoc|deleteDoc|httpsCallable|getDocsFromServer)\s*\(/);
  const edit=html.slice(end,html.indexOf("/* =====================================================\n   実績削除",end));
  assert.ok(edit.includes("readOnlyRecordCountEvidence(record) !== null"),"direct edit guarded");
  assert.ok(edit.includes("canCurrentUserCorrectRecord(record)"),"prior correction permissions retained");
});
