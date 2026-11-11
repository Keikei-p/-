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


function createAuditHarness({owner=true,finance=true,corrections}={}){
 const record={...makeRecord(),id:"original-r1"};
 record.results.skuB={count:1,revenuePerUnit:100};
 const panel=makeNode(),calls=[];
 let ownerAllowed=owner;
 const source=extract('const auditButton = document.createElement("button");',
   'const canCorrect = !mismatch &&');
 const closing=source.lastIndexOf("\n      }");
 assert(closing>0);
 const program=source.slice(0,closing)+
  "\nthis.trigger=auditButton.onclick;this.auditResult=auditResult;";
 const refs=Array.isArray(corrections)?corrections:[{
  companyId:"hub",recordId:record.id,recordUid:record.uid,
  recordDate:record.date,createdAt:{toMillis:()=>123},
  after:{totalCount:2,results:{skuA:{count:2,revenuePerUnit:100}}}
 }];
 const ctx=vm.createContext({
  item:panel,document:{createElement:()=>makeNode()},record,
  mismatch:{savedCount:2,detailCount:3},db:{},JSON,Number,Object,
  currentUser:{uid:"owner"},currentUserData:{companyId:"hub"},
  dashboardMonth:{value:"2026-11"},
  isCurrentCompanyOwner:()=>ownerAllowed,
  canCurrentUserViewProductRevenue:()=>finance,
  getDocFromServer:async (...args)=>{
   calls.push({name:"get",args});
   return {exists:()=>true,data:()=>structuredClone(record)};
  },
  doc:(...args)=>({path:args}),
  query:(...args)=>({queries:args}),
  collection:(...args)=>({collection:args}),
  where:(...args)=>({field:args}),
  getDocsFromServer:async (...args)=>{
   calls.push({name:"list",args});
   return {size:refs.length,docs:refs.map(row=>({data:()=>row}))};
  },
  recordRevision:x=>JSON.stringify(x),
 });
 vm.runInContext(program,ctx);
 return {ctx,panel,calls,record,setOwner:x=>{ownerAllowed=x}};
}
test("Owner audit cross-check reads current original and indexed company/day history only",async()=>{
 const h=createAuditHarness();
 await h.ctx.trigger();
 assert.equal(h.calls.length,2);
 assert.equal(h.calls[0].name,"get");
 assert.equal(h.calls[1].name,"list");
 assert.equal(h.calls[0].args[0].path[1],"records");
 assert.equal(h.calls[0].args[0].path[2],"original-r1");
 const query=h.calls[1].args[0].queries;
 assert.equal(query[0].collection[1],"recordCorrections");
 assert.deepEqual(JSON.parse(JSON.stringify(query.slice(1).map(x=>x.field))),[
  ["companyId","==","hub"],["recordDate","==","2026-11-10"]
 ]);
 assert.match(h.ctx.auditResult.textContent,/現在のみの商材行1本/);
 assert.match(h.ctx.auditResult.textContent,/最新訂正後：保存2件・明細2件/);
 assert.equal(h.record.results.skuB.count,1,"never auto-delete old result row");
});
test("unauthorized audit read fails before remote GET and history LIST",async()=>{
 for(const [owner,finance] of [[false,true],[true,false],[false,false]]){
  const h=createAuditHarness({owner,finance});
  await h.ctx.trigger();
  assert.equal(h.calls.length,0);
  assert.equal(h.ctx.auditResult.textContent,"");
 }
});
test("Owner proof fails closed on missing audit, malformed timestamps and wrong record identity",async()=>{
 const cases=[[],[
  {companyId:"other",recordId:"original-r1",recordUid:"owner",
   recordDate:"2026-11-10",createdAt:{toMillis:()=>123},
   after:{totalCount:2,results:{skuA:{count:2}}}}
 ],[
  {companyId:"hub",recordId:"original-r1",recordUid:"owner",
   recordDate:"2026-11-10",createdAt:null,
   after:{totalCount:2,results:{skuA:{count:2}}}}
 ]];
 for(const corrections of cases){
  const h=createAuditHarness({corrections});
  await h.ctx.trigger();
  assert(!h.ctx.auditResult.textContent.includes("現在のみの商材行"));
  assert(!h.ctx.auditResult.textContent.includes("最新訂正後："));
  assert.equal(h.calls.length,2);
 }
});
