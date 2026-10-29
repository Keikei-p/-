import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync("index.html","utf8");
const start=html.indexOf("function monthRecordRange(month) {");
const stop=html.indexOf("function formatYen(value) {",start);
assert(start>=0&&stop>start,"monthly source functions are present");
const helper=html.slice(start,stop);
function setup(){
 const status={textContent:"",style:{display:"none"}}, subs=[];
 const css={loading:false,toggle(n,v){if(n==="monthly-records-pending")this.loading=v;}};
 const state={
  dashboard:{classList:css},dashboardMonth:{value:"2026-10"},
  currentUserData:{companyId:"companyA"},getTodayString:()=> "2026-10-29",
  document:{getElementById(){return status;}},unsubscribeRecords:null,
  recordQueryGeneration:0,recordsReady:false,recordsSubscribedMonth:"",
  records:[],annualChartRecords:null,annualChartYear:"",
  annualChartGeneration:0,renders:0,previews:0,
  query:(base,...filters)=>({base,filters}),
  where:(field,op,value)=>({field,op,value}),
  recordsCollectionQuery:()=>({collection:"records",companyId:"companyA"}),
  canCurrentUserViewRevenue:()=>true,
  onSnapshot:(q,options,fn,err)=>{const x={q,options,fn,err,closed:false};
    subs.push(x);return ()=>{x.closed=true;};},
  getDocsFromServer:async()=>({size:0,empty:true,docs:[],forEach(){}}),
  createMonthOptions(){},renderDashboard(){state.renders++;},
  renderNotificationPreview(){state.previews++;},console:{error(){}}
 };
 const ctx=vm.createContext(state);
 vm.runInContext(helper,ctx);
 const api=vm.runInContext('({monthRecordRange,scopedRecordsQuery,subscribeSelectedMonthRecords,findDailyRecordFromServer,loadAnnualChartRecords,readVerifiedMonthForReport})',ctx);
 return {state,api,subs,status,css,ctx};
}
const doc=(i,date="2026-10-29",companyId="companyA")=>({
 id:"row"+i,data:()=>({companyId,date,uid:"u"+i,totalCount:1,totalRevenue:10000})
});
const snapshot=(rows,meta={fromCache:false,hasPendingWrites:false})=>({
 metadata:meta,forEach(fn){rows.forEach(fn);}
});
test("month boundaries including December, invalid months",()=>{
 const {api}=setup();
 assert.equal(api.monthRecordRange("2026-12").end,"2027-01-01");
 assert.equal(api.monthRecordRange("2028-02").end,"2028-03-01");
 for(const m of ["2026-00","2026-13","2026-1","garbage"])assert.throws(()=>api.monthRecordRange(m),/不正/);
});
test("month-scoped query retains company and exact date range",()=>{
 const {api}=setup(),q=api.scopedRecordsQuery("2026-10");
 assert.equal(q.base.companyId,"companyA");
 assert.deepEqual(Array.from(q.filters,x=>({...x})),[
  {field:"date",op:">=",value:"2026-10-01"},
  {field:"date",op:"<",value:"2026-11-01"}]);
});
test("offline cache and pending writes never become final totals",()=>{
 const {api,state,subs,css}=setup();
 api.subscribeSelectedMonthRecords();
 assert(css.loading);
 subs[0].fn(snapshot([doc(0)],{fromCache:true,hasPendingWrites:false}));
 subs[0].fn(snapshot([doc(0)],{fromCache:false,hasPendingWrites:true}));
 assert.equal(state.renders,0);
 subs[0].fn(snapshot([doc(0)]));
 assert.equal(state.renders,1);
 assert.equal(state.recordsReady,true);
 assert.equal(css.loading,false);
});
test("25,001 synthetic records load without a 2000-document cutoff",()=>{
 const {api,state,subs}=setup();
 api.subscribeSelectedMonthRecords();
 subs[0].fn(snapshot(Array.from({length:25001},(_,i)=>doc(i))));
 assert.equal(state.records.length,25001);
 assert.equal(state.records.reduce((a,x)=>a+x.totalCount,0),25001);
 assert.equal(state.records.reduce((a,x)=>a+x.totalRevenue,0),250010000);
 assert.equal(new Set(state.records.map(x=>x.id)).size,25001);
});
test("switching months ignores late callback from previous subscription",()=>{
 const {api,state,subs}=setup();
 api.subscribeSelectedMonthRecords();
 state.dashboardMonth.value="2026-09";
 api.subscribeSelectedMonthRecords();
 assert(subs[0].closed);
 subs[0].fn(snapshot([doc(0)]));
 assert.equal(state.renders,0);
 subs[1].fn(snapshot([doc(1,"2026-09-30")]));
 assert.equal(state.recordsSubscribedMonth,"2026-09");
 assert.equal(state.renders,1);
});
test("out-of-month or other-company rows block all totals",()=>{
 const {api,state,subs,css}=setup();
 api.subscribeSelectedMonthRecords();
 subs[0].fn(snapshot([doc(1),doc(2,"2026-09-29")]));
 assert.equal(state.renders,0);
 assert.equal(state.recordsReady,false);
 assert(css.loading);
 subs[0].fn(snapshot([doc(1,"2026-10-29","otherCompany")]));
 assert.equal(state.renders,0);
});
test("permissions and index errors block display instead of showing zero",()=>{
 const {api,state,subs,css,status}=setup();
 api.subscribeSelectedMonthRecords();
 subs[0].err({code:"failed-precondition"});
 assert.equal(state.renders,0);
 assert.equal(state.recordsReady,false);
 assert(css.loading);
 assert.match(status.textContent,/読み込めません/);
});
test("single-day lookup works for old months and rejects duplicate records",async()=>{
 const {api,state}=setup();
 let params;
 state.getDocsFromServer=async q=>{
  params=q.filters;
  return {size:1,empty:false,docs:[doc(1,"2025-04-30")]};
 };
 const old=await api.findDailyRecordFromServer("u1","2025-04-30");
 assert.equal(old.id,"row1");
 assert.deepEqual(Array.from(params,x=>({...x})),[
  {field:"uid",op:"==",value:"u1"},
  {field:"date",op:"==",value:"2025-04-30"}]);
 state.getDocsFromServer=async()=>({size:2,empty:false,docs:[doc(1),doc(2)]});
 await assert.rejects(api.findDailyRecordFromServer("u1","2025-04-30"),/複数/);
});
test("annual mode requests a full year with permission checks",async()=>{
 const {api,state}=setup();
 let params;
 state.getDocsFromServer=async q=>{params=q.filters;
  return {forEach(fn){fn(doc(1,"2026-01-01"));fn(doc(2,"2026-12-31"));}};};
 assert.equal((await api.loadAnnualChartRecords("2026")).length,2);
 assert.deepEqual(Array.from(params,x=>({...x})),[
  {field:"date",op:">=",value:"2026-01-01"},
  {field:"date",op:"<",value:"2027-01-01"}]);
 state.getDocsFromServer=async()=>({forEach(fn){fn(doc(3,"2027-01-01"));}});
 await assert.rejects(api.loadAnnualChartRecords("2026"),/整合性/);
 state.canCurrentUserViewRevenue=()=>false;
 await assert.rejects(api.loadAnnualChartRecords("2026"),/権限/);
});
test("legacy whole-company listener and whole-company getDocs removed from dashboard",()=>{
 assert(!html.includes("onSnapshot(\n      recordsCollectionQuery()"));
 assert(!html.includes("await getDocs(\n        recordsCollectionQuery()"));
 assert(html.includes("async function persistDailyRecord(recordRef, data, expectedRecord, expectedRevision)"));
 assert(html.includes("if(!recordsReady||recordsSubscribedMonth!==dashboardMonth.value)"));
 assert(html.includes("findDailyRecordFromServer(memberId,date)"));
});

