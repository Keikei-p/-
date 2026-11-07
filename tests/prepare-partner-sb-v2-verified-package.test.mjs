import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync,readdirSync,rmSync,mkdtempSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {REVIEWED_BLOBS,gitBlob,verifySource,makePackage,writeDisposablePackage}
 from "../tools/production/prepare-partner-sb-v2-verified-package.mjs";
import {TARGETS,ensureExactOnly}
 from "../tools/production/partner-four-function-release-scope.mjs";

const root=path.resolve(import.meta.dirname,"..");
const sources=Object.fromEntries(Object.keys(REVIEWED_BLOBS).map(k=>[
 k,readFileSync(path.join(root,k),"utf8")
]));
const staged=()=>makePackage(sources);
test("every 12 reviewer-approved original and staged blob exactly matches main",()=>{
 assert.equal(Object.keys(REVIEWED_BLOBS).length,12);
 for(const [p,sha] of Object.entries(REVIEWED_BLOBS))
  assert.equal(gitBlob(sources[p]),sha,p);
 const report=verifySource(sources);
 assert.equal(report.existingProductionServicePreserved,true);
 assert.equal(report.existingEightFunctionExportsPreserved,true);
 assert.equal(report.deployApproved,false);
 assert.equal(report.liveCountWriteVerified,false);
 assert.equal(report.financeBoundaryVerified,false);
});
test("temporary package uses split-aware backend but keeps the original 8 callable index/flags/company-code code",()=>{
 const {bundle,report}=staged();
 assert.equal(Object.keys(bundle).length,6);
 assert.equal(bundle["functions-partner-workspace/index.js"],
  sources["functions-partner-workspace/index.js"]);
 assert.equal(bundle["functions-partner-workspace/company-code-auth.cjs"],
  sources["functions-partner-workspace/company-code-auth.cjs"]);
 assert.equal(bundle["functions-partner-workspace/package.json"],
  sources["functions-partner-workspace/package.json"]);
 assert.equal(bundle["functions-partner-workspace/service.cjs"],
  sources["staging/partner-sb-v2/service.cjs"]);
 assert.notEqual(bundle["functions-partner-workspace/service.cjs"],
  sources["functions-partner-workspace/service.cjs"]);
 assert.equal(bundle["functions-partner-workspace/sb-category-v2.cjs"],
  sources["staging/partner-sb-v2/sb-category-v2.cjs"]);
 assert.equal(bundle["firebase.partner-workspace.json"],
  sources["firebase.partner-workspace.json"]);
 assert.equal(report.originalCountKeysPreserved,true);
 const cf=JSON.parse(bundle["firebase.partner-workspace.json"]);
 assert.deepEqual(Object.keys(cf),["functions"]);
 assert.equal(cf.functions.codebase,"partner-workspace");
 assert.equal(cf.functions.source,"functions-partner-workspace");
 const exports=[...bundle["functions-partner-workspace/index.js"].matchAll(
  /exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)].map(x=>x[1]);
 assert.equal(exports.length,8);
 assert.equal(TARGETS.length,4);
 assert.ok(ensureExactOnly(TARGETS.join(",")));
 assert.ok(TARGETS.every(x=>exports.includes(x.split(":").at(-1))));
 assert.ok(!TARGETS.some(x=>/CompanyCode|MissingReportReminders|QuickCounts/.test(x)));
});
test("all relative CommonJS requires in the deployable backend are backed by a reviewed bundle file",()=>{
 const {bundle}=staged();
 for(const name of ["index.js","service.cjs","company-code-auth.cjs"]){
  const text=bundle["functions-partner-workspace/"+name];
  for(const m of text.matchAll(/require\(["'](\.\/.+?)["']\)/g)){
   const p=path.posix.normalize(path.posix.join("functions-partner-workspace",m[1]));
   assert.ok(Object.hasOwn(bundle,p),"unreviewed dependency "+p);
  }
 }
});
test("any unseen production change or accidental staging drift stops the build",()=>{
 for(const key of Object.keys(REVIEWED_BLOBS)){
  const bad={...sources,[key]:sources[key]+" "};
  assert.throws(()=>verifySource(bad),/STOP_SB_V2_RELEASE_REVIEWED_SOURCE_CHANGED/,key);
 }
 const invalid={...sources,"functions-partner-workspace/index.js":null};
 assert.throws(()=>makePackage(invalid),/STOP_SB_V2_RELEASE_REVIEWED_SOURCE_CHANGED/);
});
test("only reviewed temporary runner path may be written, never original repo or user directories",()=>{
 const env={...process.env};
 const parent=mkdtempSync(path.join(os.tmpdir(),"nico-sb-preflight-"));
 try{
  process.env.GITHUB_ACTIONS="true";
  process.env.GITHUB_REPOSITORY="Keikei-p/-";
  process.env.RUNNER_TEMP=parent;
  const dest=path.join(parent,"nico-reviewed-sb-v2-functions-package");
  const files=writeDisposablePackage(staged(),dest);
  assert.equal(files.length,6);
  for(const file of files){
   assert.equal(existsSync(path.join(dest,file)),true);
   assert.equal(readFileSync(path.join(dest,file),"utf8"),staged().bundle[file]);
  }
  assert.throws(()=>writeDisposablePackage(staged(),dest),
   /STOP_SB_V2_RELEASE_RUNNER_PACKAGE_ALREADY_EXISTS/);
  assert.throws(()=>writeDisposablePackage(staged(),path.join(root,"functions-partner-workspace")),
   /STOP_SB_V2_RELEASE_NOT_REVIEWED_RUNNER_PATH/);
  assert.throws(()=>writeDisposablePackage(staged(),path.join(parent,"other")),
   /STOP_SB_V2_RELEASE_NOT_REVIEWED_RUNNER_PATH/);
  assert.equal(existsSync(path.join(root,"functions-partner-workspace/service.cjs")),true);
 }finally{
  for(const [k,v] of Object.entries(env))process.env[k]=v;
  rmSync(parent,{recursive:true,force:true});
 }
});
test("builder has no Firebase live actions, credentials, database migration or deploy path",()=>{
 const s=readFileSync(new URL(
  "../tools/production/prepare-partner-sb-v2-verified-package.mjs",import.meta.url),"utf8");
 assert.match(s,/PREPARE_ONLY_NOT_DEPLOY/);
 assert.doesNotMatch(s,/firebase deploy|firebase-admin|firebase-functions|setDoc\(|deleteDoc\(|firestore\.googleapis\.com/);
 assert.doesNotMatch(s,/child_process|execFile|spawn\(|process\.env\.FIREBASE_SERVICE_ACCOUNT_JSON/);
 assert.equal(s.includes("deployApproved:false"),true);
});
