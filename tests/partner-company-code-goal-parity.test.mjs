import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
function section(from,to){const a=html.indexOf(from),b=html.indexOf(to,a);
 assert(a>=0&&b>a,"expected count goal code");return html.slice(a,b)}
const funcs=section("function countGoalKey(){","// The original self dashboard's two-step analysis");
const buttons=section('$("countGoalSave").onclick=()=>{','for(const mode of ["Day","Week","Month"])');
function make({code=true,mixed=false}={}){
 const store=new Map(),access=[];
 const dom=new Map([["dashboardPartnerMonth",{value:"2026-11"}],
  ["countGoalSave",{}],["countGoalClear",{}],
  ["countGoalBox",{hidden:true}],["countGoalUnavailable",{hidden:false}],
  ["countGoalDailyEstimate",{textContent:""}],["countGoalDays",{value:"4"}],
  ["countGoalStatus",{textContent:""}],["countGoal",{value:"12"}]]);
 const localStorage={
  getItem(k){access.push("read");return store.get(k)||null},
  setItem(k,v){access.push("write");store.set(k,v)},
  removeItem(k){access.push("remove");store.delete(k)}
 };
 const ctx=vm.createContext({
  $:id=>dom.get(id),localStorage,codeCountGoalByMonth:new Map(),
  activeCodeSession:code?"T".repeat(43):"",
  auth:{currentUser:code&&!mixed?null:{uid:"staff-email-1"}},
  countPeriod:"month",countExportRows:{summary:{total:5}},
  data:{companyName:"協力店A"}
 });
 vm.runInContext(funcs+buttons,ctx);
 return {ctx,dom,store,access,run:s=>vm.runInContext(s,ctx)};
}
test("company-code partner calculates monthly and daily targets without an email account",()=>{
 const t=make();t.run("renderCountGoal()");
 assert.equal(t.dom.get("countGoalBox").hidden,false);
 t.run('$("countGoalSave").onclick()');
 assert.equal(t.ctx.codeCountGoalByMonth.get("2026-11"),"12");
 assert.match(t.dom.get("countGoalStatus").textContent,/現在 5\/12件/);
 assert.equal(t.dom.get("countGoalDailyEstimate").textContent,"残り必要件数 7件｜1日あたり 2件");
 assert.deepEqual(t.access,[]);
});
test("company goals are isolated by month, never replace stored counts",()=>{
 const t=make();t.run('$("countGoalSave").onclick()');
 t.dom.get("dashboardPartnerMonth").value="2026-12";
 t.run("renderCountGoal()");
 assert.match(t.dom.get("countGoalStatus").textContent,/未設定/);
 t.dom.get("countGoal").value="30";t.run('$("countGoalSave").onclick()');
 assert.equal(t.ctx.codeCountGoalByMonth.get("2026-11"),"12");
 assert.equal(t.ctx.codeCountGoalByMonth.get("2026-12"),"30");
 assert.equal(t.ctx.countExportRows.summary.total,5);
});
test("logout/new company-code login clears ephemeral targets, no shared storage",()=>{
 assert.match(html,/const clearCompanySession=\(\)=>\{[\s\S]*?codeCountGoalByMonth\.clear\(\)/);
 assert.match(html,/async function enterIsolatedCompanyCodeSession\(result\)\{[\s\S]*?codeCountGoalByMonth\.clear\(\)/);
 const t=make();t.run('$("countGoalSave").onclick()');
 t.ctx.codeCountGoalByMonth.clear();t.run("renderCountGoal()");
 assert.match(t.dom.get("countGoalStatus").textContent,/未設定/);
 assert.deepEqual(t.access,[]);
});
test("existing email login retains unchanged localStorage goal persistence",()=>{
 const t=make({code:false});t.run('$("countGoalSave").onclick()');
 assert.equal(t.store.size,1);
 assert.equal(t.access.includes("write"),true);
 assert.equal(t.ctx.codeCountGoalByMonth.size,0);
 t.run('$("countGoalClear").onclick()');
 assert.equal(t.store.size,0);
 assert.equal(t.access.includes("remove"),true);
});
test("a mixed code/email identity and missing verified counts both cannot use target tab",()=>{
 for(const variant of [{mixed:true},{noData:true}]){
  const t=make(variant);
  if(variant.noData)t.run("countExportRows=null");
  t.run("renderCountGoal()");
  assert.equal(t.dom.get("countGoalBox").hidden,true);
  t.run('$("countGoalSave").onclick()');
  assert.equal(t.ctx.codeCountGoalByMonth.size,0);
  assert.deepEqual(t.access,[]);
 }
});
test("invalid targets fail closed and no account or finance database is touched",()=>{
 const t=make();
 for(const raw of ["0","-1","1e6","1000000","2.3"]){
  t.dom.get("countGoal").value=raw;
  t.run('$("countGoalSave").onclick()');
  assert.equal(t.ctx.codeCountGoalByMonth.size,0);
 }
 assert.equal(t.ctx.countExportRows.summary.total,5);
 assert.deepEqual(t.access,[]);
 assert.doesNotMatch(funcs+buttons,/\b(setDoc|updateDoc|deleteDoc|runTransaction|httpsCallable)\b/);
});
