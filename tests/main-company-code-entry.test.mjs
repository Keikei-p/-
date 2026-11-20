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
function subject({user=true,logoutFails=false,logoutRetains=false,storageFails=false,workspaceFails=false,
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
 const appScreen={style:{display:"none"}},authScreen={style:{display:"none"}};
 const sandbox=vm.createContext({auth,sessionStorage,URL,appScreen,authScreen,
  partnerMainCodeToken:"",partnerMainCodeEpoch:0,
  openSameAppCompanyCodeWorkspace:async()=>{
   calls.push("open");
   assert.equal(auth.currentUser,null,"code view must not inherit owner Auth");
   assert.equal(values.get("nicoPartnerCodeSession"),TOKEN);
   assert.equal(sandbox.partnerMainCodeToken,TOKEN);
   return !workspaceFails;
  },
  partnerMainCodeForget:()=>{
   sandbox.partnerMainCodeToken="";
   calls.push("remove");
   values.delete("nicoPartnerCodeSession");
  },
  resetPartnerInline:()=>calls.push("reset"),
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
 return {go,calls,auth,values,appScreen,authScreen,sandbox};
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
test("existing company-code backend session and SAME page count-only API are reused",()=>{
 assert.match(partner,/sessionStorage\.getItem\("nicoPartnerCodeSession"\)/);
 assert.match(partner,/session\.active!==true|activeCodeSession/);
 assert.match(block,/sessionStorage\.setItem\("nicoPartnerCodeSession",token\)/);
 assert.match(block,/await openSameAppCompanyCodeWorkspace\(\)/);
 assert.doesNotMatch(block,/location\.assign\(|\/partner-workspace\.html",location\.origin/);
 assert.match(html,/const partnerMainCodeCountGet=httpsCallable\(partnerAnonymousCodeFunctions/);
 assert.match(html,/const partnerMainCodeCountSave=httpsCallable\(partnerAnonymousCodeFunctions/);
 assert.doesNotMatch(block,/\b(?:setDoc|updateDoc|deleteDoc|getDoc|deleteUser|createUser|records|products|unitPrice|revenueGoals)\b/);
});
test("old email identity is signed out BEFORE code session is saved",async()=>{
 const a=subject();
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["preflight","probe","unprobe","ready","signout","store","open"]);
 assert.equal(a.auth.currentUser,null);
});
test("code-only account uses the existing dashboard without email Auth or navigation",async()=>{
 const a=subject({user:false});
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["preflight","probe","unprobe","ready","store","open"]);
});
test("blocked email logout cannot expose a new code session",async()=>{
 for(const options of [{logoutFails:true},{logoutRetains:true}]){
  const x=subject(options);
  await assert.rejects(x.go({sessionToken:TOKEN}));
  assert.equal(x.values.size,0);
  assert(!x.calls.includes("open"));
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
 assert(!y.calls.includes("open"));
 assert.equal(y.values.size,0);
});
test("failed same-page count GET clears stored session and hides partial dashboard",async()=>{
 const x=subject({workspaceFails:true});
 await assert.rejects(x.go({sessionToken:TOKEN}),/company_code_workspace_not_ready/);
 assert.equal(x.values.size,0);
 assert.equal(x.sandbox.partnerMainCodeToken,"");
 assert.equal(x.appScreen.style.display,"none");
 assert.equal(x.authScreen.style.display,"block");
 assert.deepEqual(x.calls,["preflight","probe","unprobe","ready","signout","store","open","remove","reset"]);
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

test("old account workspace discovery cannot reopen stale login after logout",async()=>{
 const a=html.indexOf("onAuthStateChanged(\n  auth,\n  async user => {");
 const b=html.indexOf("\n);\n\n\n/* =====================================================\n   ユーザー情報読み込み",a);
 assert(a>0&&b>a,"main auth-state callback must exist");
 const source=html.slice(a,b+3);
 assert.match(source,/if\(auth\.currentUser\?\.uid!==user\.uid\)return;\s*if\(partnerWorkspaceId\)/);
 for(const changed of [true,false]){
  const events=[],user={uid:"old-owner",emailVerified:true},
   auth={currentUser:user};
  let observed;
  const ctx=vm.createContext({
   auth,URL,location:{href:"https://nico-factory.web.app/"},
   currentUser:null,partnerMainCodeToken:"",partnerEmailLinkPending:false,partnerEmailLinkBusy:false,
   partnerEmailLinkPasswordState:null,
   partnerMainPendingInvite:()=>null,
   partnerMainOwnCompanyPreferred:()=>false,
   rememberedPartnerWorkspace:()=>"",
   partnerMainDate:()=>"2026-11-20",
   readPartnerWorkDay:async()=>{
    events.push("lookup");
    if(changed)auth.currentUser={uid:"new-owner",emailVerified:true};
    throw Error("functions/unavailable");
   },
   console:{info:()=>events.push("lookup_failed")},
   enterApplication:async found=>events.push("entered:"+found.uid),
   openSameAppPartnerWorkspace:async()=>events.push("partner_entered"),
   partnerMainValidId:()=>true,
   onAuthStateChanged:(_auth,cb)=>{observed=cb}
  });
  vm.runInContext(source,ctx);
  await observed(user);
  assert.deepEqual(events,changed?
   ["lookup","lookup_failed"]:
   ["lookup","lookup_failed","entered:old-owner"]);
  assert.equal(events.includes("partner_entered"),false);
 }
});
test("internal bootstrap never subscribes old login after sign-out or account switch",async()=>{
 const a=html.indexOf("async function enterApplication(\n  user\n) {");
 const b=html.indexOf("\n\ncheckVerificationButton.onclick =",a);
 assert(a>0&&b>a,"original internal login bootstrap must exist");
 const source=html.slice(a,b);
 for(const scenario of ["stale-at-entry","switch-during-load",
  "switch-during-notifications","switch-and-throw","healthy"]){
  const oldUser={uid:"old-owner",emailVerified:true,
   getIdToken:async()=>events.push("token")};
  const events=[],auth={currentUser:oldUser},
   screens=()=>({style:{display:"initial"}});
  const authScreen=screens(),appScreen=screens(),
   verificationScreen=screens(),companySetupScreen=screens(),
   loginStatus={textContent:""},databaseStatus={textContent:""};
  if(scenario==="stale-at-entry")auth.currentUser={uid:"new-owner"};
  const ctx=vm.createContext({
   auth,currentUser:null,resetPartnerInline:()=>events.push("reset"),
   authScreen,appScreen,verificationScreen,companySetupScreen,
   loginStatus,databaseStatus,console,
   loadUserData:async()=>{
    events.push("load");
    if(scenario==="switch-during-load"||scenario==="switch-and-throw"){
     auth.currentUser={uid:"new-owner"};
     if(scenario==="switch-and-throw"){
      appScreen.style.display="new_user_screen";
      throw Error("old_read_failed");
     }
    }
    return true;
   },
   loadReportTemplateSettings:async()=>events.push("report"),
   loadNotificationSettings:async()=>{
    events.push("notify");
    if(scenario==="switch-during-notifications"){
     auth.currentUser={uid:"new-owner"};
     appScreen.style.display="new_user_screen";
    }
   },
   startRealtimeListeners:()=>events.push("subscribe"),
   showError:()=>events.push("show-error"),
   firebaseErrorMessage:()=> "redacted"
  });
  const run=vm.runInContext(source+"\nenterApplication",ctx);
  await run(oldUser);
  if(scenario==="healthy"){
   assert.deepEqual(events,["reset","token","load","report","notify","subscribe"]);
   assert.equal(appScreen.style.display,"block");
  }else{
   assert(!events.includes("subscribe"),scenario);
   assert(!events.includes("show-error"),scenario);
   if(scenario==="stale-at-entry"){
    assert.deepEqual(events,[]);
    assert.equal(appScreen.style.display,"initial");
   }
   if(scenario==="switch-during-load")assert.deepEqual(events,
    ["reset","token","load"]);
   if(scenario==="switch-during-notifications"||
      scenario==="switch-and-throw")
    assert.equal(appScreen.style.display,"new_user_screen",
     "stale failure cannot hide a new account's screen");
  }
 }
});

test("company-code count calls are isolated from email Auth and never receive a finance bearer",async()=>{
 const start=html.indexOf("function partnerMainCountCall(");
 const end=html.indexOf("const partnerMainCountRead=",start);
 assert(start>0&&end>start);
 const code=html.slice(start,end);
 const payload={date:"2026-11-20"},calls=[];
 const ctx=vm.createContext({
  partnerMainCodeToken:TOKEN,auth:{currentUser:null,emailVerified:false},
  partnerMainCodeActive:()=>true,
  partnerMainCodeCountGet:()=>{},readPartnerWorkDay:()=>{}
 });
 const call=vm.runInContext(code+"\npartnerMainCountCall",ctx);
 const result=await call(async data=>{calls.push(["code",data]);return {data:{verified:true}};},
  async()=>{calls.push(["email"]);throw Error("email_mixed")},payload);
 assert.equal(result.data.verified,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],"code");
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{
  date:"2026-11-20",codeSessionToken:TOKEN});
 ctx.auth.currentUser={uid:"owner",emailVerified:true};
 ctx.partnerMainCodeActive=()=>false;
 assert.throws(()=>call(()=>{},()=>{},payload),/code_auth_mixed/);
 assert.throws(()=>call(()=>{},()=>{},{
  date:"2026-11-20",workspaceCompanyId:"foreign"}),/code_auth_mixed/);
 ctx.partnerMainCodeToken="";
 const sent=await call(()=>{throw Error("code_mixed")},data=>{
  calls.push(["email",data]);return {data:{normal:true}}},payload);
 assert.equal(sent.data.normal,true);
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))),["email",payload]);
});
test("same-page code workspace displays shared count dashboard only after server GET succeeds",async()=>{
 const start=html.indexOf("async function openSameAppCompanyCodeWorkspace(){");
 const end=html.indexOf("async function openSameAppPartnerWorkspace(",start);
 assert(start>0&&end>start);
 const body=html.slice(start,end);
 assert.doesNotMatch(body,/location\.(?:assign|replace)|startRealtimeListeners|loadUserData/);
 const calls=[],nodes=new Map();
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:"",textContent:"",hidden:false,disabled:false});
  return nodes.get(id);
 };
 const auth={currentUser:null};
 const appScreen={dataset:{},style:{display:"none"}};
 const authScreen={style:{display:"block"}},verificationScreen={style:{}},
  companySetupScreen={style:{}};
 const ctx=vm.createContext({
  auth,appScreen,authScreen,verificationScreen,companySetupScreen,
  currentUser:{uid:"stale"},currentUserData:{money:true},currentCompanyData:{money:true},
  userName:{textContent:""},userEmail:{textContent:""},
  userRole:{textContent:""},loginStatus:{textContent:""},databaseStatus:{textContent:""},
  partnerInlineData:null,partnerInlineWorkspaceCompany:"other",
  partnerInlineEditingStaffId:"old",pInline:node,
  partnerMainCodeActive:()=>true,partnerInlineIdentity:()=> "code-session-epoch:7",
  partnerMainDate:()=> "2026-11-20",
  stopRealtimeListeners:async()=>calls.push("stop_finance"),
  resetPartnerInline:()=>calls.push("reset_old_count"),
  mountPartnerCanonicalNavigation:()=>{calls.push("mount_original_cards");return true},
  mountPartnerSafeManagementMenu:()=>calls.push("mount_count_menu"),
  partnerSameAppSelectPanel:name=>calls.push("select_"+name),
  partnerInlineFetch:async()=>{
   calls.push("count_get");
   ctx.partnerInlineData={companyName:"協力店A",role:"owner"};
   return true;
  }
 });
 const open=vm.runInContext(body+"\nopenSameAppCompanyCodeWorkspace",ctx);
 assert.equal(await open(),true);
 assert.deepEqual(calls,["stop_finance","reset_old_count","mount_original_cards",
  "mount_count_menu","select_record","count_get"]);
 assert.equal(appScreen.dataset.partnerCountOnly,"true");
 assert.equal(appScreen.style.display,"block");
 assert.equal(authScreen.style.display,"none");
 assert.equal(ctx.currentUser,null);
 assert.equal(ctx.currentUserData,null);
 assert.equal(ctx.currentCompanyData,null);
 assert.equal(ctx.userEmail.textContent,"");
 assert.equal(ctx.loginStatus.textContent,"ログイン済み・協力店");
 assert.equal(node("partnerInlineWorkspace").hidden,false);
 assert.equal(node("pInlineReturnToOwnCompany").hidden,true);
});
test("company-code page uses count-only API for read, write and corrections with server-verified readback",()=>{
 const source=html.slice(html.indexOf("function partnerInlinePayload(data){"),
  html.indexOf("// Hub Owner-only partner count correction."));
 assert.match(source,/codeSessionToken:partnerMainCodeToken/);
 assert.match(source,/partnerMainCountRead\(/);
 assert.match(source,/partnerMainCountSubmit\(/);
 assert.match(source,/partnerMainCountManage\(/);
 assert.match(source,/partnerSavedCountReadbackState\(verified,expected\)/);
 assert.doesNotMatch(source,/\b(?:getFirestore|getDoc|setDoc|updateDoc|revenueGoals|pricingOptions)\b/);
 assert.match(html,/if\(partnerMainCodeActive\(\)\)\{\s*const token=partnerMainCodeToken;\s*partnerMainCodeForget\(\)/);
});

test("company-code Owner keeps same-app count member/team and archived catalog management",()=>{
 const start=html.indexOf("function partnerPublishedTabAllowed(name){");
 const end=html.indexOf("\nasync function refreshPartnerPublishedTabNavigation()",start);
 assert(start>=0&&end>start,"Owner publication selector exists");
 const source=html.slice(start,end);
 const codeOwner=vm.runInNewContext(source+"\npartnerPublishedTabAllowed",{
  partnerMainCodeActive:()=>true,
  NICO_PARTNER_TAB_UI_ENABLED:false,
  NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED:false
 });
 for(const name of ["record","teams","members","catalog","account"])
  assert.equal(codeOwner(name),true,"Verified count-only principal must retain "+name);
 assert.equal(codeOwner("invite"),false,
  "Email invitation must not use an unauthenticated company code");
 const emailOwner=vm.runInNewContext(source+"\npartnerPublishedTabAllowed",{
  partnerMainCodeActive:()=>false,
  NICO_PARTNER_TAB_UI_ENABLED:false
 });
 assert.equal(emailOwner("invite"),true,
  "Original verified email invitation workflow remains unchanged");
 const server=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
 assert.match(server,/if\(op==="addManaged"\)/);
 assert.match(server,/if\(op==="moveStaff"\)/);
 assert.match(server,/if\(op==="addPrivateProduct"\)/);
 assert.match(html,/partnerMainCountManage\(partnerInlinePayload\(\{action:"addManaged",name,teamId\}\)\)/);
 assert.match(html,/partnerMainCountManage\(partnerInlinePayload\(\{action:"moveStaff",staffId,teamId\}\)\)/);
 assert.match(html,/partnerUsesVerifiedOwnerCatalog\(snap\)/);
});
