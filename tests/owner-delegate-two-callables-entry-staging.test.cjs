"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const entry=fs.readFileSync(path.resolve(__dirname,"../staging/owner-delegation-v1/entry.cjs"),"utf8");
function compile(env={}){
 const calls={initialized:0,authFactory:0,serviceFactory:0,authFlags:[],serviceFlags:[]};
 const list=()=>({kind:"readonly-list"});
 const change=()=>({kind:"primary-only-audited-update"});
 const onCall=(opts,handler)=>({opts,handler});
 const HttpsError=class extends Error{};
 const mocks={
  "firebase-admin/app":{initializeApp:()=>{calls.initialized++}},
  "firebase-admin/auth":{getAuth:()=>({})},
  "firebase-admin/firestore":{getFirestore:()=>({}),FieldValue:{serverTimestamp:()=>0}},
  "firebase-functions/v2/https":{onCall,HttpsError},
  "./verified-hub-owner.cjs":{makeExplicitHubOwnerVerifier:({enabled})=>{
   calls.authFactory++;
   calls.authFlags.push(enabled);
   return ()=>({kind:"hub",ownerGrant:"primary"});
  }},
  "./owner-approval-service.cjs":{makeOwnerDelegateApproval:({enabled,verifyHubOwner})=>{
   calls.serviceFactory++;
   assert.equal(enabled,calls.authFlags.at(-1));
   calls.serviceFlags.push(enabled);
   assert.equal(typeof verifyHubOwner,"function");
   return {list,change};
  }}
 };
 const exports={};
 const sandbox={
  exports,process:{env},
  require:key=>{
   if(!Object.hasOwn(mocks,key))throw Error("UNEXPECTED_IMPORT: "+key);
   return mocks[key];
  }
 };
 vm.runInNewContext(entry,sandbox,{filename:"entry.cjs",timeout:1500});
 return {calls,exports,expect:{list,change}};
}
test("exports exactly two isolated Tokyo v2 callables, both cold and restricted to main web app",()=>{
 const {calls,exports,expect}=compile();
 assert.equal(calls.initialized,1);
 assert.equal(calls.authFactory,2);
 assert.equal(calls.serviceFactory,2);
 assert.deepEqual(Object.keys(exports).sort(),
  ["changeHubOwnerDelegate","listHubOwnerDelegates"]);
 assert.equal(exports.listHubOwnerDelegates.handler,expect.list);
 assert.equal(exports.changeHubOwnerDelegate.handler,expect.change);
 for(const item of Object.values(exports)){
  assert.equal(item.opts.region,"asia-northeast1");
  assert.equal(item.opts.minInstances,0);
  assert.equal(item.opts.maxInstances,2);
  assert.deepEqual([...item.opts.cors],["https://nico-factory.web.app"]);
 }
});
test("read-only can be enabled separately; write requires BOTH strict enabled flags",()=>{
 for(const env of [{},{HUB_OWNER_DELEGATE_LIST_ENABLED:"true"},
  {HUB_OWNER_DELEGATE_CHANGE_ENABLED:"enabled"},
  {HUB_OWNER_DELEGATE_LIST_ENABLED:"1",HUB_OWNER_DELEGATE_CHANGE_ENABLED:"enabled"},
  {HUB_OWNER_DELEGATE_LIST_ENABLED:"enabled",HUB_OWNER_DELEGATE_CHANGE_ENABLED:"true"}]){
  const result=compile(env);
  const expectedRead=env.HUB_OWNER_DELEGATE_LIST_ENABLED==="enabled";
  assert.equal(result.calls.serviceFlags[0](),expectedRead);
  assert.equal(result.calls.serviceFlags[1](),false);
 }
 const read=compile({HUB_OWNER_DELEGATE_LIST_ENABLED:"enabled"});
 assert.equal(read.calls.serviceFlags[0](),true);
 assert.equal(read.calls.serviceFlags[1](),false);
 const both=compile({
  HUB_OWNER_DELEGATE_LIST_ENABLED:"enabled",
  HUB_OWNER_DELEGATE_CHANGE_ENABLED:"enabled"
 });
 assert.equal(both.calls.serviceFlags[0](),true);
 assert.equal(both.calls.serviceFlags[1](),true);
});
test("isolated source never touches original service, sales originals, rules or deploy entry",()=>{
 assert.doesNotMatch(entry,/functions-partner-workspace|functions\/index|firebase deploy|setCustomUserClaims|createUser|runTransaction/);
 assert.doesNotMatch(entry,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
 assert.match(entry,/STAGING ONLY — NO DEPLOY/);
 assert.match(entry,/makeExplicitHubOwnerVerifier/);
 assert.match(entry,/makeOwnerDelegateApproval/);
 assert.match(entry,/HUB_OWNER_DELEGATE_LIST_ENABLED==="enabled"/);
 assert.match(entry,/HUB_OWNER_DELEGATE_CHANGE_ENABLED==="enabled"/);
});
