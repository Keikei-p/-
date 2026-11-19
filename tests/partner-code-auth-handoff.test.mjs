import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const start=html.indexOf("async function enterIsolatedCompanyCodeSession(result){");
const end=html.indexOf('\n$("companyCodeLoginForm").onsubmit=',start);
assert(start>0&&end>start,"Safe company-code handoff must be present before both login forms");
const source=html.slice(start,end);
const TOKEN="C".repeat(43);
function setup({emailSignedIn=true,signoutError=false,signoutLeavesIdentity=false}={}){
 const events=[];
 const auth={currentUser:emailSignedIn?{uid:"old-disabled-email"}:null};
 const sessionStorage={setItem(k,v){events.push(["store",k,v]);}};
 const context=vm.createContext({
  auth,activeCodeSession:null,companyCodeSession:false,
  codeCountSessionEpoch:0,codeCountGoalByMonth:new Map([["2026-11","100"]]),pendingPartnerSaveReceipts:new Map(),countLoadId:0,countDayCache:new Map(),
  resetPartnerPublishedCountPanels:()=>events.push(["reset"]),
  clearCountOnlyDashboard:()=>events.push(["clear"]),
  signOut:async()=>{
   events.push(["signout"]);
   if(signoutError)throw Error("signout_failed");
   if(!signoutLeavesIdentity)auth.currentUser=null;
  },
  sessionStorage,
  refresh:async()=>{
   events.push(["refresh"]);
   assert.equal(auth.currentUser,null,"old Firebase identity must not share a code session");
   assert.equal(context.activeCodeSession,TOKEN);
   assert.equal(context.companyCodeSession,true);
  }
 });
 const run=vm.runInContext(source+"\nenterIsolatedCompanyCodeSession",context);
 return {run,events,context,auth};
}
test("both company-code login and activation use one fail-closed handoff",()=>{
 assert.equal((html.match(/await enterIsolatedCompanyCodeSession\(result\);/g)||[]).length,2);
 assert.equal((html.match(/activeCodeSession=result\.sessionToken/g)||[]).length,0);
 assert.match(source,/await signOut\(auth\)/);
 assert.match(source,/if\(auth\.currentUser\)throw Error\("old_email_session_still_active"\)/);
 assert(!/deleteUser\(|updateDoc\(|setDoc\(|firebase deploy/.test(source));
});
test("switching from old email signs out before enabling count-only code token",async()=>{
 const x=setup();
 await x.run({sessionToken:TOKEN});
 assert.equal(x.auth.currentUser,null);
 assert.equal(x.context.activeCodeSession,TOKEN);
 assert.equal(x.context.codeCountGoalByMonth.size,0);
 assert.deepEqual(x.events.map(y=>y[0]),["signout","reset","clear","store","refresh"]);
 assert.deepEqual(x.events[3],["store","nicoPartnerCodeSession",TOKEN]);
 assert.equal(x.context.codeCountSessionEpoch,1);
 assert.equal(x.context.countLoadId,1);
});
test("sign-out failure cannot retain mixed email and company-code identities",async()=>{
 for(const cfg of [{signoutError:true},{signoutLeavesIdentity:true}]){
  const x=setup(cfg);
  await assert.rejects(x.run({sessionToken:TOKEN}));
  assert.equal(x.context.activeCodeSession,null);
  assert.equal(x.context.companyCodeSession,false);
  assert.equal(x.events.some(y=>y[0]==="store"||y[0]==="refresh"),false);
 }
});
test("code-only sign-in does not call old email sign-out or mix financial permissions",async()=>{
 const x=setup({emailSignedIn:false});
 await x.run({sessionToken:TOKEN});
 assert.deepEqual(x.events.map(e=>e[0]),["reset","clear","store","refresh"]);
 assert.equal(x.auth.currentUser,null);
});
test("invalid code session is never stored or activated",async()=>{
 const x=setup();
 await assert.rejects(x.run({sessionToken:"bad"}),/invalid_code_session/);
 assert.deepEqual(x.events,[]);
 assert.equal(x.context.activeCodeSession,null);
});

test("company-code auth never inherits a stale email workspace or prior code bearer",async()=>{
 const start=html.indexOf("const isolatedCompanyCodeCalls=new Set([");
 const end=html.indexOf('const get=call("getPartnerWorkspace")',start);
 assert(start>0&&end>start,"company-code scope guard must be present");
 const calls=[],token="S".repeat(43);
 const context=vm.createContext({
  functions:{},workspaceCompanyId:"previousWorkspace",activeCodeSession:"",
  httpsCallable:(_functions,name)=>async data=>{
   calls.push({name,data:JSON.parse(JSON.stringify(data))});
   return {data:{saved:false}};
  }
 });
 const call=vm.runInContext(html.slice(start,end)+"\ncall",context);
 const issue=call("issuePartnerCompanyCode");
 const activate=call("activatePartnerCompanyCode");
 const login=call("loginPartnerCompanyCode");
 const logout=call("logoutPartnerCompanyCode");
 const get=call("getPartnerWorkspace");
 await login({companyCode:"NICO-TEST",password:"placeholder"});
 await activate({companyCode:"NICO-TEST",password:"placeholder"});
 await issue({companyName:"協力店"});
 await get({date:"2026-11-20"});
 assert.deepEqual(calls.slice(0,3).map(x=>x.data),[
  {companyCode:"NICO-TEST",password:"placeholder"},
  {companyCode:"NICO-TEST",password:"placeholder"},
  {companyName:"協力店"}
 ]);
 assert.deepEqual(calls[3].data,{
  date:"2026-11-20",workspaceCompanyId:"previousWorkspace"
 },"legacy email workspace remains available on the existing count-only GET");
 context.activeCodeSession=token;
 await login({companyCode:"NICO-TEST",password:"new-password"});
 await logout({codeSessionToken:"explicit-token"});
 await get({date:"2026-11-20"});
 assert.deepEqual(calls[4].data,{
  companyCode:"NICO-TEST",password:"new-password"
 },"re-login must never receive previous code bearer");
 assert.deepEqual(calls[5].data,{codeSessionToken:"explicit-token"},
  "logout uses only the explicitly supplied code session");
 assert.deepEqual(calls[6].data,{
  date:"2026-11-20",codeSessionToken:token
 },"existing count-only GET still uses a single server-verified bearer");
 assert.equal(calls.some(x=>x.name==="loginPartnerCompanyCode"&&
  ("workspaceCompanyId" in x.data||"codeSessionToken" in x.data)),false);
 assert(!/deleteUser\(|updateDoc\(|setDoc\(|firebase deploy/.test(html.slice(start,end)));
});

test("legacy email signout is enforced before company-code login and activation",async()=>{
 const begin=html.indexOf("async function endEmailSessionBeforeCompanyCodeAuth(){");
 const end=html.indexOf("// A company-code session and an old Firebase email identity",begin);
 assert(begin>0&&end>begin);
 const source=html.slice(begin,end);
 const login=html.slice(html.indexOf('$("companyCodeLoginForm").onsubmit='),
  html.indexOf('$("companyCodeActivateForm").onsubmit='));
 const activation=html.slice(html.indexOf('$("companyCodeActivateForm").onsubmit='),
  html.indexOf('$("companyCodeExisting").onchange='));
 for(const [snippet,backend] of [
  [login,"await codeLogin({companyCode,password})"],
  [activation,"await activateCompanyCode({companyCode,password})"]
 ]){
  const guard=snippet.indexOf("await endEmailSessionBeforeCompanyCodeAuth()");
  assert(guard>=0&&guard<snippet.indexOf(backend),
   "old email Auth must sign out before "+backend);
 }
 for(const config of [
  {signedIn:true,signoutError:false,remain:false,expected:1},
  {signedIn:false,signoutError:false,remain:false,expected:0}
 ]){
  const auth={currentUser:config.signedIn?{uid:"disabledOld"}:null};
  let signouts=0;
  const context=vm.createContext({auth,signOut:async()=>{
   signouts++;
   if(!config.remain)auth.currentUser=null;
  }});
  const guard=vm.runInContext(source+"\nendEmailSessionBeforeCompanyCodeAuth",context);
  await guard();
  assert.equal(auth.currentUser,null);
  assert.equal(signouts,config.expected);
 }
 for(const failing of [{throwError:true},{remain:true}]){
  const auth={currentUser:{uid:"disabledOld"}},events=[];
  const context=vm.createContext({auth,signOut:async()=>{
   events.push("signout");
   if(failing.throwError)throw Error("fail");
   if(!failing.remain)auth.currentUser=null;
  }});
  const guard=vm.runInContext(source+"\nendEmailSessionBeforeCompanyCodeAuth",context);
  await assert.rejects(guard());
  assert.deepEqual(events,["signout"]);
  assert.equal(auth.currentUser?.uid,"disabledOld");
 }
 assert(!/deleteUser\(|updateDoc\(|setDoc\(|firebase deploy/.test(source));
});
