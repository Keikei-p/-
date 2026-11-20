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
function subject({user=true,logoutFails=false,logoutRetains=false,storageFails=false,navigationFails=false,
 preflightFails=false,preflightInvalid=false}={}){
 const calls=[],auth={currentUser:user?{uid:"old-email"}:null,authStateReady:async()=>calls.push("ready")};
 const values=new Map();
 const sessionStorage={
  setItem(k,v){
   calls.push(k==="nicoPartnerCodeSessionProbe"?"probe":"store");
   if(storageFails)throw Error("storage_failure");
   values.set(k,v);
  },
  removeItem(k){
   calls.push(k==="nicoPartnerCodeSessionProbe"?"unprobe":"remove");
   values.delete(k);
  }
 };
 const location={origin:"https://nico-factory.web.app",assign(url){
  calls.push("navigate");
  if(navigationFails)throw Error("bad_location");
  assert.equal(url,"https://nico-factory.web.app/partner-workspace.html");
  assert.equal(auth.currentUser,null);
  assert.equal(values.get("nicoPartnerCodeSession"),TOKEN);
 }};
 const sandbox=vm.createContext({auth,location,sessionStorage,URL,
  partnerMainDate:()=> "2026-11-20",
  partnerAnonymousWorkspacePreflight:async data=>{
   calls.push("preflight");
   assert.equal(data.date,"2026-11-20");
   assert.equal(data.codeSessionToken,TOKEN);
   if(preflightFails)throw Error("workspace_unavailable");
   return {data:{date:data.date,role:"owner",
    categories:preflightInvalid?[]:["NURO"]}};
  },
  signOut:async()=>{
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
 assert.deepEqual(a.calls,["preflight","probe","unprobe","ready","signout","store","navigate"]);
 assert.equal(a.auth.currentUser,null);
});
test("code-only account can navigate without email Auth or old account mutation",async()=>{
 const a=subject({user:false});
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["preflight","probe","unprobe","ready","store","navigate"]);
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
 await assert.rejects(y.go({sessionToken:TOKEN}),/company_code_storage_unavailable/);
 assert.deepEqual(y.calls,["preflight","probe"]);
 assert.equal(y.auth.currentUser.uid,"old-email","storage error must not sign out Owner");
 assert(!y.calls.includes("signout"));
 assert(!y.calls.includes("navigate"));
 assert.equal(y.values.size,0);
});
test("navigation errors revoke the pending local session before returning failure",async()=>{
 const x=subject({navigationFails:true});
 await assert.rejects(x.go({sessionToken:TOKEN}),/company_code_navigation_failed/);
 assert.equal(x.values.size,0);
 assert.deepEqual(x.calls,["preflight","probe","unprobe","ready","signout","store","navigate","remove"]);
});

test("invalid code or unusable workspace leaves the original email session untouched",async()=>{
 for(const options of [{preflightFails:true},{preflightInvalid:true}]){
  const x=subject(options);
  await assert.rejects(x.go({sessionToken:TOKEN}));
  assert.deepEqual(x.calls,["preflight"]);
  assert.equal(x.auth.currentUser.uid,"old-email");
  assert.equal(x.values.size,0);
 }
});

test("unified code login never logs out an Owner just to check a password",async()=>{
 const start=html.indexOf("nicoMainCodeForm.onsubmit=async event=>{");
 const end=html.indexOf("\n/* =====================================================\n   ログイン",start);
 assert(start>0&&end>start,"unified code login form is present");
 const handler=html.slice(start,end);
 assert.match(html,/initializeApp\(firebaseConfig,"nico-partner-code-login-isolated"\)/);
 assert.match(html,/getFunctions\(partnerAnonymousCodeApp,"asia-northeast1"\)/);
 assert.doesNotMatch(html,/getAuth\(partnerAnonymousCodeApp\)/);
 assert.match(handler,/httpsCallable\(partnerAnonymousCodeFunctions,"loginPartnerCompanyCode"/);
 assert.doesNotMatch(handler,/await signOut\(auth\)/);
 const CODE="NICO-"+"A".repeat(24);
 async function run({signedIn=true,backendReject=false}={}){
  const events=[],submit={disabled:false},status={textContent:""},
   field={value:"private-test-password"},code={value:CODE},app={};
  const nodes={nicoMainCompanyCode:code,nicoMainCompanyPassword:field,
   nicoMainCompanyCodeStatus:status,nicoMainCompanyCodeSubmit:submit};
  const auth={currentUser:signedIn?{uid:"existing-owner"}:null};
  const form={onsubmit:null};
  const ctx=vm.createContext({
   nicoMainCodeForm:form,nicoMainCodePanel:{hidden:false},auth,
   partnerAnonymousCodeFunctions:app,
   document:{getElementById:key=>nodes[key]},
   httpsCallable:(functions,name,opts)=>{
    assert.equal(functions,app,"never attach the default signed-in Firebase app");
    assert.equal(name,"loginPartnerCompanyCode");
    assert.equal(opts.timeout,15000);
    return async args=>{
     events.push("backend");
     assert.equal(args.companyCode,CODE);
     assert.equal(args.password,"private-test-password");
     if(backendReject)throw Error("invalid_company_credentials");
     return {data:{sessionToken:TOKEN}};
    };
   },
   nicoEnterCompanyCodeFromMain:async result=>{
    events.push("handoff");
    assert.equal(result.sessionToken,TOKEN);
   }
  });
  vm.runInContext("let nicoMainCodeLoginBusy=false;\n"+handler,ctx);
  await form.onsubmit({preventDefault:()=>events.push("prevent")});
  assert.equal(field.value,"","never retain the password");
  assert.equal(submit.disabled,false,"button always reenabled");
  return {events,auth,status:status.textContent};
 }
 const failed=await run({backendReject:true});
 assert.deepEqual(failed.events,["prevent","backend"]);
 assert.equal(failed.auth.currentUser.uid,"existing-owner");
 assert.match(failed.status,/ログインできませんでした/);
 const failedAnonymous=await run({signedIn:false,backendReject:true});
 assert.deepEqual(failedAnonymous.events,["prevent","backend"]);
 assert.equal(failedAnonymous.auth.currentUser,null);
 const success=await run();
 assert.deepEqual(success.events,["prevent","backend","handoff"]);
 assert.equal(success.auth.currentUser.uid,"existing-owner",
  "only the verified handoff, tested separately, may end email Auth");
});
