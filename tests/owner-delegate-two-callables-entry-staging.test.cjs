"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const entry=fs.readFileSync(path.resolve(__dirname,"../staging/owner-delegation-v1/entry.cjs"),"utf8");
function compile(env={}){
 const calls={initialized:0,authFactory:0,serviceFactory:0,enabled:null};
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
   calls.enabled=enabled;
   return ()=>({kind:"hub",ownerGrant:"primary"});
  }},
  "./owner-approval-service.cjs":{makeOwnerDelegateApproval:({enabled,verifyHubOwner})=>{
   calls.serviceFactory++;
   assert.equal(enabled,calls.enabled);
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
 assert.equal(calls.authFactory,1);
 assert.equal(calls.serviceFactory,1);
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
test("feature flag is default OFF, no implicit prod enablement or permissive truthy flags",()=>{
 for(const env of [{},{HUB_OWNER_DELEGATION_V1_ENABLED:"true"},
  {HUB_OWNER_DELEGATION_V1_ENABLED:"disabled"},
  {HUB_OWNER_DELEGATION_V1_ENABLED:"1"}]){
  const result=compile(env);
  assert.equal(result.calls.enabled(),false);
 }
 assert.equal(compile({HUB_OWNER_DELEGATION_V1_ENABLED:"enabled"}).calls.enabled(),true);
});
test("isolated source never touches original service, sales originals, rules or deploy entry",()=>{
 assert.doesNotMatch(entry,/functions-partner-workspace|functions\/index|firebase deploy|setCustomUserClaims|createUser|runTransaction/);
 assert.doesNotMatch(entry,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
 assert.match(entry,/STAGING ONLY — NO DEPLOY/);
 assert.match(entry,/makeExplicitHubOwnerVerifier/);
 assert.match(entry,/makeOwnerDelegateApproval/);
 assert.match(entry,/HUB_OWNER_DELEGATION_V1_ENABLED==="enabled"/);
});
