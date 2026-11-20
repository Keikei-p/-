import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const partner=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const a=html.indexOf("async function nicoEnterCompanyCodeFromMain(result){");
const b=html.indexOf("\nconst nicoMainCodeToggle=",a);
assert(a>0&&b>a,"main company-code handoff must be declared before form bindings");
const block=html.slice(a,b);
const TOKEN="X".repeat(43);
function subject({user=true,logoutFails=false,logoutRetains=false,storageFails=false,navigationFails=false}={}){
 const calls=[],auth={currentUser:user?{uid:"old-email"}:null,authStateReady:async()=>calls.push("ready")};
 const values=new Map();
 const sessionStorage={
  setItem(k,v){calls.push("store");if(storageFails)throw Error("storage_failure");values.set(k,v);},
  removeItem(k){calls.push("remove");values.delete(k);}
 };
 const location={origin:"https://nico-factory.web.app",assign(url){
  calls.push("navigate");
  if(navigationFails)throw Error("bad_location");
  assert.equal(url,"https://nico-factory.web.app/partner-workspace.html");
  assert.equal(auth.currentUser,null);
  assert.equal(values.get("nicoPartnerCodeSession"),TOKEN);
 }};
 const sandbox=vm.createContext({auth,location,sessionStorage,URL,signOut:async()=>{
  calls.push("signout");if(logoutFails)throw Error("signout_failure");
  if(!logoutRetains)auth.currentUser=null;
 }});
 const go=vm.runInContext(block+"\nnicoEnterCompanyCodeFromMain",sandbox);
 return {go,calls,auth,values};
}
test("unified login has company-code input without replacing original email login",()=>{
 for(const id of ["nicoMainCompanyCodeToggle","nicoMainCompanyCodePanel",
  "nicoMainCompanyCodeForm","nicoMainCompanyCodeSubmit","nicoMainCodeBack"])
  assert(html.includes('id="'+id+'"'),id);
 assert.match(html,/async function login\(\)/);
 assert.match(html,/await signInWithEmailAndPassword\(/);
 assert.match(html,/loginPartnerCompanyCode/);
 assert.match(html,/nicoMainCodeForm\.onsubmit=async event/);
 assert.match(html,/nicoMainCodeToggle\.onclick=/);
 assert.match(html,/nicoMainCodeBack\.onclick=/);
 assert.match(html,/nicoMainCompanyCodePanel" class="nico-main-code-panel" hidden/);
 assert.match(html,/const NICO_PARTNER_TAB_UI_ENABLED = false;/);
 assert.match(html,/const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;/);
});
test("existing company-code backend session and count-only page are reused",()=>{
 assert.match(partner,/sessionStorage\.getItem\("nicoPartnerCodeSession"\)/);
 assert.match(partner,/session\.active!==true|activeCodeSession/);
 assert.match(block,/sessionStorage\.setItem\("nicoPartnerCodeSession",token\)/);
 assert.match(block,/location\.assign\(new URL\("\/partner-workspace\.html",location\.origin\)\.href\)/);
 assert.doesNotMatch(block,/\b(?:setDoc|updateDoc|deleteDoc|getDoc|deleteUser|createUser|records|products|unitPrice|revenueGoals)\b/);
});
test("old email identity is signed out BEFORE code session is saved",async()=>{
 const a=subject();
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["ready","signout","store","navigate"]);
 assert.equal(a.auth.currentUser,null);
});
test("code-only account can navigate without email Auth or old account mutation",async()=>{
 const a=subject({user:false});
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["ready","store","navigate"]);
});
test("blocked email logout cannot expose a new code session",async()=>{
 for(const options of [{logoutFails:true},{logoutRetains:true}]){
  const x=subject(options);
  await assert.rejects(x.go({sessionToken:TOKEN}));
  assert.equal(x.values.size,0);
  assert(!x.calls.includes("navigate"));
 }
});
test("invalid session and browser storage failure fail closed",async()=>{
 const x=subject();
 await assert.rejects(x.go({sessionToken:"not-a-token"}),/invalid_company_code_session/);
 assert.deepEqual(x.calls,[]);
 const y=subject({storageFails:true});
 await assert.rejects(y.go({sessionToken:TOKEN}),/storage_failure/);
 assert(!y.calls.includes("navigate"));
 assert.equal(y.values.size,0);
});
test("navigation errors revoke the pending local session before returning failure",async()=>{
 const x=subject({navigationFails:true});
 await assert.rejects(x.go({sessionToken:TOKEN}),/company_code_navigation_failed/);
 assert.equal(x.values.size,0);
 assert.deepEqual(x.calls,["ready","signout","store","navigate","remove"]);
});

