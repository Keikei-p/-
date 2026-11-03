"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const html=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");
test("owner sales save still rejects inconsistent stored total AND revenue before any transaction",()=>{
 const v=html.indexOf("function validateFinancialRecordForSave(data)");
 const call=html.indexOf("validateFinancialRecordForSave(data);",v+45);
 const correction=html.indexOf("const writeCorrection = existingDailyRecord",call);
 const persist=html.indexOf("await persistDailyRecord(recordRef, data",correction);
 assert.ok(v>0&&call>v&&correction>call&&persist>correction);
 const method=html.slice(v,html.indexOf("function calculateResultsTotals(",v));
 assert.match(method,/count !== Number\(data\.totalCount\)/);
 assert.match(method,/revenue !== Number\(data\.totalRevenue\)/);
 assert.match(method,/throw recordConflict/);
});
test("corrections remain atomic, append-only and old records are updated with readback",()=>{
 const start=html.indexOf("async function persistDailyRecord(");
 const end=html.indexOf("function findDailyRecord(",start);
 assert.ok(start>0&&end>start);
 const method=html.slice(start,end);
 assert.match(method,/daily\.size > 1/);
 assert.match(method,/expectedRevision/);
 assert.match(method,/transaction\.set\(recordRef, data, \{mergeFields: Object\.keys\(data\)\}\)/);
 assert.match(method,/if \(writeCorrection\) writeCorrection\(transaction\)/);
 assert.doesNotMatch(method,/transaction\.delete\(/);
 const correctionStart=html.indexOf("const writeCorrection = existingDailyRecord");
 const correctionEnd=html.indexOf("await persistDailyRecord(recordRef, data",correctionStart);
 const correction=html.slice(correctionStart,correctionEnd);
 assert.match(correction,/recordCorrections/);
 assert.match(correction,/before: \{/);
 assert.match(correction,/after: \{/);
 assert.match(correction,/transaction\.set/);
 const saved=html.slice(correctionEnd,correctionEnd+500);
 assert.match(saved,/getDoc\(/);
});


// Match the reviewed release-safe guard, but keep the partner-rank UI intact.
test("current stored totals are verified before any correction transaction writes",()=>{
 const vm=require("node:vm");
 const begin=html.indexOf("function isPersistedRecordCountConsistent(record) {");
 const end=html.indexOf("async function persistDailyRecord(",begin);
 assert.ok(begin>0&&end>begin);
 const sandbox={};
 vm.runInNewContext(html.slice(begin,end)+";this.guard=isPersistedRecordCountConsistent;",sandbox);
 const check=sandbox.guard;
 assert.equal(check({totalCount:2,results:{a:{count:1},b:{count:"1"}}}),true);
 assert.equal(check({totalCount:0,results:{}}),true);
 assert.equal(check({totalCount:1,results:{a:{count:1},b:{count:1}}}),false);
 assert.equal(check({totalCount:2,results:{a:{count:1}}}),false);
 assert.equal(check({totalCount:1,results:{a:{count:""}}}),false);
 assert.equal(check({totalCount:1,results:{a:{count:-1},b:{count:2}}}),false);
 assert.equal(check({totalCount:1,results:null}),false);
 assert.equal(check({totalCount:"1e2",results:{a:{count:100}}}),false);
 const persist=html.slice(end,html.indexOf("function findDailyRecord(",end));
 const revision=persist.indexOf("recordRevision(current) !== expectedRevision");
 const guardAt=persist.indexOf("isPersistedRecordCountConsistent(current)");
 const saveAt=persist.indexOf("transaction.set(recordRef, data");
 const auditAt=persist.indexOf("writeCorrection(transaction)");
 assert.ok(revision>=0&&guardAt>revision&&saveAt>guardAt&&auditAt>saveAt);
 assert.doesNotMatch(persist,/transaction\.delete\(/);
});
