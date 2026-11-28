import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
function source(begin,end){
 const a=html.indexOf(begin),b=html.indexOf(end,a);
 assert(a>=0&&b>a,"Expected protected source anchors");
 return html.slice(a,b);
}
const summarySrc=source("function summarizeCountOnlyResponses(", "function countTable(");
const periodSrc=source("async function loadCountDashboard(){", '$("countProductMode").onchange=');
const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=nu=>Object.fromEntries(keys.map(k=>[k,k==="NURO"?nu:0]));
const staff=[{id:"staff-1",name:"担当A",active:true,teamId:"team-1"}];
const report=(date,n,companyName="協力店A")=>({
 role:"owner",date,companyName,teams:[{id:"team-1",name:"1班",active:true}],
 staff,records:n===null?[]:[{staffId:"staff-1",totalCount:n,
 counts:counts(n),teamIdSnapshot:"team-1",version:1,privateCounts:{},privateTotalCount:0}],
 categories:keys,privateProducts:[]
});
const scope=vm.createContext({Map,Set,Number,Object});
vm.runInContext(summarySrc,scope);
test("0 count submitted day is reported once, not absent or a positive performer",()=>{
 const summary=scope.summarizeCountOnlyResponses([
  report("2026-11-17",0),report("2026-11-18",null),report("2026-11-19",2)
 ],[{id:"team-1",name:"1班"}],keys);
 assert.equal(summary.total,2);
 const daily=Object.fromEntries(Array.from(summary.days,day=>[day.date,
  {n:day.count,positive:day.people,reported:day.reportedPeople}]));
 assert.deepEqual(daily["2026-11-17"],{n:0,positive:0,reported:1});
 assert.deepEqual(daily["2026-11-18"],{n:0,positive:0,reported:0});
 assert.deepEqual(daily["2026-11-19"],{n:2,positive:1,reported:1});
 assert.equal(summary.people[0].count,2);
 assert.match(html,/meta\.textContent="実績登録 "\+day\.reportedPeople\+"人"/);
 assert.match(html,/summary\.days\.map\(d=>\[d\.date,d\.count\+"件",d\.reportedPeople\+"人"\]\)/);
});
test("existing total count and product ranking are never increased by reported-only zero",()=>{
 const summary=scope.summarizeCountOnlyResponses([
  report("2026-11-17",0),report("2026-11-18",0),report("2026-11-19",3)
 ],[{id:"team-1",name:"1班"}],keys);
 assert.equal(summary.total,3);
 assert.equal(summary.products.NURO,3);
 assert.equal(summary.people[0].count,3);
 assert.equal(summary.days.reduce((n,d)=>n+d.reportedPeople,0),3);
});
test("month loader rejects a different company's day even when roles and categories match",async()=>{
 const date="2026-11-19",status={textContent:""},cash={disabled:false};
 const boxes=new Map([["dashboardBox",{hidden:false}],["dashboardPartnerMonth",{value:"2026-11"}],
  ["date",{value:date}],["countDashboardStatus",status],["countCsv",cash]]);
 let error=null;let rendered=0;
 const ctx=vm.createContext({
  data:report("2026-11-18",2),countPeriod:"day",countLoadId:0,
  activeCodeSession:"T".repeat(43),codeCountSessionEpoch:1,
  auth:{currentUser:null},workspaceCompanyId:"",
  countDayCache:new Map(),countKeys:keys,
  dateParts:{year:"2026",month:"11",day:"19"},
  NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED:false,console:{error:(...x)=>error=x},
  $:id=>boxes.get(id),clearCountOnlyDashboard(){},
  periodDatesForCounts:()=>[date],summarizeCountOnlyResponses(){throw Error("MIXED_COMPANIES")},
  renderCountOnlyDashboard(){rendered++},
  get:async()=>({data:report(date,98,"協力店B")})
 });
 vm.runInContext('function currentCountIdentity(){return activeCodeSession?"code-session-epoch:"+codeCountSessionEpoch:"";}\n'+periodSrc,ctx);
 await vm.runInContext("loadCountDashboard()",ctx);
 assert.equal(rendered,0);
 assert.equal(ctx.countDayCache.size,0);
 assert.match(status.textContent,/集計が完了していません/);
 assert.equal(error?.[0],"count-only dashboard verification failed");
});
test("invalidated late response never repopulates cache or replaces next-company display",async()=>{
 const date="2026-11-19",status={textContent:""};
 const boxes=new Map([["dashboardBox",{hidden:false}],["dashboardPartnerMonth",{value:"2026-11"}],
  ["date",{value:date}],["countDashboardStatus",status],["countCsv",{disabled:true}]]);
 let resolveOld;
 const ctx=vm.createContext({
  data:report("2026-11-18",0),countPeriod:"day",countLoadId:0,
  activeCodeSession:"A".repeat(43),codeCountSessionEpoch:1,
  auth:{currentUser:null},workspaceCompanyId:"",
  countDayCache:new Map(),countKeys:keys,
  dateParts:{year:"2026",month:"11",day:"19"},
  NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED:false,console:{error(){}},
  $:id=>boxes.get(id),clearCountOnlyDashboard(){},
  periodDatesForCounts:()=>[date],
  summarizeCountOnlyResponses:rows=>({total:rows[0].records[0].totalCount}),
  renderCountOnlyDashboard(){throw Error("OLD_RESULT_RENDERED")},
  get:async()=>await new Promise(resolve=>resolveOld=resolve)
 });
 vm.runInContext('function currentCountIdentity(){return activeCodeSession?"code-session-epoch:"+codeCountSessionEpoch:"";}\n'+periodSrc,ctx);
 const pending=vm.runInContext("loadCountDashboard()",ctx);
 ctx.codeCountSessionEpoch++;ctx.countLoadId++;ctx.activeCodeSession="B".repeat(43);
 ctx.countDayCache.clear();
 resolveOld({data:report(date,77)});
 await pending;
 assert.equal(ctx.countDayCache.size,0);
 assert(!status.textContent.includes("77"));
});
test("guard does not modify archived rows, real submitted counts, or original money Rules",()=>{
 assert.match(periodSrc,/response\.companyName!==data\.companyName/);
 assert.match(periodSrc,/gen!==countLoadId\|\|currentCountIdentity\(\)!==uid/);
 assert(!/setDoc\(|updateDoc\(|runTransaction\(|deleteDoc\(|firebase deploy/.test(summarySrc+periodSrc));
});