test("main company-code form signs out restored legacy email before requesting code login",async()=>{
 const start=html.indexOf("nicoMainCodeForm.onsubmit=async event=>{");
 const end=html.indexOf("\n/* =====================================================\n   ログイン",start);
 assert(start>0&&end>start,"main code login handler is present");
 const handler=html.slice(start,end);
 assert(handler.indexOf('await auth.authStateReady()')>=0);
 assert(handler.indexOf("await signOut(auth)")>handler.indexOf("await auth.authStateReady()"));
 assert(handler.indexOf('if(auth.currentUser)throw Error("old_email_session_still_active")')>
  handler.indexOf("await signOut(auth)"));
 assert(handler.indexOf('await signOut(auth)')<
  handler.indexOf('loginCode({companyCode:code,password})'),
  "must sign out before the backend request, not just after the response");
 const CODE="NICO-"+"A".repeat(24);
 async function runScenario({initialEmail=true,restoresEmail=false,
  logoutThrows=false,logoutRetains=false}={}){
  const events=[],submit={disabled:false},status={textContent:""},
   field={value:"not-a-real-password"},code={value:CODE};
  const nodes={nicoMainCompanyCode:code,nicoMainCompanyPassword:field,
   nicoMainCompanyCodeStatus:status,nicoMainCompanyCodeSubmit:submit};
  const auth={currentUser:initialEmail?{uid:"old-email"}:null,
   async authStateReady(){
    events.push("ready");
    if(restoresEmail)auth.currentUser={uid:"restored-old-email"};
   }};
  const form={onsubmit:null};
  const ctx=vm.createContext({
   nicoMainCodeForm:form,nicoMainCodePanel:{hidden:false},auth,
   document:{getElementById:key=>nodes[key]},
   signOut:async()=>{
    events.push("signout");
    if(logoutThrows)throw Error("signout_failed");
    if(!logoutRetains)auth.currentUser=null;
   },
   partnerCountFunctions:{},
   httpsCallable:(_functions,name,opts)=>{
    assert.equal(name,"loginPartnerCompanyCode");
    assert.equal(opts.timeout,15000);
    return async args=>{
     events.push("backend");
     assert.equal(auth.currentUser,null,"no legacy Firebase ID token on login");
     assert.equal(args.companyCode,CODE);
     assert.equal(args.password,"not-a-real-password");
     return {data:{sessionToken:"X".repeat(43)}};
    };
   },
   nicoEnterCompanyCodeFromMain:async response=>{
    events.push("handoff");
    assert.equal(response.sessionToken,"X".repeat(43));
    assert.equal(auth.currentUser,null);
   }
  });
  vm.runInContext("let nicoMainCodeLoginBusy=false;\n"+handler,ctx);
  await form.onsubmit({preventDefault:()=>events.push("prevent")});
  assert.equal(field.value,"","password erased on success or error");
  assert.equal(submit.disabled,false,"button always unlocked");
  return {events,status:status.textContent,auth};
 }
 const normal=await runScenario();
 assert.deepEqual(normal.events,["prevent","ready","signout","backend","handoff"]);
 assert.equal(normal.auth.currentUser,null);
 const codeOnly=await runScenario({initialEmail:false});
 assert.deepEqual(codeOnly.events,["prevent","ready","backend","handoff"]);
 const restored=await runScenario({initialEmail:false,restoresEmail:true});
 assert.deepEqual(restored.events,["prevent","ready","signout","backend","handoff"]);
 for(const options of [{logoutThrows:true},{logoutRetains:true}]){
  const stopped=await runScenario(options);
  assert.deepEqual(stopped.events,["prevent","ready","signout"]);
  assert.match(stopped.status,/ログインできませんでした/);
  assert.equal(stopped.events.includes("backend"),false);
  assert.equal(stopped.events.includes("handoff"),false);
 }
});
