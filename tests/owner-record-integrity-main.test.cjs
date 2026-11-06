"use strict";
// No Firebase credentials or live data. Only synthetic copies.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
function slice(start,end) {
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert(a>=0 && b>a,"expected code section "+start);
 return html.slice(a,b);
}
const evidenceSrc=slice("function readOnlyRecordCountEvidence(","async function persistDailyRecord(");
const evidence=vm.runInNewContext(evidenceSrc+";readOnlyRecordCountEvidence");
const healthy={companyId:"hub",uid:"h",date:"2026-10-21",totalCount:2,
 results:{a:{count:1,revenuePerUnit:40000},b:{count:1,revenuePerUnit:35000}},
 totalRevenue:75000};
test("actual extra product line is evidence only; no historical value is changed",()=>{
 const corrupted={...healthy,results:{...healthy.results,orphan:{count:1,revenuePerUnit:0}}};
 const original=JSON.stringify(corrupted);
 assert.deepEqual(JSON.parse(JSON.stringify(evidence(corrupted))),{saved:2,lines:3});
 assert.equal(JSON.stringify(corrupted),original);
 assert.equal(evidence(healthy),null);
 assert.equal(evidence({...healthy,totalCount:0,results:{}}),null,
  "a saved 0 is a valid confirmed report");
});
test("unknown or overflowed quantities stay unknown instead of becoming zero",()=>{
 for(const [record,expected] of [
  [{...healthy,totalCount:undefined},{saved:null,lines:2}],
  [{...healthy,results:{a:{count:null}}},{saved:2,lines:null}],
  [{...healthy,results:{a:{count:-1}}},{saved:2,lines:null}],
  [{...healthy,results:{a:{count:1.5}}},{saved:2,lines:null}],
  [{...healthy,results:{a:{count:Number.MAX_SAFE_INTEGER},b:{count:5}}},{saved:2,lines:null}],
  [{...healthy,results:"not-a-ledger"},{saved:2,lines:null}],
  [{...healthy,results:[{count:2},{count:1}]},{saved:2,lines:3}],
  [{...healthy,results:{a:{count:"1"},b:{count:"1"}}},null]
 ]) {
  const v=evidence(record);
  assert.deepEqual(v===null?null:JSON.parse(JSON.stringify(v)),expected);
 }
});
test("existing historical corruption blocks only that record's correction transaction",async()=>{
 const saved=[],base={...healthy};
 const scope={
  recordConflict:message=>Object.assign(new Error(message),{code:"record-conflict"}),
  readOnlyRecordCountEvidence:evidence,
  getDocsFromServer:async()=>({size:1,docs:[{id:"r1"}]}),
  query:()=>({}),recordsCollectionQuery:()=>({}),where:()=>({}),
  db:{},recordRevision:()=>"unchanged",
  runTransaction:async(_db,callback)=>callback({
   get:async()=>({id:"r1",exists:()=>true,data:()=>scope.stored}),
   set:(...args)=>saved.push(args)
  }),
  stored:base
 };
 const persist=vm.runInNewContext(
  slice("async function persistDailyRecord(","function findDailyRecord(")+
  ";persistDailyRecord",scope);
 const ref={id:"r1"};
 await persist(ref,base,base,"unchanged");
 assert.equal(saved.length,1,"consistent existing sales still save");
 scope.stored={...base,results:{...base.results,orphan:{count:1}}};
 await assert.rejects(persist(ref,base,base,"unchanged"),
  e=>e?.code==="record-conflict");
 assert.equal(saved.length,1,"damaged record was never overwritten");
});
test("review is owner-only, same-company, selected month, hidden by default",()=>{
 assert.match(html,/id="ownerCountIntegrityReview"[^>]*hidden/);
 const src=slice("function renderRecordHistory(","function editRecord(");
 for(const condition of [
  "isCurrentCompanyOwner()",
  "canCurrentUserViewRevenue()",
  "!partnerInlineWorkspaceCompany",
  'currentUserData?.accessKind !== "partner"',
  'currentCompanyData.companyKind === "internal"',
  "record.companyId === currentUserData?.companyId",
  'record.date.startsWith(selectedMonth + "-")',
  "review.hidden = true",
  "review.replaceChildren()",
  "review.hidden = false",
  "recordHistoryDate.value = record.date",
  "const canCorrect = !inconsistent &&"
 ])assert(src.includes(condition),"missing owner guard: "+condition);
 assert.doesNotMatch(src,/getDocsFromServer|httpsCallable|runTransaction|setDoc|updateDoc|deleteDoc/);
});
test("direct editing and transactional save both fail closed for inconsistent originals",()=>{
 const edit=slice("function editRecord(","/* =====================================================\n   実績削除");
 const persist=slice("async function persistDailyRecord(","function findDailyRecord(");
 assert(edit.includes("readOnlyRecordCountEvidence(record) !== null"));
 assert(persist.includes("readOnlyRecordCountEvidence(current) !== null"));
 assert.match(persist,/transaction\.set\(recordRef, data, \{mergeFields: Object\.keys\(data\)\}\)/,
  "existing consistent save implementation must be preserved");
});
