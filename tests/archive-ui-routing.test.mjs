import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const module=readFileSync(new URL("../sales-archive.js",import.meta.url),"utf8");
const hosting=readFileSync(new URL("../.github/workflows/nico-factory-sync.yml",import.meta.url),"utf8");
const pwa=readFileSync(new URL("../service-worker.js",import.meta.url),"utf8");
const files=["sales-archive.js","archive-output-policy.mjs",
 "archive-coverage.mjs","archive-read-budget.mjs"];
test("archive module is wired after existing app initialization, not a second app",()=>{
 const mainIndex=html.indexOf('<script type="module">');
 const archiveIndex=html.lastIndexOf('<script type="module" src="./sales-archive.js"></script>');
 assert(mainIndex>=0&&archiveIndex>mainIndex);
 assert.equal(html.match(/src="\.\/sales-archive\.js"/g)?.length,1);
 assert.match(module,/getApp\(\)/);
 assert.match(module,/companyForOwner\(currentUser\)/);
 assert.match(module,/onAuthStateChanged\(auth/);
});
test("manual NICO hosting includes four archive dependencies with safe cache policy",()=>{
 for(const file of files){
  assert(hosting.includes("'"+file+"'"),"missing validation: "+file);
  assert(new RegExp("for f in [^\\n]*"+file.replaceAll(".","\\.")).test(hosting),
   "missing published asset: "+file);
 }
 assert.match(hosting,/workflow_dispatch:/);
 assert.doesNotMatch(hosting,/\n  push:\s*\n/);
 assert.match(hosting,/CONFIRM_NICO_HOSTING_RELEASE/);
 assert.match(hosting,/firebase deploy --only hosting/);
 assert.doesNotMatch(hosting,/--only firestore:rules/);
 assert.match(hosting,/"source":"\/sales-archive\.js"/);
 assert.match(hosting,/"source":"\*\*\/\*\.mjs"/);
 // PWA intentionally only caches icons and manifest, not private archive data.
 assert(!pwa.includes('sales-archive.js'));
});
test("archive uses server-only queries, budget check, owner recheck and no writes/deletes",()=>{
 assert.match(module,/getCountFromServer/);
 assert.match(module,/checkArchivePreflightCounts/);
 assert.match(module,/assertArchiveQueryCountsMatch/);
 assert.match(module,/getDocsFromServer/);
 assert.match(module,/reset\(\); \/\/ Never retain a previous export/);
 assert.match(module,/const authorized=await companyForOwner\(auth\.currentUser\)/);
 for(const pattern of [/deleteDoc\s*\(/,/setDoc\s*\(/,/updateDoc\s*\(/,
   /firebase\s+deploy/,/wrangler\s+deploy/])
  assert.doesNotMatch(module,pattern);
});
