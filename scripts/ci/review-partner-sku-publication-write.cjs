"use strict";
/**
 * Explicit NO-DEPLOY, exact-source review for the existing partner count
 * transaction + Owner SKU visibility. No secrets, real Firebase operations,
 * writes to GitHub, deploys, live auth or workflow_dispatch allowed.
 * A source edit must fail until hashes are deliberately reviewed again.
 */
const {readFileSync}=require("node:fs");
const {execFileSync}=require("node:child_process");
const assert=require("node:assert/strict");
const permitted=process.env.GITHUB_EVENT_NAME==="pull_request"&&
 ["feat/partner-sku-onoff-count-save-safe-20261110",
  "fix/partner-count-public-catalog-finance-label-20261111",
  "fix/partner-onoff-count-only-parity-20261111",
  "feat/partner-published-count-input-20261111"].includes(process.env.GITHUB_HEAD_REF)||
 process.env.GITHUB_EVENT_NAME==="push"&&
 process.env.GITHUB_REF==="refs/heads/main";
assert.ok(permitted,"PUBLICATION_WRITE_REVIEW_PR_OR_MAIN_ONLY_NO_DEPLOY");
for(const key of ["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON"])
 assert.ok(!process.env[key],"REVIEW_CANNOT_USE_LIVE_CREDENTIALS_"+key);
const reviewed=Object.freeze({
 "functions-partner-workspace/index.js":"aac2924f8d376743f743ae91cfa04b3f1ee30604",
 "functions-partner-workspace/service.cjs":"d5cee512085c98abe8a1e64d540639df7e85ab51",
 "functions-partner-workspace/submission-publication-guard.cjs":"a56ae6100ce70602ed90233af038549129941cd9",
 "functions-partner-workspace/approved-published-categories.cjs":"0e020d2b38152cd3669d65bf005bc76fba2cc568",
 "ranking/partner-submission-publication-guard.mjs":"273359cd7f8a6aee40fba54a1a91a2557ef817b9",
 "tests/partner-submission-publication-guard.test.mjs":"f9c1725a60b638e88cdca42a5d178d8c56cb6a4f",
 "tests/partner-workspace.test.cjs":"f3846ed8c6a740d657ce1b2e6988dee4cafa1102",
 "tests/partner-publication-write-ranking-consistency.test.cjs":"10c879a445db04267d72e561864e0d223d72ea5c",
 "partner-workspace.html":"5eb43a49613d46506af51576f2696ce3a119bb98",
 "index.html":"856d61de0fc5ec48392a10f665ce277b03d9418e",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750"
});
for(const [file,sha]of Object.entries(reviewed)){
 const actual=execFileSync("git",["hash-object",file],{encoding:"utf8"}).trim();
 assert.equal(actual,sha,"SOURCE_NOT_REVIEWED_"+file);
}
const source=file=>readFileSync(file,"utf8").replace(/\r\n/g,"\n");
const src=source("functions-partner-workspace/service.cjs");
const idx=source("functions-partner-workspace/index.js");
const canon=source("ranking/partner-submission-publication-guard.mjs");
const vendor=source("functions-partner-workspace/submission-publication-guard.cjs");
assert.equal(vendor.replace(/^"use strict";\n/,"")
 .replace(/\nmodule\.exports=\{createPartnerSubmissionPublicationGuard\};\s*$/,"").trim(),
 canon.replace('import {allowedPartnerCategories} from "../functions-partner-workspace/approved-published-categories.cjs";',
 'const {allowedPartnerCategories}=require("./approved-published-categories.cjs");')
 .replace("export function createPartnerSubmissionPublicationGuard({db}={}){",
 "function createPartnerSubmissionPublicationGuard({db}={}){").trim(),
 "SAFE_PUBLICATION_VENDOR_DRIFT");
assert.match(idx,/NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/);
assert.match(src,/submissionPublicationEnabled=\(\)=>false/);
assert.match(src,/previousCounts:prior,nextCounts:prior/);
assert.match(src,/if\(counts\[key\]!==0\)fail\("failed-precondition"\)/);
assert.match(src,/effectiveCounts\[key\]=prior\[key\]/);
assert.match(src,/policy\.enabledCategories\.length===0/);
assert.match(src,/ownerCorrectionEnabled=\(\)=>false/);
assert.doesNotMatch(src,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
assert.doesNotMatch(src,/\btx\.delete\s*\(|\brecursiveDelete\s*\(/);
assert.match(vendor,/rankingCountPublicCatalog/);
assert.doesNotMatch(vendor,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
for(const f of ["functions-partner-workspace/index.js",
 "functions-partner-workspace/service.cjs",
 "functions-partner-workspace/submission-publication-guard.cjs",
 "functions-partner-workspace/approved-published-categories.cjs",
 "ranking/partner-submission-publication-guard.mjs",
 "tests/partner-submission-publication-guard.test.mjs",
 "tests/partner-publication-write-ranking-consistency.test.cjs",
 "tests/partner-workspace.test.cjs"])
 execFileSync("node",["--check",f],{stdio:"inherit"});
execFileSync("node",["--test",
 "tests/partner-submission-publication-guard.test.mjs",
 "tests/partner-publication-write-ranking-consistency.test.cjs",
 "tests/partner-workspace.test.cjs",
 "tests/partner-money-free-workspace.test.cjs",
 "tests/partner-count-dashboard.test.cjs",
 "tests/internal-owner-finance-visibility.test.cjs",
 "tests/partner-company-code-auth.test.cjs",
 "tests/approved-partner-count-standings.test.cjs",
 "tests/owner-product-visibility-firestore.test.mjs"],{stdio:"inherit"});
console.log("PARTNER_SKU_ON_OFF_REAL_COUNT_SAVE_OFFLINE_PASS_DEFAULT_OFF_NO_DEPLOY");
