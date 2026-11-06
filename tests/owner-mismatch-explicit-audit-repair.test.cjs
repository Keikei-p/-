"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const start=html.indexOf("function readOnlyRecordCountEvidence(");
const end=html.indexOf("async function persistDailyRecord(",start);
assert(start>0&&end>start);
const code=html.slice(start,end);
function fixture(){
 const ctx=vm.createContext({
  currentUser:{uid:"hubOwner"},
  currentUserData:{companyId:"hub",companyRole:"owner",accessKind:"internal",memberType:"internal"},
  currentCompanyData:{ownerUid:"hubOwner",companyKind:"internal"},
  partnerInlineWorkspaceCompany:null,
  isCurrentCompanyOwner:()=>true,
  canCurrentUserViewRevenue:()=>true
 });
 vm.runInContext(code,ctx);
 return ctx;
}
function record(patch={}){
 return {id:"hub_owner_2026-10-21",companyId:"hub",uid:"employee",
  date:"2026-10-21",totalCount:2,
  results:{
   a:{productId:"nuro",cashback:0,count:1,revenuePerUnit:90000},
   b:{productId:"other",cashback:0,count:2,revenuePerUnit:10000}
  },...patch};
}
function json(x){return JSON.parse(JSON.stringify(x));}
test("only a currently signed-in internal Owner with money permission and exact company can BEGIN manual mismatch review",()=>{
 const good=record(),c=fixture();
 assert.deepEqual(json(c.readOnlyRecordCountEvidence(good)),{saved:2,lines:3});
 assert.equal(c.canBeginOwnerMismatchCorrection(good),true);
 for(const mutate of [
  x=>{x.currentUser=null;},x=>{x.currentUserData.companyId="other";},
  x=>{x.currentUserData.accessKind="partner";},
  x=>{x.currentUserData.memberType="cooperator";},
  x=>{x.partnerInlineWorkspaceCompany="partner";},
  x=>{x.isCurrentCompanyOwner=()=>false;},
  x=>{x.canCurrentUserViewRevenue=()=>false;},
  x=>{x.currentCompanyData.companyKind="partner";},
  x=>{x.currentCompanyData.ownerUid="different";}
 ]){
  const ctx=fixture();mutate(ctx);
  assert.equal(ctx.canBeginOwnerMismatchCorrection(good),false);
 }
});
test("well-formed divergent counts are eligible, but unknown evidence, consistent rows, arrays, and missing IDs fail closed",()=>{
 const c=fixture();
 for(const patch of [
  {totalCount:3},{totalCount:undefined},{totalCount:-1},
  {results:{a:{count:null}}},
  {results:[{count:1},{count:2}]},
  {results:null},{id:null},{id:"../other"},
  {companyId:"other"},{date:"2026-11-21"}
 ]){
  assert.equal(c.canBeginOwnerMismatchCorrection(record(patch)),false,JSON.stringify(patch));
 }
});
test("a no-op form save cannot turn a saved 2 into calculated 3 without deliberately changing a product count",()=>{
 const c=fixture(),original=record(),before=JSON.stringify(original);
 const next=json(original.results);
 assert.equal(c.ownerMismatchCountsChanged(original.results,next),false);
 next.b.count=1;
 assert.equal(c.ownerMismatchCountsChanged(original.results,next),true);
 next.b.count=2;delete next.b;
 assert.equal(c.ownerMismatchCountsChanged(original.results,next),true);
 assert.equal(JSON.stringify(original),before);
});
test("legacy result key migration and price-only changes cannot masquerade as explicit corrected quantities",()=>{
 const c=fixture(),old=record().results;
 const rekeyed={rekeyed_nuro:{...old.a},rekeyed_other:{...old.b,revenuePerUnit:500000}};
 assert.equal(c.ownerMismatchCountsChanged(old,rekeyed),false);
 assert.equal(c.ownerMismatchCountsChanged(old,{a:{...old.a},b:{...old.a}}),false,
  "duplicate identical variants must not become an automatic repair");
 assert.equal(c.ownerMismatchCountsChanged(old,{a:{...old.a},b:{...old.b,count:"2"}}),false);
 assert.equal(c.ownerMismatchCountsChanged(old,{a:{...old.a},b:{...old.b,count:"abc"}}),false);
 assert.equal(c.ownerMismatchCountsChanged(old,{a:{...old.a},b:{...old.b,cashback:"0"}}),false);
});
test("mismatch save requires revision-bound explicit review, rejects zero-day wipe, and preserves normal audited transaction",()=>{
 const save=html.slice(html.indexOf("saveRecordButton.onclick ="),html.indexOf("/*",html.indexOf("saveRecordButton.onclick =")+20000));
 const readBetween=html.slice(html.indexOf("saveRecordButton.onclick ="),html.indexOf("await persistDailyRecord(",html.indexOf("saveRecordButton.onclick =")));
 assert.match(readBetween,/readOnlyRecordCountEvidence\(existingDailyRecord\)/);
 assert.match(readBetween,/!canBeginOwnerMismatchCorrection\(existingDailyRecord\)/);
 assert.match(readBetween,/review\.recordId!==existingDailyRecord\.id/);
 assert.match(readBetween,/review\.revision!==recordRevision\(existingDailyRecord\)/);
 assert.match(readBetween,/zeroResultSubmission/);
 assert.match(readBetween,/!ownerMismatchCountsChanged\(existingDailyRecord\.results,results\)/);
 assert.match(readBetween,/if \(!confirm\(/);
 assert.match(readBetween,/const writeCorrection = existingDailyRecord/);
 assert.match(readBetween,/transaction\.set\(\s*correctionRef/);
 assert.match(readBetween,/before: \{/);
 assert.match(readBetween,/after: \{/);
 assert.match(html,/transaction\.set\(recordRef, data, \{mergeFields: Object\.keys\(data\)\}\)/);
 assert.match(html,/recordRevision\(current\) !== expectedRevision/);
 assert.doesNotMatch(code,/\b(runTransaction|deleteDoc|setDoc|updateDoc|fetch|httpsCallable)\s*\(/);
});
test("historical entry UI requires two human actions and refuses to silently erase unrendered rows",()=>{
 const start=html.indexOf("function editRecord("),end=html.indexOf("/*",start+800);
 const edit=html.slice(start,start+2800);
 const history=html.slice(html.indexOf("function renderRecordHistory("),start);
 assert.match(history,/canBeginOwnerMismatchCorrection\(record\)/);
 assert.match(edit,/canBeginOwnerMismatchCorrection\(record\)/);
 assert.match(edit,/!confirm\(/);
 assert.match(edit,/ownerMismatchCorrectionApproval = mismatch===null \? null/);
 assert.match(edit,/ownerMismatchCountsChanged\(record\.results,getCurrentInputResults\(\)\)/);
 assert.match(edit,/ownerMismatchCorrectionApproval=null/);
 assert.match(edit,/editingRecordId=null;editingRecordRevision=null/);
 assert.match(html,/ownerMismatchCorrectionApproval = null;/);
});
