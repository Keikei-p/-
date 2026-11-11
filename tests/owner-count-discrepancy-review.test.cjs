"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const html=fs.readFileSync("index.html","utf8");
const extract=(start,next)=>{
 const a=html.indexOf(start),b=html.indexOf(next,a+start.length);
 assert(a>=0&&b>a,"Missing protected function: "+start);
 return html.slice(a,b);
};
const checkCode=extract("function inspectStoredRecordCountMismatch(record) {",
 "function auditSavedRevenueRates(monthlyRecords, productCatalog) {");
const renderCode=extract("function renderProductSummary(",
 "function renderDailySummary(");
const makeNode=()=>({style:{},children:[],textContent:"",innerHTML:"",
 appendChild(node){this.children.push(node)},
 scrollIntoView(){this.scrolled=true}
});
const makeRecord=(date="2026-11-10")=>({
 date,companyId:"hub",uid:"owner",totalCount:2,totalRevenue:200,
 results:{skuA:{count:2,revenuePerUnit:100}}
});
function createHarness(owner=true,finance=true){
 const bad=makeRecord(),good=makeRecord("2026-11-09");
 bad.results.skuB={count:1,revenuePerUnit:100};
 const els={productSummaryList:makeNode(),productSummaryCount:makeNode(),
  dashboardMonth:{value:"2026-11"},recordHistoryDate:{value:""},
  recordHistoryList:makeNode()};
 const accesses={review:0};
 const ctx=vm.createContext({
  ...els,products:[],records:[bad,good],
  currentRecordHistoryMonthly:[bad,good],
  isCurrentCompanyOwner:()=>owner,
  canCurrentUserViewProductRevenue:()=>finance,
  auditSavedRevenueRates:()=>[],
  getCurrentMemberName:()=> "確認担当",
  renderRecordHistory:()=>{accesses.review++},
  document:{createElement:()=>makeNode()},
  Number,Object,JSON,
 });
 vm.runInContext(checkCode+"\n"+renderCode+
  "\nthis.inspect=inspectStoredRecordCountMismatch;this.render=renderProductSummary;",ctx);
 return {ctx,bad,good,els,accesses};
}
test("original count-only mismatch is exact and does not guess or mutate source",()=>{
 const h=createHarness(),original=JSON.stringify(h.bad);
 const result=h.ctx.inspect(h.bad);
 assert.equal(result.savedCount,2);
 assert.equal(result.detailCount,3);
 assert.equal(result.difference,1);
 assert.equal(h.ctx.inspect(h.good),null);
 assert.equal(JSON.stringify(h.bad),original);
 for(const change of [x=>delete x.totalCount,x=>x.totalCount="2",
  x=>x.results.skuA.count=-1,x=>x.results.skuA.count="2",
  x=>x.results.skuA.count=null,x=>{x.results=[]}]){
  const row=JSON.parse(JSON.stringify(h.bad));change(row);
  assert.equal(h.ctx.inspect(row),null,"unverifiable legacy data must not become 0");
 }
});
test("Owner-only dashboard mismatch review links to original saved day without writes",()=>{
 const h=createHarness();
 h.ctx.render({});
 const panels=h.els.productSummaryList.children;
 assert.equal(panels.length,2);
 const warning=panels[0];
 assert.match(warning.children[0].textContent,/保存件数と商材明細が不一致：1件/);
 const action=warning.children.find(x=>x.type==="button");
 assert(action,"Owner drilldown action must exist");
 assert.match(action.textContent,/保存2件・明細3件/);
 action.onclick();
 assert.equal(h.els.recordHistoryDate.value,"2026-11-10");
 assert.equal(h.accesses.review,1);
 assert.equal(h.els.recordHistoryList.scrolled,true);
 assert.equal(h.bad.results.skuB.count,1);
});
test("non Owner and no-revenue-view roles never receive mismatched record identity",()=>{
 for(const [owner,finance] of [[false,true],[true,false],[false,false]]){
  const h=createHarness(owner,finance);h.ctx.render({});
  assert.equal(h.els.productSummaryList.children.length,1,
   "only generic empty message is shown, never private Owner review");
  assert(!JSON.stringify(h.els.productSummaryList.children)
   .includes("確認担当"));
 }
});
test("previous-month action and revoked Owner authority cannot navigate stale records",()=>{
 const h=createHarness();
 h.ctx.render({});
 const action=h.els.productSummaryList.children[0].children.find(x=>x.type==="button");
 h.els.dashboardMonth.value="2026-10";
 action.onclick();
 assert.equal(h.accesses.review,0);
 assert.equal(h.els.recordHistoryDate.value,"");
 const source=extract("function renderRecordHistory(","function editRecord(");
 assert.match(source,/const mismatch = isCurrentCompanyOwner\(\)/);
 assert.match(source,/const canCorrect = !mismatch &&/);
 assert.match(source,/inspectStoredRecordCountMismatch\(record\)/);
 assert.doesNotMatch(checkCode,/setDoc\(|updateDoc\(|deleteDoc\(|transaction\./);
});
