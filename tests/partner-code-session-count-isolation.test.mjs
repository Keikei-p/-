import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
function between(a,b){
 const start=html.indexOf(a),end=html.indexOf(b,start);
 assert(start>=0&&end>start,"Expected reviewed count-only page anchors");
 return html.slice(start,end);
}
const identitySource=between("function currentCountIdentity(){","// The server-verified count contract");
const periodSource=between("async function loadCountDashboard(){",'$("countProductMode").onchange=');
const logoutSource=between("const clearCompanySession=()=>{","let countPeriod=");
const TOKEN_A="A".repeat(43),TOKEN_B="B".repeat(43);
test("company-code identities and email secondary company scopes are distinct, never token-derived",()=>{
 const scope=vm.createContext({activeCodeSession:TOKEN_A,codeCountSessionEpoch:2,
  auth:{currentUser:null},workspaceCompanyId:""});
 vm.runInContext(identitySource,scope);
 const a=vm.runInContext("currentCountIdentity()",scope);
 scope.activeCodeSession=TOKEN_B;scope.codeCountSessionEpoch=3;
 const b=vm.runInContext("currentCountIdentity()",scope);
 assert.notEqual(a,b);
 assert(!a.includes(TOKEN_A)&&!b.includes(TOKEN_B));
 scope.activeCodeSession="";scope.auth.currentUser={uid:"same-user"};
 scope.workspaceCompanyId="company-one";
 const first=vm.runInContext("currentCountIdentity()",scope);
 scope.workspaceCompanyId="company-two";
 assert.notEqual(first,vm.runInContext("currentCountIdentity()",scope));
 assert.match(html,/countDayCache\.set\(currentCountIdentity\(\)\+"\|"\+res\.date/);
 assert.doesNotMatch(html,/activeCodeSession\?"code-session":"email-"/);
});
test("late period GET from previous company cannot render or replace new company's totals",async()=>{
 const requested=[],rendered=[],writes=[];
 const nodes=new Map([
  ["dashboardBox",{hidden:false}],["date",{value:"2026-11-19"}],
  ["dashboardPartnerMonth",{value:"2026-11"}],
  ["countCsv",{disabled:false}],["countDashboardStatus",{textContent:""}]
 ]);
 const ctx=vm.createContext({
  auth:{currentUser:null},activeCodeSession:TOKEN_A,codeCountSessionEpoch:1,
  workspaceCompanyId:"",countLoadId:0,countPeriod:"day",
  data:{role:"owner",date:"2026-11-18",companyName:"company-A"},
  countDayCache:new Map(),countKeys:["NURO"],dateParts:{year:"2026",month:"11",day:"19"},
  Date,console:{error(){}},NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED:false,
  $:id=>nodes.get(id),
  periodDatesForCounts:()=>["2026-11-19"],
  clearCountOnlyDashboard:()=>writes.push("clear"),
  summarizeCountOnlyResponses:rows=>({company:rows[0].companyName}),
  renderCountOnlyDashboard:summary=>rendered.push(summary.company),
  get:async ({date})=>await new Promise(resolve=>requested.push({date,resolve}))
 });
 vm.runInContext(identitySource+periodSource,ctx);
 const old=vm.runInContext("loadCountDashboard()",ctx);
 assert.equal(requested.length,1);
 // Clear session and re-login to another company while the old GET is in flight.
 ctx.codeCountSessionEpoch++;ctx.countLoadId++;ctx.activeCodeSession=TOKEN_B;
 ctx.countDayCache.clear();
 ctx.data={role:"owner",date:"2026-11-18",companyName:"company-B"};
 const next=vm.runInContext("loadCountDashboard()",ctx);
 assert.equal(requested.length,2);
 requested[1].resolve({data:{role:"owner",date:"2026-11-19",categories:["NURO"],companyName:"company-B"}});
 await next;
 assert.deepEqual(rendered,["company-B"]);
 const before=nodes.get("countDashboardStatus").textContent;
 requested[0].resolve({data:{role:"owner",date:"2026-11-19",categories:["NURO"],companyName:"company-A"}});
 await old;
 assert.deepEqual(rendered,["company-B"]);
 assert.equal(nodes.get("countDashboardStatus").textContent,before);
 assert(!ctx.countDayCache.has("code-session-epoch:2|2026-11-19")||
   ctx.countDayCache.get("code-session-epoch:2|2026-11-19").response.companyName==="company-B");
});
test("logging out invalidates outstanding counts, publication and visible local dashboard",()=>{
 const call=[];
 const ctx=vm.createContext({
  codeCountSessionEpoch:3,activeCodeSession:TOKEN_A,companyCodeSession:true,
  countLoadId:9,countDayCache:new Map([["old",{}]]),
  sessionStorage:{removeItem:k=>call.push("remove:"+k)},
  resetPartnerPublishedCountPanels:()=>call.push("reset"),
  clearCountOnlyDashboard:()=>call.push("clear")
 });
 vm.runInContext(logoutSource,ctx);
 vm.runInContext("clearCompanySession()",ctx);
 assert.equal(ctx.codeCountSessionEpoch,4);
 assert.equal(ctx.activeCodeSession,"");
 assert.equal(ctx.companyCodeSession,false);
 assert.equal(ctx.countLoadId,10);
 assert.equal(ctx.countDayCache.size,0);
 assert.deepEqual(call,["reset","clear","remove:nicoPartnerCodeSession"]);
 assert.match(html,/clearCompanySession\(\);\+\+nonce;loading=false;data=null;/);
});
test("verified count GET aborts when a company session changes before response",()=>{
 assert.match(html,/session=activeCodeSession,user=auth\.currentUser/);
 assert.match(html,/session!==activeCodeSession\|\|\s*user!==auth\.currentUser\|\|company!==workspaceCompanyId/);
 assert.match(html,/\+\+codeCountSessionEpoch;\s*\+\+countLoadId;\s*countDayCache\.clear\(\);/);
 assert.match(html,/const NICO_PARTNER_SAME_SCREEN_TABS_ENABLED=false;/);
 assert.match(html,/const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED=false;/);
});
