"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync("index.html","utf8");
const extract=(start,end)=>{
 const a=html.indexOf(start);
 const b=html.indexOf(end,a+start.length);
 assert(a>=0&&b>a,"guard contract not found: "+start);
 return html.slice(a,b);
};
const guards=extract("function recordSaveContentSignature(record) {",
 "function recordConflict(message) {");
const guardsHarness=vm.runInNewContext(guards+
 "this.signature=recordSaveContentSignature;"+
 "this.uncertain=recordConfirmationUncertain;",{});
const validator=vm.runInNewContext(
 "function recordConflict(message){const e=new Error(message);e.code='record-conflict';return e;}"+
 extract("function validateFinancialRecordForSave(data) {",
 "function calculateResultsTotals(")+
 "this.validate=validateFinancialRecordForSave;",{});
const sample=()=>({
 companyId:"hub",uid:"salesperson",date:"2026-11-11",teamId:"team",
 workLocation:"",reportStatus:"submitted",totalCount:2,totalRevenue:2000,
 results:{skuA:{productId:"skuA",count:2,revenuePerUnit:1000,cashback:0}},
 updatedAt:{seconds:1}
});
const clone=x=>JSON.parse(JSON.stringify(x));
test("saved financial fields match only when all map rows, counts, price and CB are identical",()=>{
 const expected=sample();
 const reordered=clone(expected);
 reordered.results={skuA:{cashback:0,revenuePerUnit:1000,count:2,productId:"skuA"}};
 reordered.updatedAt={seconds:999};
 assert.equal(guardsHarness.signature(reordered),guardsHarness.signature(expected));
 const drift=[
  x=>{x.results.skuOld={productId:"old",count:1,revenuePerUnit:500,cashback:0};},
  x=>{delete x.results.skuA;},
  x=>{x.results.skuA.count=3;},
  x=>{x.results.skuA.revenuePerUnit=500;},
  x=>{x.results.skuA.cashback=5000;},
  x=>{x.totalCount=3;},
  x=>{x.totalRevenue=3000;},
  x=>{x.uid="someoneElse";},
  x=>{x.companyId="foreign";},
  x=>{x.date="2026-11-10";},
  x=>{x.reportStatus="no_result";}
 ];
 for(const mutate of drift){
  const value=clone(expected);mutate(value);
  assert.notEqual(guardsHarness.signature(value),guardsHarness.signature(expected));
 }
 assert.deepEqual(expected,sample(),"evidence is read-only");
});
test("legacy stale line and amount mismatch cannot pass finance-source integrity validation",()=>{
 const data=sample();
 assert.equal(validator.validate(data),true);
 const bad=clone(data);
 bad.results.old={productId:"old",count:1,revenuePerUnit:1000,cashback:0};
 assert.throws(()=>validator.validate(bad),/一致しません/);
 const total=clone(data);total.totalRevenue=3000;
 assert.throws(()=>validator.validate(total),/一致しません/);
 const missing=clone(data);delete missing.results.skuA.revenuePerUnit;
 assert.throws(()=>validator.validate(missing),/未設定/);
});
test("post-commit confirmation requires server read and never asks unsafe duplicate resubmission",()=>{
 const code=extract("async function persistDailyRecord(","function findDailyRecord(");
 assert.match(code,/validateFinancialRecordForSave\(current\)/);
 assert.match(code,/transaction\.set\(recordRef, data, \{mergeFields: Object\.keys\(data\)\}\)/);
 assert.match(code,/if \(writeCorrection\) writeCorrection\(transaction\)/);
 const save=extract("await persistDailyRecord(recordRef, data, existingDailyRecord, editingRecordRevision, writeCorrection);",
 "editingRecordRevision = recordRevision(confirmedRecord);");
 assert.match(save,/getDocFromServer\(recordRef\)/);
 assert.match(save,/validateFinancialRecordForSave\(persisted\)/);
 assert.match(save,/recordSaveContentSignature\(persisted\)/);
 assert.match(save,/recordSaveContentSignature\(data\)/);
 assert.doesNotMatch(save,/await getDoc\(/);
 const error=guardsHarness.uncertain();
 assert.equal(error.code,"record-confirmation-uncertain");
 assert.match(error.message,/再登録せず/);
 assert.match(html,/error\?\.code === "record-confirmation-uncertain"/);
});
