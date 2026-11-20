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
function setup({emailSignedIn=true,signoutError=false,signoutLeavesIdentity=false,
 preflightReject=false,preflightMalformed=false,storageFails=false}={}){
 const events=[];
 const auth={currentUser:emailSignedIn?{uid:"old-disabled-email"}:null};
 const sessionStorage={
  setItem(k,v){
   events.push([k==="nicoPartnerCodeSessionProbe"?"probe":"store",k,v]);
   if(storageFails)throw Error("storage_failure");
  },
  removeItem(k){events.push(["unprobe",k]);}
 };
 const context=vm.createContext({
  auth,
  dateParts:{year:"2026",month:"11",day:"20"},
  preflightCodeWorkspace:async data=>{
   events.push(["preflight",data.date]);
   assert.equal(data.date,"2026-11-20");
   assert.equal(data.codeSessionToken,TOKEN);
   if(preflightReject)throw Error("workspace_not_ready");
   return {data:{date:data.date,role:preflightMalformed?"hub":"owner",
    categories:["NURO"]}};
  },
  activeCodeSession:null,companyCodeSession:false,
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
 assert.deepEqual(x.events.map(y=>y[0]),["preflight","probe","unprobe","signout","reset","clear","store","refresh"]);
 assert.deepEqual(x.events[6],["store","nicoPartnerCodeSession",TOKEN]);
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
 assert.deepEqual(x.events.map(e=>e[0]),["preflight","probe","unprobe","reset","clear","store","refresh"]);
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
 const anonymousFunctions={},userFunctions={};
 const context=vm.createContext({
  functions:userFunctions,anonymousCodeFunctions:anonymousFunctions,
  workspaceCompanyId:"previousWorkspace",activeCodeSession:"",
  httpsCallable:(target,name)=>async data=>{
   calls.push({name,scope:target===anonymousFunctions?"anonymous":"user",
    data:JSON.parse(JSON.stringify(data))});
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
 assert.deepEqual(calls.map(x=>x.scope),
  ["anonymous","anonymous","user","user","anonymous","user","user"],
  "only password validation uses an anonymous client; Owner issues remain authenticated");
 assert(!/deleteUser\(|updateDoc\(|setDoc\(|firebase deploy/.test(html.slice(start,end)));
});

test("invalid company-code credentials never sign out a working Owner",async()=>{
 const login=html.slice(html.indexOf('$("companyCodeLoginForm").onsubmit='),
  html.indexOf('$("companyCodeActivateForm").onsubmit='));
 const activation=html.slice(html.indexOf('$("companyCodeActivateForm").onsubmit='),
  html.indexOf('$("companyCodeExisting").onchange='));
 assert.match(html,/initializeApp\(app\.options,"nico-partner-code-auth-isolated"\)/);
 assert.match(html,/getFunctions\(codeAuthApp,"asia-northeast1"\)/);
 assert.doesNotMatch(html,/getAuth\(codeAuthApp\)/);
 for(const source of [login,activation]){
  assert.doesNotMatch(source,/await signOut\(auth\)|endEmailSessionBeforeCompanyCodeAuth/);
 }
 for(const mode of ["login","activation"]){
  const ownerAuth={currentUser:{uid:"owner"},emailVerified:true};
  const events=[],button={disabled:false};
  const form={onsubmit:null,querySelector:()=>button};
  const fields={
   companyCodeLoginForm:form,companyCodeActivateForm:form,
   companyLoginCode:{value:"NICO-TEST"},companyActivationCode:{value:"NICO-TEST"},
   companyLoginPassword:{value:"bad-test-password"},
   companyActivationPassword:{value:"bad-test-password"}
  };
  const ctx=vm.createContext({
   auth:ownerAuth,$:key=>fields[key],notice:()=>{},fail:()=>{},
   codeLogin:async()=>{
    events.push("backend");
    throw Error("wrong_credentials");
   },
   activateCompanyCode:async()=>{
    events.push("backend");
    throw Error("wrong_credentials");
   },
   enterIsolatedCompanyCodeSession:async()=>events.push("handoff")
  });
  vm.runInContext(mode==="login"?login:activation,ctx);
  await form.onsubmit({preventDefault:()=>{}});
  assert.deepEqual(events,["backend"]);
  assert.equal(ownerAuth.currentUser.uid,"owner");
  assert.equal(button.disabled,false);
  assert.equal(fields[mode==="login"?"companyLoginPassword":"companyActivationPassword"].value,"");
 }
});

test("disabled count workspace cannot end email Auth after valid password",async()=>{
 for(const condition of [{preflightReject:true},{preflightMalformed:true}]){
  const x=setup(condition);
  await assert.rejects(x.run({sessionToken:TOKEN}));
  assert.deepEqual(x.events.map(e=>e[0]),["preflight"]);
  assert.equal(x.auth.currentUser.uid,"old-disabled-email");
  assert.equal(x.context.activeCodeSession,null);
  assert.equal(x.context.companyCodeSession,false);
  assert.equal(x.events.some(e=>e[0]==="store"),false);
 }
});

test("blocked Safari sessionStorage leaves prior email login and counts unchanged",async()=>{
 const x=setup({storageFails:true}),before=x.auth.currentUser;
 await assert.rejects(x.run({sessionToken:TOKEN}),/storage_failure/);
 assert.deepEqual(x.events.map(e=>e[0]),["preflight","probe"]);
 assert.equal(x.auth.currentUser,before);
 assert.equal(x.context.activeCodeSession,null);
 assert.equal(x.context.companyCodeSession,false);
 assert.equal(x.events.some(e=>e[0]==="signout"||e[0]==="store"),false);
});