test("reporting on a different month verifies that month instead of using displayed month",async()=>{
 const {api,state}=setup();
 state.recordsReady=true;
 state.recordsSubscribedMonth="2026-10";
 state.records=[{companyId:"companyA",date:"2026-10-29",uid:"current"}];
 let queryMonth=null;
 state.getDocsFromServer=async q=>{
   queryMonth=q.filters.map(f=>f.value);
   return {forEach(cb){cb(doc(123,"2026-09-10"));}};
 };
 const result=await api.readVerifiedMonthForReport("2026-09");
 assert.equal(result.length,1);
 assert.equal(result[0].date,"2026-09-10");
 assert.deepEqual(queryMonth,["2026-09-01","2026-10-01"]);
 assert.equal(state.records[0].date,"2026-10-29","dashboard remains unchanged");
});
test("reporting request fails on another company's records rather than creating false zero",async()=>{
 const {api,state}=setup();
 state.getDocsFromServer=async()=>({forEach(cb){cb(doc(123,"2026-09-10","anotherCompany"));}});
 await assert.rejects(api.readVerifiedMonthForReport("2026-09"),/照合/);
});
test("today's unreported preview queries today even if the dashboard shows last month",async()=>{
 const {state,ctx}=setup();
 const a=html.indexOf("async function renderNotificationPreview() {");
 const b=html.indexOf("\n\nfunction stopLinePairingListener()",a);
 assert(a>=0&&b>a);
 const preview={textContent:"",innerHTML:""};
 state.notificationPreview=preview;
 state.notificationPreviewGeneration=0;
 state.members=[{id:"u1"}];
 state.notificationSettings={reportCompletionMode:"all"};
 state.normalizeNotificationSettings=s=>s;
 state.escapeHtml=s=>s;
 state.recordsReady=true;
 state.recordsSubscribedMonth="2026-09";
 state.getUnreportedTeamSummary=(date,rows)=>{
   assert.equal(date,"2026-10-29");
   assert.equal(rows.length,1);
   assert.equal(rows[0].date,"2026-10-29");
   return [];
 };
 let calls=0;
 state.getDocsFromServer=async q=>{
   calls++;
   assert.deepEqual(Array.from(q.filters,x=>({...x})),[
    {field:"date",op:"==",value:"2026-10-29"}]);
   return {forEach(cb){cb(doc(1,"2026-10-29"));}};
 };
 vm.runInContext(html.slice(a,b),ctx);
 await ctx.renderNotificationPreview();
 assert.equal(calls,1);
 assert.match(preview.textContent,/✅/);
});
test("failed today's report query cannot be presented as all staff reported",async()=>{
 const {state,ctx}=setup();
 const a=html.indexOf("async function renderNotificationPreview() {");
 const b=html.indexOf("\n\nfunction stopLinePairingListener()",a);
 const preview={textContent:"",innerHTML:""};
 state.notificationPreview=preview;
 state.notificationPreviewGeneration=0;
 state.members=[{id:"u1"}];
 state.recordsReady=true;
 state.recordsSubscribedMonth="2026-09";
 state.getDocsFromServer=async()=>{throw Error("permission-denied");};
 vm.runInContext(html.slice(a,b),ctx);
 await ctx.renderNotificationPreview();
 assert.match(preview.textContent,/確認できません/);
 assert.doesNotMatch(preview.textContent,/✅/);
});
test("report generation clears old text and aborts when source month cannot be fetched",async()=>{
 const {state,ctx}=setup();
 const a=html.indexOf("async function buildVerifiedReport(date,mode) {");
 const b=html.indexOf("\n\ncopyReportButton.onclick =",a);
 assert(a>=0&&b>a);
 const reportText={value:"stale previous month's report"};
 state.reportBuilderText=reportText;
 state.reportBuildGeneration=0;
 state.reportBuilderDate={value:"2026-09-29",addEventListener(){}};
 state.buildFinalReportButton={disabled:false};
 state.buildMorningReportButton={disabled:false};
 state.copyReportButton={disabled:false};
 state.showError=msg=>state.lastError=msg;
 state.createFinalReportText=(date,records)=>"verified="+records.length;
 state.createMorningReportText=()=> "morning";
 state.getDocsFromServer=async()=>{throw Error("permission-denied");};
 state.getTodayString=()=> "2026-10-29";
 state.previousDateString=x=>x;
 vm.runInContext(html.slice(a,b),ctx);
 await ctx.buildVerifiedReport("2026-09-29","final");
 assert.equal(reportText.value,"");
 assert.match(state.lastError,/中止/);
 assert.equal(state.copyReportButton.disabled,false);
});
