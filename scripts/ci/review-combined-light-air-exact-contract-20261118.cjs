"use strict";
// Strict code-review gate for the legacy combined 光/AIR count-only fix.
// This is an offline PR review. No production credentials, writes or deploy.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {execFileSync}=require("node:child_process");
const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trimEnd();
const fail=(why)=>{throw Error("STOP_LEGACY_LIGHT_AIR_REVIEW_"+why)};
if(process.env.GITHUB_EVENT_NAME!=="pull_request")fail("PR_REQUIRED");
if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
   process.env.FIREBASE_TOKEN||process.env.NICO_JOINT_COUNT_RANKING_ENABLED||
   process.env.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED)fail("NO_CREDENTIALS_OR_RELEASE_FLAGS");
git("fetch","--no-tags","origin","main");
const paths=[
 "functions-partner-workspace/approved-published-categories.cjs",
 "functions-partner-workspace/submission-publication-guard.cjs",
 "functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs",
 "functions-ranking-approvals/ranking/owner-reviewed-sku-mapping-store.mjs",
 "ranking/approved-published-categories.mjs",
 "ranking/canonical-joint-count-sku-reader.mjs",
 "ranking/owner-reviewed-sku-mapping-store.mjs",
 "ranking/partner-submission-publication-guard.mjs",
 "tools/production/inspect-live-sku-publication-readonly.mjs"
];
const tests=[
 "tests/inspect-live-sku-publication-readonly.test.mjs",
 "tests/owner-product-visibility-firestore.test.mjs",
 "tests/owner-reviewed-sku-mapping-store.test.mjs"
];
const self="scripts/ci/review-combined-light-air-exact-contract-20261118.cjs";
const workflow=".github/workflows/nico-combined-light-air-contract-review.yml";
const actual=git("diff","--name-only","origin/main...HEAD").split("\n").filter(Boolean).sort();
assert.deepEqual(actual,[...paths,...tests,self,workflow].sort(),
 "source scope must be exactly the reviewed 9 guards, 3 additive tests and 2 review files");
const regex=String.raw;
// This is the single immutable strict category. It never splits 光 and Air.
const declaration="const LEGACY_COMBINED_LIGHT_AIR="+
 "/(?:SB光・AIR|旧合算|未分類|^(?:SB|ソフトバンク)?光\\s*[/／・]\\s*(?:AIR|エアー)$)/i;\n";
const rewrites=[
 ["!/SB光・AIR|旧合算|未分類/.test(catalog.get(b.hubProductId).name)",
  '!LEGACY_COMBINED_LIGHT_AIR.test(catalog.get(b.hubProductId).name.normalize("NFKC"))'],
 ["!/SB光・AIR|旧合算|未分類/.test(name)",
  '!LEGACY_COMBINED_LIGHT_AIR.test(name.normalize("NFKC"))'],
 ["!/SB光・AIR|旧合算|未分類/.test(products.get(bind.hubProductId).name)",
  '!LEGACY_COMBINED_LIGHT_AIR.test(products.get(bind.hubProductId).name.normalize("NFKC"))'],
 ["/旧合算|未分類|SB光・AIR/.test(originalProduct.name)",
  'LEGACY_COMBINED_LIGHT_AIR.test(originalProduct.name.normalize("NFKC"))'],
 ["!/旧合算|未分類|SB光・AIR/.test(target.name)",
  '!LEGACY_COMBINED_LIGHT_AIR.test(target.name.normalize("NFKC"))']
];
function singleReplace(text,from,to){
 const positions=text.split(from).length-1;
 if(positions!==1)fail("EXACT_REWRITE_SITE");
 return text.replace(from,to);
}
for(const path of paths){
 const old=execFileSync("git",["show","origin/main:"+path],{encoding:"utf8"});
 let expected=singleReplace(old,"const ",declaration+"const ");
 let count=0;
 for(const [before,after] of rewrites){
  const seen=expected.split(before).length-1;
  if(seen>1)fail("MULTIPLE_REWRITE_SITES");
  if(seen===1){expected=singleReplace(expected,before,after);count++;}
 }
 if(count!==(path.includes("canonical-joint-count-sku-reader")?2:1))
  fail("UNREVIEWED_WRITE_OR_RANKING_PATCH");
 assert.equal(fs.readFileSync(path,"utf8"),expected,
  "No code may change beyond the exact reviewed combined-only matcher: "+path);
}
const namedTests=[
 /exact 光\/AIR aliases stay one combined SKU/,
 /Owner can explicitly review exact 光\/AIR variants/,
 /read-only readiness accepts combined 光\/AIR aliases/
];
for(let i=0;i<tests.length;i++){
 const path=tests[i],old=execFileSync("git",["show","origin/main:"+path],{encoding:"utf8"});
 const curr=fs.readFileSync(path,"utf8");
 assert(curr.startsWith(old.trimEnd()+"\n"),"existing test cases cannot be removed/edited: "+path);
 const added=curr.slice(old.trimEnd().length);
 assert(namedTests[i].test(added),"required alias regression case missing: "+path);
 assert(!/\bfetch\s*\(|\bdelete\s*\(|\bdeploy\b|\bprocess\.env\s*=/.test(added),
  "new tests may never trigger live writes: "+path);
}
const unchanged=[
"firestore.rules","firebase.json","index.html","partner-workspace.html",
"sales-archive.js","functions/index.js","functions-partner-workspace/index.js",
"functions-partner-workspace/service.cjs","functions-ranking-approvals/index.js"
];
if(git("diff","--name-only","origin/main...HEAD","--",...unchanged))
 fail("LIVE_FINANCE_OR_COUNT_SOURCE_DRIFT");
const disabled=fs.readFileSync("functions-partner-workspace/index.js","utf8");
const ranked=fs.readFileSync("functions-ranking-approvals/index.js","utf8");
assert(disabled.includes('NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"'));
assert(ranked.includes('NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"'));
for(const p of [...paths,...tests])assert(!/^(?:\.\.|\/)/.test(p),"no path traversal");
console.log("LEGACY_LIGHT_AIR_EXACT_REVIEW_PASS_CHANGESET_ONLY_NO_DEPLOY");
