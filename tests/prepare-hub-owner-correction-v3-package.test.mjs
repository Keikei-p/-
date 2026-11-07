import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync,existsSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import vm from "node:vm";
import {execFileSync} from "node:child_process";
import {
 REVIEWED,gitBlob,makeOwnerPackage,writeDisposablePackage
} from "../tools/production/prepare-hub-owner-correction-v3-package.mjs";

const root=path.resolve(new URL("../",import.meta.url).pathname);
const sources=()=>Object.fromEntries(Object.keys(REVIEWED).map(name=>
 [name,readFileSync(path.join(root,name),"utf8")]
));
const frozen=Object.keys(REVIEWED);
const approved=()=>makeOwnerPackage(sources());

test("source-freeze preserves financial records, 8 existing exports, old UI, and Rules",()=>{
 const all=sources();
 assert.deepEqual(Object.keys(all).sort(),frozen.slice().sort());
 for(const [name,digest] of Object.entries(REVIEWED))
  assert.equal(gitBlob(all[name]),digest,name);
 const prepared=makeOwnerPackage(all);
 assert.equal(prepared.report.deployed,false);
 assert.equal(prepared.report.financeBoundaryVerified,false);
 assert.equal(prepared.report.stagingSecurityGateDefaultDisabled,true);
 assert.deepEqual(prepared.report.exports,[
  "listHubPartnerCounts","correctHubPartnerCounts"
 ]);
 assert.equal(prepared.report.separateFromOriginalFunctions,true);
 assert.equal(prepared.bundle["functions-hub-owner-correction/service.cjs"].includes(
  'require("./sb-category-v2.cjs")'),true);
 assert.equal(prepared.bundle["functions-hub-owner-correction/service.cjs"].includes(
  'require("../partner-sb-v2/sb-category-v2.cjs")'),false);
 assert.equal(Object.keys(prepared.bundle).length,6);
 assert.equal(JSON.parse(prepared.bundle["firebase.owner-correction.json"]).functions.codebase,
  "hub-owner-correction-v3");
 assert.equal(JSON.parse(prepared.bundle["functions-hub-owner-correction/package.json"]).engines.node,"22");
 for(const value of Object.values(prepared.bundle))
  assert.doesNotMatch(value,/firebase deploy|firestore:delete|functions:delete/);
});

test("any changed financial baseline, auth, helper, entry, config or sales source fails closed",()=>{
 const all=sources();
 for(const name of Object.keys(all)){
  const changed={...all,[name]:all[name]+"\n"};
  assert.throws(()=>makeOwnerPackage(changed),
   /STOP_OWNER_V3_PACKAGE_SOURCE_CHANGED/,name);
 }
 assert.throws(()=>makeOwnerPackage({}),/STOP_OWNER_V3_PACKAGE_SOURCE_CHANGED/);
 assert.throws(()=>makeOwnerPackage([]),/STOP_OWNER_V3_PACKAGE_SOURCE_SHAPE/);
});

test("isolated package has exactly two callable handlers and starts disabled",()=>{
 const bundle=approved().bundle;
 const entry=bundle["functions-hub-owner-correction/index.js"];
 const fake={};
 let initialized=0,checker=null;
 const fakeRequire=name=>{
  switch(name){
   case "firebase-admin/app":return {initializeApp(){initialized++}};
   case "firebase-admin/auth":return {getAuth:()=>({})};
   case "firebase-admin/firestore":return {
    getFirestore:()=>({}),FieldValue:{serverTimestamp:()=>0}
   };
   case "firebase-functions/v2/https":return {
    HttpsError:class extends Error{},
    onCall:(opts,handler)=>({opts,handler})
   };
   case "./trusted-auth.cjs":return {
    makeAuthenticatedOwnerCorrectionV3:args=>{
     checker=args.enabled;
     return {list:()=>1,correct:()=>2}
    }
   };
   default:throw Error("UNREVIEWED_DEPENDENCY "+name);
  }
 };
 const env={};
 vm.runInNewContext(entry,{exports:fake,require:fakeRequire,process:{env}});
 assert.equal(initialized,1);
 assert.deepEqual(Object.keys(fake).sort(),[
  "correctHubPartnerCounts","listHubPartnerCounts"
 ].sort());
 assert.equal(checker(),false);
 env.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED="enabled";
 assert.equal(checker(),true);
 const opts=fake.listHubPartnerCounts.opts;
 assert.equal(opts.region,"asia-northeast1");
 assert.equal(opts.maxInstances,2);
 assert.equal(opts.minInstances,0);
 assert.deepEqual(Array.from(opts.cors),["https://nico-factory.web.app"]);
 assert.equal(fake.correctHubPartnerCounts.opts,opts);
});

