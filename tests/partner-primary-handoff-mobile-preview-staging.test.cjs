"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {spawnSync}=require("node:child_process");
const vm=require("node:vm");
const path=require("node:path");
const html=readFileSync(path.join(__dirname,
 "../staging/partner-primary-handoff/mobile-preview.html"),"utf8");
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
function harness({origin="https://nico-factory.web.app",replyMode="ok"}={}){
 const dom=new Map(),calls=[];
 const element=id=>{
  if(!dom.has(id))dom.set(id,{
   id,value:"",checked:false,disabled:false,hidden:false,textContent:"",
   listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},
   dispatch(name,payload={preventDefault(){}}){
    return this.listeners[name]?.(payload);
   }
  });
  return dom.get(id);
 };
 const location={origin,href:origin+"/partner-handoff.html?workspaceCompanyId=partner"};
 const auth={currentUser:null},app={};
 let observer=()=>{};
 const user={uid:"uid",email:"uid@example.test",emailVerified:true,
  getIdToken:async force=>{assert.equal(force,true);return "test-token";}};
 const fake={
  URL,
  location,
  document:{getElementById:element},
  initializeApp(_config,name){assert.equal(name,"nico-partner-handoff-staging-isolated");return app;},
  browserSessionPersistence:{},
  initializeAuth(){return auth;},
  getFunctions(){return {}},
  httpsCallable(_functions,name){
   return async data=>{
    calls.push({name,data});
    if(replyMode==="fail")throw Error("function-unavailable");
    if(name==="previewPartnerPrimaryHandoff")
     return {data:{eligible:true,sourceHistoryPreserved:true,needsExplicitConsent:true}};
    if(name==="commitPartnerPrimaryHandoff")
     return {data:{transferred:true,historyArchived:true}};
    throw Error("unknown");
   };
  },
  onAuthStateChanged(_auth,fn){observer=fn;fn(auth.currentUser);},
  signInWithEmailAndPassword:async()=>{auth.currentUser=user;observer(user);return {user};},
  signOut:async()=>{auth.currentUser=null;observer(null);},
  confirm:()=>true
 };
 const executable=source.replace(/^import .*?;\s*$/gm,"");
 vm.runInNewContext(executable,fake,{timeout:1000});
 const login=async()=>{
  element("email").value="uid@example.test";
  element("pass").value="password";
  await element("loginForm").dispatch("submit");
 };
 const replaceUser=next=>{auth.currentUser=next;observer(next)};
 return {element,calls,auth,login,replaceUser,user};
}
test("static staged page has no direct Firestore, no amount fields, no persistence or automatic join",()=>{
 assert.match(html,/<meta name="viewport"/);
 assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/);
 assert.match(html,/本人確認/);
 assert.match(html,/移行先の確認/);
 assert.match(html,/以前の自社所属を終了/);
 assert.match(source,/browserSessionPersistence/);
 assert.match(source,/location\.origin!==ONLY_ORIGIN/);
 assert.match(source,/getIdToken\(true\)/);
 assert.match(source,/httpsCallable\(functions,"previewPartnerPrimaryHandoff"/);
 assert.match(source,/httpsCallable\(functions,"commitPartnerPrimaryHandoff"/);
 assert.match(source,/confirm\("自社の現役所属を終了/);
 assert.doesNotMatch(source,/firebase-firestore\.js|getFirestore\(|\bwriteBatch\(|\bsetDoc\(|\bdeleteDoc\(/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|console\.log|window\.open/);
 const check=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:source,encoding:"utf8",timeout:10000
 });
 assert.equal(check.status,0,check.stderr);
});
test("preview alone makes no migration; explicit checkbox and confirmation required",async()=>{
 const h=harness();
 assert.equal(h.element("preview").disabled,true);
 assert.equal(h.element("commit").disabled,true);
 await h.login();
 assert.equal(h.element("pass").value,"");
 assert.equal(h.element("preview").disabled,false);
 await h.element("preview").onclick();
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].name,"previewPartnerPrimaryHandoff");
 assert.equal(h.element("commit").disabled,true);
 assert.equal(h.element("consent").disabled,false);
 h.element("consent").checked=true;
 h.element("consent").dispatch("change");
 assert.equal(h.element("commit").disabled,false);
 await h.element("commit").onclick();
 assert.equal(h.calls.length,2);
 assert.equal(h.calls[1].name,"commitPartnerPrimaryHandoff");
 assert.equal(h.calls[1].data.workspaceCompanyId,"partner");
 assert.equal(h.calls[1].data.consent,"MOVE_MY_PRIMARY_LOGIN_TO_PARTNER_KEEP_OLD_SALES_HISTORY");
 assert.equal(h.element("commit").disabled,true);
 assert.equal(h.element("consent").checked,false);
 assert.match(h.element("status").textContent,/件数の閲覧・入力を確認/);
});
test("changing company or account invalidates any previously approved preview and prevents transfer",async()=>{
 const h=harness();
 await h.login();
 await h.element("preview").onclick();
 h.element("workspace").value="anotherPartner";
 h.element("workspace").dispatch("input");
 h.element("consent").checked=true;
 h.element("consent").dispatch("change");
 assert.equal(h.element("commit").disabled,true);
 await h.element("commit").onclick();
 assert.equal(h.calls.filter(x=>x.name==="commitPartnerPrimaryHandoff").length,0);
 await h.element("preview").onclick();
 h.replaceUser(null);
 assert.equal(h.element("commit").disabled,true);
});
test("missing backend fails closed and never sends a transfer request",async()=>{
 const h=harness({replyMode:"fail"});
 await h.login();
 await h.element("preview").onclick();
 assert.equal(h.element("commit").disabled,true);
 assert.equal(h.element("consent").disabled,true);
 assert.equal(h.calls.filter(x=>x.name==="commitPartnerPrimaryHandoff").length,0);
 assert.match(h.element("status").textContent,/何も変更していません/);
});
test("non-production origin refuses login and no preview/commit requests are made",async()=>{
 const h=harness({origin:"https://example.test"});
 await h.login();
 assert.equal(h.auth.currentUser,null);
 assert.equal(h.calls.length,0);
 assert.equal(h.element("commit").disabled,true);
});
