"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../staging/owner-login-recovery-v1");
const html=fs.readFileSync(path.join(root,"owner-login-recovery.html"),"utf8");
const entry=fs.readFileSync(path.join(root,"entry.cjs"),"utf8");
const scripts=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,1);
const js=scripts[0][1].replace(/^import\s*\{[\s\S]*?\}\s*from\s*"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+";/gm,"");
function parsed(){
 const el=new Map();
 const n=()=>({textContent:"",className:"",hidden:false,disabled:false,
  children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},
  querySelectorAll(){return []}});
 const get=id=>{if(!el.has(id))el.set(id,n());return el.get(id)};
 const sandbox={
  initializeApp:()=>({}),getAuth:()=>({currentUser:null}),getFunctions:()=>({}),
  onAuthStateChanged:()=>{},
  httpsCallable:()=>async()=>{throw Error("unavailable")},
  document:{getElementById:get,createElement:n},console
 };
 vm.runInNewContext(js+
  "\n;globalThis.__test={parseList,parseResult};",sandbox,{timeout:2500});
 return sandbox.__test;
}
const person={uid:"staff_42",displayName:"スタッフ",
 maskedEmail:"s***@example.invalid",userVersion:11,memberVersion:13,
 recoveryReadyForOwnerReview:true};
const list={kind:"owner-reviewed-internal-login-recovery",
 candidates:[person],excludedForSafety:1,requiresExplicitOwnerDecision:true,
 writeEnabled:false,financeRead:false,historyChanged:false};
test("mobile UI validates exact privacy preserving list shape and monotonic versions",()=>{
 const r=parsed().parseList(list);
 assert.equal(r.canWrite,false);assert.equal(r.candidates[0].uid,person.uid);
 assert(Object.isFrozen(r.candidates[0]));
 for(const invalid of [
  {...list,financeRead:true},{...list,writeEnabled:"true"},
  {...list,historyChanged:true},{...list,extraPrice:30000},
  {...list,candidates:[{...person,price:5000}]},
  {...list,candidates:[{...person,uid:""}]},
  {...list,candidates:[{...person,userVersion:-1}]},
  {...list,candidates:[{...person,recoveryReadyForOwnerReview:false}]},
  {...list,candidates:[person,person]}
 ])assert.throws(()=>parsed().parseList(invalid),/UNREVIEWED_RECOVERY_RESPONSE/);
});
test("recovery acknowledgment cannot claim restored state if any result field unverified",()=>{
 const ok={restored:true,uid:person.uid,userActive:true,memberActive:true,
  authAccountUnchanged:true,financialOriginalsUnchanged:true,historyRetained:true};
 assert.equal(parsed().parseResult(ok,person.uid),true);
 for(const bad of [
  {...ok,uid:"wrong_account"},{...ok,authAccountUnchanged:false},
  {...ok,financialOriginalsUnchanged:false},{...ok,memberActive:false},
  {...ok,sales:5000},{...ok,historyRetained:false}
 ])assert.throws(()=>parsed().parseResult(bad,person.uid),/UNREVIEWED_RECOVERY_RESPONSE/);
});
test("UI requires explicit typed email, selected reason, native confirm and no auto retry",()=>{
 assert.match(html,/emailConfirmation:input/);
 assert.match(html,/OWNER_CONFIRMS_PERSON_AND_REASON/);
 assert.match(html,/window\.confirm\(/);
 assert.match(html,/await reload\(\)/);
 assert.match(html,/listOwnerLoginRecovery/);
 assert.match(html,/reactivateOwnerLoginMember/);
 assert.match(html,/!state\?\.canWrite/);
 assert.doesNotMatch(html,/\b(?:signInWith|setDoc|updateDoc|deleteDoc|runTransaction|createUserWithEmailAndPassword|eval)\s*\(/);
 assert.doesNotMatch(html,/\b(?:localStorage|sessionStorage|firebase deploy)\b/);
});
function compile(env={}){
 const called={init:0,auth:0,service:0,enabled:[],options:[]};
 const h={list:()=>{},reactivate:()=>{}};
 const sandbox={exports:{},process:{env},
  require:name=>{
   if(name==="firebase-admin/app")return{initializeApp:()=>called.init++};
   if(name==="firebase-admin/auth")return{getAuth:()=>({})};
   if(name==="firebase-admin/firestore")return{
    getFirestore:()=>({}),FieldValue:{serverTimestamp:()=>null}};
   if(name==="firebase-functions/v2/https")return{
    onCall:(opts,handler)=>{called.options.push(opts);return{opts,handler}},
    HttpsError:class extends Error{}
   };
   if(name==="../owner-delegation-v1/verified-hub-owner.cjs")return{
    makeExplicitHubOwnerVerifier:({enabled})=>{
     called.auth++;called.enabled.push(enabled);return ()=>({});
    }
   };
   if(name==="./service.cjs")return{makeOwnerLoginRecovery:({enabledRead,enabledWrite,verifyHubOwner})=>{
    called.service++;assert.equal(typeof verifyHubOwner,"function");
    called.enabled.push(enabledRead,enabledWrite);
    return h;
   }};
   throw Error("UNKNOWN_ENTRY_DEPENDENCY_"+name);
  }
 };
 vm.runInNewContext(entry,sandbox,{timeout:1500});
 return {called,exports:sandbox.exports,h};
}
test("isolated entry default disables READ and WRITE, strict flags gate WRITE",()=>{
 for(const env of [
  {},{OWNER_LOGIN_RECOVERY_READ_ENABLED:"true"},
  {OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"enabled"},
  {OWNER_LOGIN_RECOVERY_READ_ENABLED:"enabled",OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"true"}
 ]){
  const x=compile(env);
  assert.equal(x.called.init,1);
  assert.equal(x.called.auth,1);
  assert.equal(x.called.service,1);
  assert.equal(x.called.enabled[2](),false);
 }
 const read=compile({OWNER_LOGIN_RECOVERY_READ_ENABLED:"enabled"});
 assert.equal(read.called.enabled[1](),true);
 assert.equal(read.called.enabled[2](),false);
 const full=compile({OWNER_LOGIN_RECOVERY_READ_ENABLED:"enabled",
  OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"enabled"});
 assert.equal(full.called.enabled[1](),true);
 assert.equal(full.called.enabled[2](),true);
 assert.deepEqual(Object.keys(full.exports).sort(),
  ["listOwnerLoginRecovery","reactivateOwnerLoginMember"]);
 for(const option of full.called.options){
  assert.equal(option.region,"asia-northeast1");
  assert.equal(option.minInstances,0);
  assert.equal(option.maxInstances,2);
  assert.deepEqual([...option.cors],["https://nico-factory.web.app"]);
 }
});
test("entry imports no existing production Index or finance original, deploy remains separate",()=>{
 assert.match(entry,/STAGING ONLY — NO DEPLOY/);
 assert.doesNotMatch(entry,/functions-partner-workspace|functions\/index|firebase deploy|deleteUser\(|updateUser\(/);
 assert.match(entry,/OWNER_LOGIN_RECOVERY_WRITE_ENABLED==="enabled"/);
});
