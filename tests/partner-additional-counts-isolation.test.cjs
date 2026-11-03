"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {normalizeExtraCounts,applyExtraCounts,projectedExtraRead}=require("../functions-partner-workspace/additional-counts.cjs");
test("new products save as a SEPARATE count map, not legacy category or finance data",()=>{
 const out=applyExtraCounts({previous:{},changes:{newSolar:3,newWater:4},
  allowedIds:["newSolar","newWater"],blockedLegacyIds:["NURO_legacy"]});
 assert.deepEqual(out,{counts:{newSolar:3,newWater:4},total:7});
 assert.doesNotMatch(JSON.stringify(out),/revenue|cashback|unitPrice|pricing|email/);
});
test("partial edits preserve previous counts for other products",()=>{
 const old=Object.freeze({p1:3,p2:5});
 const next=applyExtraCounts({previous:old,changes:{p1:7},allowedIds:["p1"],
  blockedLegacyIds:[]});
 assert.deepEqual(next,{counts:{p1:7,p2:5},total:12});
 assert.deepEqual(old,{p1:3,p2:5});
});
test("revoked product cannot be edited, but historical quantity remains archived",()=>{
 const next=applyExtraCounts({previous:{retired:4,active:2},changes:{active:6},
  allowedIds:["active"],blockedLegacyIds:[]});
 assert.equal(next.counts.retired,4);
 assert.equal(next.total,10);
 assert.deepEqual(projectedExtraRead(next.counts,{visibleIds:["active"]}),
  {counts:{active:6},archivedTotal:4,totalCount:10});
 assert.throws(()=>applyExtraCounts({previous:{retired:4},changes:{retired:0},
  allowedIds:[],blockedLegacyIds:[]}),/INVALID/);
});
test("no one can submit a linked legacy bucket or unapproved product",()=>{
 for(const args of [
  {previous:{},changes:{legacy:1},allowedIds:["legacy"],blockedLegacyIds:["legacy"]},
  {previous:{},changes:{unpublished:2},allowedIds:["approved"],blockedLegacyIds:[]},
  {previous:{legacy:1},changes:{active:1},allowedIds:["active"],blockedLegacyIds:["legacy"]}
 ]) assert.throws(()=>applyExtraCounts(args),/INVALID/);
});
test("bad quantities, ids, too-large maps and corrupt totals are rejected",()=>{
 for(const counts of [{evil:1.5},{evil:-1},{evil:10000},{"__proto__":0},
  {constructor:1},null,["a"],{}]) {
  if(counts&&Object.keys(counts).length===0)continue;
  assert.throws(()=>normalizeExtraCounts(counts),/INVALID/);
 }
 assert.deepEqual(normalizeExtraCounts({}),{counts:{},total:0});
 const giant=Object.fromEntries(Array.from({length:101},(_,i)=>["p"+i,1]));
 assert.throws(()=>normalizeExtraCounts(giant),/INVALID/);
});
test("isolation: new API writes only additional ledger, immutable audit and usage marker",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const api=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
 const a=service.indexOf(" async function submitAdditionalCounts(request)");
 const b=service.indexOf(" const checkTeam=async",a);
 assert.ok(a>0&&b>a);
 const method=service.slice(a,b);
 assert.match(method,/scope\(a\.uid,tx,d\.workspaceCompanyId\)/);
 assert.match(method,/expectedVersion/);
 assert.match(method,/applyExtraCounts/);
 assert.match(method,/const audit=collection\(s\.cid,"partnerAdditionalCountAudits"\)/);
 assert.match(method,/tx\.create\(extraUsageRef/);
 assert.match(method,/if\(prevSnap\.exists\)tx\.update\(er,row\)/);
 assert.doesNotMatch(method,/tx\.(?:update|create|set|delete)\((?:productRef|entryRef|summaryRef|auditRef|priceRef|revenueRef)\b/);
 assert.doesNotMatch(method,/tx\.(?:update|create|set|delete)\((?:collection\(s\.cid,"partnerWorkEntries"|collection\(s\.cid,"partnerWorkAudits")/);
 assert.match(api,/exports\.getPartnerAdditionalCounts=onCall/);
 assert.match(api,/exports\.submitPartnerAdditionalCounts=onCall/);
});
test("original legacy count writer is still byte-for-byte frozen",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const a=service.indexOf(" async function submit(request){");
 const b=service.indexOf(" return Object.freeze(",a);
 assert.ok(a>0&&b>a);
 const original=service.slice(a,b);
 assert.equal(original.length,6050);
 let h=2166136261;
 for(let i=0;i<original.length;i++)
  h=Math.imul(h^original.charCodeAt(i),16777619)>>>0;
 assert.equal(h.toString(16).padStart(8,"0"),"4c482896");
});
