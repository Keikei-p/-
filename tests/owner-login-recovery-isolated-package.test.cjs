"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const pkg=JSON.parse(read("functions-owner-login-recovery/package.json"));
const config=JSON.parse(read("firebase.owner-login-recovery.json"));
const entry=read("functions-owner-login-recovery/index.js");
const source=read("functions-owner-login-recovery/service.cjs");
const trusted=read("functions-owner-login-recovery/verified-hub-owner.cjs");
test("release package contains exact reviewed staging login recovery logic and Auth verifier",()=>{
 assert.equal(source,read("staging/owner-login-recovery-v1/service.cjs"));
 assert.equal(trusted,read("staging/owner-delegation-v1/verified-hub-owner.cjs"));
 const expected=read("staging/owner-login-recovery-v1/entry.cjs")
  .replace('require("../owner-delegation-v1/verified-hub-owner.cjs")',
   'require("./verified-hub-owner.cjs")')
  .replace("STAGING ONLY — NO DEPLOY. Both Functions disabled unless EXPLICIT flags.",
   "ISOLATED RELEASE CANDIDATE — DEFAULT OFF. Both Functions disabled unless EXPLICIT flags.");
 assert.equal(entry,expected);
});
test("package uses isolated codebase and pinned Node 22 compatible dependencies only",()=>{
 assert.deepEqual(config,{
  functions:{source:"functions-owner-login-recovery",codebase:"owner-login-recovery",
   ignore:["node_modules",".git","firebase-debug.log"]}
 });
 assert.equal(pkg.private,true);
 assert.equal(pkg.main,"index.js");
 assert.equal(pkg.engines.node,"22");
 assert.deepEqual(pkg.dependencies,{
  "firebase-admin":"14.4.0","firebase-functions":"7.4.0"
 });
 assert.deepEqual(Object.keys(pkg.dependencies).length,2);
});
function loaded(env={}){
 const exports={};
 const flags=[];
 const mocks={
  "firebase-admin/app":{initializeApp:()=>{}},
  "firebase-admin/auth":{getAuth:()=>({})},
  "firebase-admin/firestore":{getFirestore:()=>({}),
   FieldValue:{serverTimestamp:()=>null}},
  "firebase-functions/v2/https":{HttpsError:class extends Error{},
   onCall:(config,handler)=>({config,handler})},
  "./verified-hub-owner.cjs":{
   makeExplicitHubOwnerVerifier:({enabled})=>{
    flags.push({name:"identity",enabled});return ()=>({kind:"hub"})}
  },
  "./service.cjs":{
   makeOwnerLoginRecovery:({enabledRead,enabledWrite,verifyHubOwner})=>{
    assert.equal(typeof verifyHubOwner,"function");
    flags.push({name:"read",enabled:enabledRead});
    flags.push({name:"write",enabled:enabledWrite});
    return {list:()=>{},reactivate:()=>{}}
   }
  }
 };
 const sandbox={exports,process:{env},require:k=>{
  if(!Object.hasOwn(mocks,k))throw Error("UNREVIEWED_IMPORT_"+k);
  return mocks[k];
 }};
 vm.runInNewContext(entry,sandbox,{timeout:2000});
 return {flags,exports};
}
test("OFF by default; WRITE cannot become active without independent READ enablement",()=>{
 for(const env of [
  {},{OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"enabled"},
  {OWNER_LOGIN_RECOVERY_READ_ENABLED:"true",
   OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"enabled"},
  {OWNER_LOGIN_RECOVERY_READ_ENABLED:"enabled",
   OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"true"}
 ]){
  const r=loaded(env);
  assert.equal(r.flags[2].enabled(),false);
  assert.equal(r.flags[1].enabled(),env.OWNER_LOGIN_RECOVERY_READ_ENABLED==="enabled");
 }
 const read=loaded({OWNER_LOGIN_RECOVERY_READ_ENABLED:"enabled"});
 assert.equal(read.flags[1].enabled(),true);
 assert.equal(read.flags[2].enabled(),false);
 const full=loaded({OWNER_LOGIN_RECOVERY_READ_ENABLED:"enabled",
  OWNER_LOGIN_RECOVERY_WRITE_ENABLED:"enabled"});
 assert.equal(full.flags[1].enabled(),true);
 assert.equal(full.flags[2].enabled(),true);
});
test("exact two callable exports; Tokyo, cold, bounded and first party Hosting CORS only",()=>{
 const r=loaded();
 assert.deepEqual(Object.keys(r.exports).sort(),
  ["listOwnerLoginRecovery","reactivateOwnerLoginMember"]);
 for(const x of Object.values(r.exports)){
  assert.equal(x.config.region,"asia-northeast1");
  assert.equal(x.config.minInstances,0);
  assert.equal(x.config.maxInstances,2);
  assert.deepEqual([...x.config.cors],["https://nico-factory.web.app"]);
 }
});
test("new isolated package cannot alter legacy Functions, finance originals or secret configurations",()=>{
 assert.doesNotMatch(entry,/functions-partner-workspace|functions-ranking-approvals|functions\/index|firebase deploy|admin\.auth\(\)\.updateUser/);
 assert.doesNotMatch(source,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries|partnerWorkCountDays)"\)/);
 assert.doesNotMatch(source,/\b(?:updateUser|deleteUser|createUser|setCustomUserClaims|deleteDoc|firebase deploy)\s*\(/);
 assert.match(entry,/OWNER_LOGIN_RECOVERY_READ_ENABLED==="enabled"/);
 assert.match(entry,/OWNER_LOGIN_RECOVERY_WRITE_ENABLED==="enabled"/);
 assert.match(trusted,/ownerGrant:"primary"/);
});
