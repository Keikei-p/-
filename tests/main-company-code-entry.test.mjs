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
 const location={origin:"https://nico-factory.web.app",replace(url){
  calls.push("reload");
  assert.equal(url,"https://nico-factory.web.app/",
   "must reload the same original app, never the separate partner page");
  assert.equal(auth.currentUser,null,"old Owner Auth must be gone before reload");
  assert.equal(values.get("nicoPartnerCodeSession"),TOKEN);
  if(navigationFails)throw Error("navigation_blocked");
 }};
 const sandbox=vm.createContext({auth,sessionStorage,URL,location,
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
 return {go,calls,auth,values,sandbox};
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
 assert.match(block,/location\.replace\(new URL\("\/",location\.origin\)\.href\)/);
 assert.doesNotMatch(block,/await openSameAppCompanyCodeWorkspace\(\)/);
 assert.match(html,/sessionStorage\.getItem\("nicoPartnerCodeSession"\)/);
 assert.match(html,/if\(await openSameAppCompanyCodeWorkspace\(\)\)return;/);
 assert.doesNotMatch(block,/location\.assign\(|\/partner-workspace\.html",location\.origin/);
 assert.match(html,/const partnerMainCodeCountGet=httpsCallable\(partnerAnonymousCodeFunctions/);
 assert.match(html,/const partnerMainCodeCountSave=httpsCallable\(partnerAnonymousCodeFunctions/);
 assert.doesNotMatch(block,/\b(?:setDoc|updateDoc|deleteDoc|getDoc|deleteUser|createUser|records|products|unitPrice|revenueGoals)\b/);
});
test("old email identity is signed out BEFORE code session is saved",async()=>{
 const a=subject();
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["preflight","probe","unprobe","ready","signout","store","reload"]);
 assert.equal(a.auth.currentUser,null);
});
test("code-only account reloads the SAME app without inheriting email Auth",async()=>{
 const a=subject({user:false});
 await a.go({sessionToken:TOKEN});
 assert.deepEqual(a.calls,["preflight","probe","unprobe","ready","store","reload"]);
});
test("blocked email logout cannot expose a new code session",async()=>{
 for(const options of [{logoutFails:true},{logoutRetains:true}]){
  const x=subject(options);
  await assert.rejects(x.go({sessionToken:TOKEN}));
  assert.equal(x.values.size,0);
  assert(!x.calls.includes("reload"));
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
 assert(!y.calls.includes("reload"));
 assert.equal(y.values.size,0);
});
test("same-origin reload refusal revokes the pending code token, never leaks Owner DOM",async()=>{
 const x=subject({navigationFails:true});
 await assert.rejects(x.go({sessionToken:TOKEN}),/company_code_navigation_failed/);
 assert.equal(x.values.size,0);
 assert.deepEqual(x.calls,["preflight","probe","unprobe","ready","signout","store","reload","remove"]);
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
 const b=html.indexOf("\n);\n\n\n// Preserve the already-published fresh-login policy",a);
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

test("stale save finalizer cannot unlock controls or clear a new account's pending operation",async()=>{
 const a=html.indexOf("async function partnerInlineRun(work){");
 const b=html.indexOf("\nfunction partnerInlinePayload(data){",a);
 assert(a>0&&b>a,"actual production save runner exists");
 const source=html.slice(a,b);
 assert.match(html,/function resetPartnerInline\(\)\{\s*\+\+partnerInlineSessionEpoch;/);
 for(const scenario of ["different-company","same-user-new-session","current-session"]){
  const ids=["pInlineDate","pInlineRecordDate","pInlineStaff","pInlineWorkingTeam",
   "pInlineWorkLocation","pInlineRefresh","pInlineZero","pInlineClear"];
  const nodes=new Map(ids.map(id=>[id,{disabled:false,value:id==="pInlineStaff"?"worker":""}]));
  const amountInput={disabled:false,value:"1"};
  nodes.set("pInlineCountFields",{querySelectorAll:()=>[amountInput]});
  nodes.set("pInlineSave",{disabled:false});
  nodes.set("pInlineSaveStatus",{textContent:"",dataset:{}});
  let company="a",rendered=0,notices=0;
  const ctx=vm.createContext({
   partnerInlineBusy:false,partnerInlineSessionEpoch:7,
   partnerInlineIdentity:()=>company,
   partnerInlineData:{staff:[{id:"worker",active:true}]},
   pInline:id=>nodes.get(id),
   partnerInlineStatus:()=>{++notices},
   partnerInlineRenderCounts:()=>{++rendered},
   renderPartnerPrivateProductCatalog:()=>{}
  });
  const run=vm.runInContext(source+"\npartnerInlineRun",ctx);
  let finish;
  const pending=new Promise(resolve=>{finish=resolve});
  const task=run(()=>pending,{kind:"save",refresh:false});
  assert.equal(ctx.partnerInlineBusy,true);
  assert(ids.every(id=>nodes.get(id).disabled===true));
  assert.equal(amountInput.disabled,true);
  if(scenario!=="current-session"){
   // Model resetPartnerInline and the next account's own save. The earlier
   // promise must not restore that account's DOM or mark its action idle.
   if(scenario==="different-company")company="b";
   else ctx.partnerInlineSessionEpoch++;
   ctx.partnerInlineBusy=true;
   ctx.partnerInlineData={staff:[{id:"new",active:true}]};
   for(const id of ids)nodes.get(id).disabled=true;
   amountInput.disabled=true;
   nodes.get("pInlineSave").disabled=true;
  }
  finish("saved");
  await task;
  if(scenario==="current-session"){
   assert.equal(ctx.partnerInlineBusy,false);
   assert(ids.every(id=>nodes.get(id).disabled===false));
   assert.equal(amountInput.disabled,false);
   assert.equal(notices,1);
   assert.equal(rendered,0);
   assert.equal(nodes.get("pInlineSaveStatus").dataset.result,"info");
  }else{
   assert.equal(ctx.partnerInlineBusy,true,scenario+" must not interrupt new save");
   assert(ids.every(id=>nodes.get(id).disabled===true),scenario+" must keep locks");
   assert.equal(amountInput.disabled,true);
   assert.equal(nodes.get("pInlineSave").disabled,true);
   assert.equal(notices,0,scenario+" must never render stale feedback");
   assert.equal(rendered,0);
  }
 }
});

test("code-auth bootstrap after hard reload only opens count-only page and never finance listeners",()=>{
 const a=html.indexOf("onAuthStateChanged(\n  auth,\n  async user => {");
 const b=html.indexOf("\n);\n\n\n// Preserve the already-published fresh-login policy",a);
 assert(a>0&&b>a);
 const code=html.slice(a,b);
 assert.match(code,/if\(partnerMainCodeActive\(\)\)\{\s*if\(nicoMainCodeLoginBusy\)return;\s*if\(await openSameAppCompanyCodeWorkspace\(\)\)return;/);
 const entry=html.slice(html.indexOf("async function openSameAppCompanyCodeWorkspace(){"),
  html.indexOf("async function openSameAppPartnerWorkspace("));
 assert.match(entry,/await stopRealtimeListeners\(\)/);
 assert.match(entry,/appScreen\.dataset\.partnerCountOnly="true"/);
 assert.match(entry,/const ready=await partnerInlineFetch\(\)/);
 assert.doesNotMatch(entry,/(?:startRealtimeListeners|loadUserData|getDocFromServer|getDocsFromServer)\(/);
});

test("partner-local ranking keeps unsent teams unranked while reported zero remains a valid rank",()=>{
 const begin=html.indexOf("function renderPartnerRankingOnlyPanel(){");
 const end=html.indexOf("\nlet partnerSameAppSelectedPanel=",begin);
 assert(begin>0&&end>begin,"actual partner count ranking function");
 const code=html.slice(begin,end);
 const teams=[{id:"t1",name:"第1班",active:true},
  {id:"t2",name:"第2班",active:true},
  {id:"t3",name:"第3班",active:true},
  {id:"t4",name:"第4班",active:false}];
 const base={role:"owner",companyName:"協力会社",teams,
  categories:["NURO","SBMNP"],enabledCategories:["NURO","SBMNP"],
  staff:[{id:"s1",name:"担当1"},{id:"s2",name:"担当2"},{id:"s3",name:"担当3"}]};
 function project(records,tab="team"){
  const actual=[],notes=[];
  const grid={replaceChildren(){actual.length=0;notes.length=0},
   classList:{add(){}},dataset:{}};
  const ctx=vm.createContext({
   partnerInlineData:{...base,records},
   partnerSameAppSelectedPanel:tab,
   NICO_SAME_APP_JOINT_HTTP_ENABLED:false,
   pInline:id=>{assert.equal(id,"pInlineRanking");return grid},
   appendVerifiedCountRankRow:(element,row)=>{assert.equal(element,grid);actual.push(row)},
   partnerMainAppendRow:(element,title,details)=>{
    assert.equal(element,grid);notes.push({title,details});
   }
  });
  vm.runInContext(code+"\nrenderPartnerRankingOnlyPanel()",ctx);
  return {actual:JSON.parse(JSON.stringify(actual)),notes};
 }
 let result=project([]);
 assert.deepEqual(result.actual,[],"no entries means no fabricated zero rank");
 assert.equal(result.notes[0].title,"未報告");
 assert.match(result.notes[0].details,/順位は付けません/);
 const records=[
  {staffId:"s1",teamIdSnapshot:"t1",totalCount:4,counts:{NURO:4,SBMNP:0}},
  {staffId:"s2",teamIdSnapshot:"t2",totalCount:4,counts:{NURO:3,SBMNP:1}},
  {staffId:"s3",teamIdSnapshot:"t3",totalCount:0,counts:{NURO:0,SBMNP:0}}
 ];
 result=project(records);
 assert.deepEqual(result.actual.map(r=>({name:r.name,count:r.count,rank:r.rank})),[
  {name:"協力会社・第1班",count:4,rank:1},
  {name:"協力会社・第2班",count:4,rank:1},
  {name:"協力会社・第3班",count:0,rank:3}
 ]);
 assert.deepEqual(result.notes,[{
  title:"協力会社・第4班（過去の班）",
  details:"未報告（順位なし）"
 }],"archived team with no report must not rank");
 result=project(records,"product");
 assert.deepEqual(result.actual.map(r=>r.name),["NURO","SBMNP"],
  "products are exactly those on the server-approved visible list");
 assert.deepEqual(result.notes,[]);
 assert.match(html,/合同ランキングは未公開です。現在の順位はこの協力店内の保存済み件数のみです。/);
 assert.match(html,/協力店内・件数のみ/);
});

test("company-code login reaches ONLY the verified joint-count ranking bridge after release gates",async()=>{
 const a=html.indexOf("async function tryLoadVerifiedSameAppJointCount({");
 const b=html.indexOf("\nasync function loadSharedDailyStandings(",a);
 assert(a>0&&b>a,"canonical joint count dispatch exists");
 const source=html.slice(a,b);
 assert.match(source,/createPublishedPartnerCodeCountBridge\(\{/);
 assert.match(source,/createPublishedPartnerCountBridge\(\{/);
 assert.match(source,/serverGuardVerified:NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED===true/);
 assert.match(source,/getCodeSessionToken:\(\)=>partnerMainCodeActive\(\)\?partnerMainCodeToken:""/);
 assert.match(source,/partnerInlineIdentity\(\)!==identity/);
 assert.match(source,/renderPublishedPartnerCountTab\(\{/);
 assert.match(source,/if\(NICO_SAME_APP_JOINT_HTTP_ENABLED!==true\)/);
 assert.doesNotMatch(source,/getPartnerWorkspace\(|sharedRankings:true|readPartnerWorkDay\(/);
 assert.match(html,/else void loadSharedDailyStandings\("partner"\);/);
 assert.match(html,/void loadSharedDailyStandings\("partnerDetail",true\)/);
 const {createPublishedPartnerCodeCountBridge}=await import(
  "../ranking/published-partner-tab-client.mjs");
 let sent=0,session="A".repeat(43);
 const args={
  featureEnabled:true,serverGuardVerified:true,
  getCodeSessionToken:()=>session,
  fetcher:async(url,req)=>{
   sent++;
   assert.match(url,/getVerifiedJointCountRanking\?day=2026-11-20&tab=individual$/);
   assert.equal(req.headers.Authorization,"Bearer "+"A".repeat(43));
   assert.equal(req.method,"GET");
   assert.equal(req.credentials,"omit");
   return {status:403,headers:{get:()=> "application/json"},
    text:async()=>JSON.stringify({error:"request_blocked"})};
  }
 };
 const candidate=createPublishedPartnerCodeCountBridge(args);
 await assert.rejects(candidate.load({tab:"individual",day:"2026-11-20"}),
  /PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
 assert.equal(sent,1,"a denied server request must not fall back to a local or finance rank");
 assert.throws(()=>createPublishedPartnerCodeCountBridge({
  ...args,serverGuardVerified:false
 }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
 assert.throws(()=>createPublishedPartnerCodeCountBridge({
  ...args,featureEnabled:false
 }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
 assert.equal(sent,1,"disabled flags never send a request");
});