test("isolated output can load both existing CJS modules with no workspace app",()=>{
 const temp=mkdtempSync(path.join(tmpdir(),"nico-owner-ck-"));
 const old={RUNNER_TEMP:process.env.RUNNER_TEMP,
  GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,
  GITHUB_REPOSITORY:process.env.GITHUB_REPOSITORY};
 const restore=()=>{for(const [k,v] of Object.entries(old)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }};
 try{
  process.env.RUNNER_TEMP=temp;
  process.env.GITHUB_ACTIONS="true";
  process.env.GITHUB_REPOSITORY="Keikei-p/-";
  const dest=path.join(temp,"nico-reviewed-owner-correction-v3-package");
  assert.equal(existsSync(dest),false);
  assert.equal(writeDisposablePackage(approved(),dest).length,6);
  assert.equal(readdirSync(dest).length,2);
  assert.equal(readdirSync(path.join(dest,"functions-hub-owner-correction")).length,5);
  assert.throws(()=>writeDisposablePackage(approved(),dest),
   /STOP_OWNER_V3_PACKAGE_DESTINATION/);
  for(const name of ["index.js","service.cjs","trusted-auth.cjs","sb-category-v2.cjs"])
   execFileSync(process.execPath,["--check",path.join(dest,"functions-hub-owner-correction",name)],
    {stdio:"pipe"});
  const verify=execFileSync(process.execPath,[
   "-e",
   "const a=require(process.argv[1]);const b=require(process.argv[2]);"+
   "if(typeof a.makeAuthenticatedOwnerCorrectionV3!=='function'||"+
   "typeof b.breakdown!=='function')process.exit(1);",
   path.join(dest,"functions-hub-owner-correction/trusted-auth.cjs"),
   path.join(dest,"functions-hub-owner-correction/sb-category-v2.cjs")
  ],{stdio:"pipe"});
  assert.equal(verify.length,0);
  assert.throws(()=>writeDisposablePackage(approved(),path.join(temp,"wrong")),
   /STOP_OWNER_V3_PACKAGE_DESTINATION/);
 }finally{restore();rmSync(temp,{recursive:true,force:true})}
});

test("no runner context, wrong repo or denied package path cannot write files",()=>{
 const temp=mkdtempSync(path.join(tmpdir(),"nico-owner-deny-"));
 const old={RUNNER_TEMP:process.env.RUNNER_TEMP,
  GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,
  GITHUB_REPOSITORY:process.env.GITHUB_REPOSITORY};
 const restore=()=>{for(const [k,v] of Object.entries(old)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }};
 try{
  process.env.RUNNER_TEMP=temp;
  process.env.GITHUB_ACTIONS="false";
  process.env.GITHUB_REPOSITORY="Keikei-p/-";
  const dest=path.join(temp,"nico-reviewed-owner-correction-v3-package");
  assert.throws(()=>writeDisposablePackage(approved(),dest),
   /STOP_OWNER_V3_PACKAGE_RUNNER_ONLY/);
  process.env.GITHUB_ACTIONS="true";
  process.env.GITHUB_REPOSITORY="attacker/repo";
  assert.throws(()=>writeDisposablePackage(approved(),dest),
   /STOP_OWNER_V3_PACKAGE_RUNNER_ONLY/);
  assert.equal(existsSync(dest),false);
 }finally{restore();rmSync(temp,{recursive:true,force:true})}
});
