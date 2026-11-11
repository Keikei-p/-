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
  "fix/partner-policy-single-source-20261111"].includes(process.env.GITHUB_HEAD_REF)||
 process.env.GITHUB_EVENT_NAME==="push"&&
 process.env.GITHUB_REF==="refs/heads/main";
assert.ok(permitted,"PUBLICATION_WRITE_REVIEW_PR_OR_MAIN_ONLY_NO_DEPLOY");
for(const key of ["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON"])
 assert.ok(!process.env[key],"REVIEW_CANNOT_USE_LIVE_CREDENTIALS_"+key);
const reviewed=Object.freeze({
 "functions-partner-workspace/index.js":"90d51246477cf5cfa6966f3e822326ef06cccd0f",
 "functions-partner-workspace/service.cjs":"614f3216e008642ddf5eda6b93c35cc0469557c3",
 "functions-partner-workspace/submission-publication-guard.cjs":"a56ae6100ce70602ed90233af038549129941cd9",
 "ranking/partner-submission-publication-guard.mjs":"17efb452199d5b147859c5aae4403c2ed8d36deb",
 "tests/partner-submission-publication-guard.test.mjs":"f9c1725a60b638e88cdca42a5d178d8c56cb6a4f",
 "tests/partner-workspace.test.cjs":"decec4fa1278aa13a82a8a795ac3950a615f6520",
 "partner-workspace.html":"431b200e02934315eda57b6998bdde801252f78f",
 "index.html":"88ef5636bfe9254e71f2109d452b6d3049f99861",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750"
});
for(const [file,sha]of Object.entries(reviewed)){
 const actual=execFileSync("git",["hash-object",file],{encoding:"utf8"}).trim();
 assert.equal(actual,sha,"SOURCE_NOT_REVIEWED_"+file);
}
const src=readFileSync("functions-partner-workspace/service.cjs","utf8");
const idx=readFileSync("functions-partner-workspace/index.js","utf8");
const canon=readFileSync("ranking/partner-submission-publication-guard.mjs","utf8");
const vendor=readFileSync("functions-partner-workspace/submission-publication-guard.cjs","utf8");
assert.equal(vendor.replace(/^"use strict";\n/,"")
 .replace('const {allowedPartnerCategories}=require("./approved-published-categories.cjs");',
  'import {allowedPartnerCategories} from "../functions-partner-workspace/approved-published-categories.cjs";')
 .replace(/\nmodule\.exports=\{createPartnerSubmissionPublicationGuard\};\s*$/,"").trim(),
 canon.replace("export function createPartnerSubmissionPublicationGuard({db}={}){",
 "function createPartnerSubmissionPublicationGuard({db}={}){").trim(),
 "SAFE_PUBLICATION_VENDOR_DRIFT");
assert.match(idx,/NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/);
assert.match(src,/submissionPublicationEnabled=\(\)=>false/);
assert.match(src,/previousCounts:prior,nextCounts:counts/);
assert.doesNotMatch(src,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
assert.doesNotMatch(src,/\btx\.delete\s*\(|\brecursiveDelete\s*\(/);
assert.match(vendor,/rankingCountPublicCatalog/);
assert.doesNotMatch(vendor,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
for(const f of ["functions-partner-workspace/index.js",
 "functions-partner-workspace/service.cjs",
 "functions-partner-workspace/submission-publication-guard.cjs",
 "ranking/partner-submission-publication-guard.mjs",
 "tests/partner-submission-publication-guard.test.mjs",
 "tests/partner-workspace.test.cjs"])
 execFileSync("node",["--check",f],{stdio:"inherit"});
execFileSync("node",["--test",
 "tests/partner-submission-publication-guard.test.mjs",
 "tests/partner-workspace.test.cjs",
 "tests/partner-money-free-workspace.test.cjs",
 "tests/partner-count-dashboard.test.cjs",
 "tests/internal-owner-finance-visibility.test.cjs",
 "tests/partner-company-code-auth.test.cjs",
 "tests/approved-partner-count-standings.test.cjs",
 "tests/owner-product-visibility-firestore.test.mjs"],{stdio:"inherit"});
console.log("PARTNER_SKU_ON_OFF_REAL_COUNT_SAVE_OFFLINE_PASS_DEFAULT_OFF_NO_DEPLOY");
