"use strict";
/**
 * NO DEPLOY, PR/main-commit only. This is a strict alternate validation
 * path for the separately reviewed default-OFF count-ranking candidate.
 * Existing workflow_dispatch and historical production release hash pins
 * MUST continue to use the old path, never this one.
 */
const fs=require("node:fs");
const {execFileSync}=require("node:child_process");
const assert=require("node:assert/strict");
const permitted=process.env.GITHUB_EVENT_NAME==="pull_request"&&
 ["feat/verified-partner-daily-month-count-ranking-main-20261110",
  "fix/owner-catalog-review-pins-20261111",
  "fix/main-count-ranking-reviewed-ci-20261111",
  "feat/partner-published-count-input-20261111"].includes(process.env.GITHUB_HEAD_REF)||
 process.env.GITHUB_EVENT_NAME==="push"&&process.env.GITHUB_REF==="refs/heads/main";
assert.ok(permitted,"REVIEW_ONLY_NEVER_WORKFLOW_DISPATCH");
const hashes=Object.freeze({
 "functions-partner-workspace/service.cjs":"d5cee512085c98abe8a1e64d540639df7e85ab51",
 "functions-partner-workspace/index.js":"aac2924f8d376743f743ae91cfa04b3f1ee30604",
 "functions-partner-workspace/shared-count-standings.cjs":"32223b51d2e7c92348230406b239049ebbfd7e96",
 "functions-partner-workspace/approved-published-categories.cjs":"0e020d2b38152cd3669d65bf005bc76fba2cc568",
 "functions-partner-workspace/submission-publication-guard.cjs":"a56ae6100ce70602ed90233af038549129941cd9",
 "partner-workspace.html":"5eb43a49613d46506af51576f2696ce3a119bb98",
 "ranking/owner-product-visibility-firestore.mjs":"3d3924aa52a2655879605c358f26d36953462262",
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs":"3d3924aa52a2655879605c358f26d36953462262",
 "functions-ranking-approvals/ranking/owner-product-visibility-firestore.mjs":"3d3924aa52a2655879605c358f26d36953462262",
 "ranking/verified-dual-count-dashboards.mjs":"9a69c77c59aa6492e777a15bb3e10b0d484c2e86",
 "functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs":"9a69c77c59aa6492e777a15bb3e10b0d484c2e86",
 "ranking/owner-product-visibility-rankings.mjs":"89cc3562422855ba865733b51bf18b0c9a1b8c1f",
 "functions-ranking-approvals/ranking/owner-product-visibility-rankings.mjs":"89cc3562422855ba865733b51bf18b0c9a1b8c1f",
 "ranking/owner-visible-count-server-handler.mjs":"de5af7dc1c984a76bf2c8d8e5918535eaf92d072",
 "ranking/owner-visible-count-atomic-loader.mjs":"a41e6e6ac97b97a77ffc6150d05a6455985d8a65",
 "ranking/canonical-joint-count-sku-reader.mjs":"a786aced6f27477fc086494db109874c549fbace",
 "ranking/verified-two-month-count-input.mjs":"7b8f28d507ff20742094642f83eed46a53ca76f0",
 "ranking/verified-joint-month-http-bridge.mjs":"69c9387bee3acdd434bbf9511baf5a82e7b6d60e",
 "tests/verified-dual-count-dashboards.test.mjs":"df0f0cd17ea17226271e92ae14f61a1611d82d54",
 "tests/owner-product-visibility-rankings.test.mjs":"7337aa1430a81964e69131e960d95882af4122cf",
 "index.html":"856d61de0fc5ec48392a10f665ce277b03d9418e",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750"
});
for(const [path,expected]of Object.entries(hashes)){
 const actual=execFileSync("git",["hash-object",path],{encoding:"utf8"}).trim();
 assert.equal(actual,expected,"UNREVIEWED_SOURCE_"+path);
}
const src=fs.readFileSync("functions-partner-workspace/service.cjs","utf8");
const page=fs.readFileSync("partner-workspace.html","utf8");
const idx=fs.readFileSync("functions-partner-workspace/index.js","utf8");
assert.match(idx,/sharedRankingEnabled:\(\)=>process\.env\.NICO_PARTNER_SHARED_RANKING_ENABLED==="enabled"/);
assert.match(idx,/NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/,
 "OWNER_PUBLICATION_WRITE_MUST_REMAIN_EXPLICITLY_DISABLED_BY_DEFAULT");
assert.match(src,/submissionPublicationEnabled=\(\)=>false/,
 "NO_IMPLICIT_PARTNER_COUNT_WRITE_FLAG");
assert.match(src,/previousCounts:prior,nextCounts:prior/,
 "COUNT_CORRECTION_MUST_USE_SAME_TX_PREVIOUS_COUNTS");
assert.match(src,/effectiveCounts\[key\]=prior\[key\]/,
 "UNPUBLISHED_HISTORICAL_COUNTS_MUST_BE_PRESERVED");
assert.match(src,/ownerCorrectionEnabled=\(\)=>false/);
assert.match(page,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
assert.match(page,/NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false/);
assert.match(fs.readFileSync("index.html","utf8"),/NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=false/);
assert.ok(!/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/.test(src),
 "RAW_FINANCE_COLLECTION_IN_PARTNER_WORKSPACE");
assert.ok(!/\btx\.delete\s*\(|\brecursiveDelete\s*\(/.test(src),"DESTRUCTIVE_SOURCE");
assert.equal(fs.readFileSync(
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs","utf8"),
 fs.readFileSync("ranking/owner-product-visibility-firestore.mjs","utf8"),
 "COUNT_CATALOG_VENDOR_OUT_OF_SYNC");
assert.equal(fs.readFileSync(
 "functions-ranking-approvals/ranking/owner-product-visibility-firestore.mjs","utf8"),
 fs.readFileSync("ranking/owner-product-visibility-firestore.mjs","utf8"),
 "COUNT_CATALOG_RANKING_COPY_OUT_OF_SYNC");
for(const name of ["verified-dual-count-dashboards.mjs",
 "owner-product-visibility-rankings.mjs","owner-visible-count-server-handler.mjs",
 "owner-visible-count-atomic-loader.mjs","canonical-joint-count-sku-reader.mjs",
 "verified-two-month-count-input.mjs"]){
 assert.equal(fs.readFileSync("functions-ranking-approvals/ranking/"+name,"utf8"),
  fs.readFileSync("ranking/"+name,"utf8"),"RANKING_FUNCTION_VENDOR_DRIFT_"+name);
}
const forbidden=["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON"];
for(const key of forbidden)assert.ok(!process.env[key],"LIVE_CREDENTIALS_NOT_PERMITTED_"+key);
const checks=["functions-partner-workspace/service.cjs",
 "functions-partner-workspace/index.js",
 "functions-partner-workspace/shared-count-standings.cjs",
 "functions-partner-workspace/approved-published-categories.cjs",
 "ranking/owner-product-visibility-firestore.mjs",
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs",
 "tests/approved-partner-count-standings.test.cjs",
 "tests/approved-partner-ranking-ui.test.mjs",
 "tests/partner-workspace.test.cjs"];
for(const file of checks)execFileSync("node",["--check",file],{stdio:"inherit"});
execFileSync("node",["--test",
 "tests/approved-partner-count-standings.test.cjs",
 "tests/approved-partner-ranking-ui.test.mjs",
 "tests/partner-workspace.test.cjs",
 "tests/owner-product-visibility-firestore.test.mjs",
 "tests/internal-owner-finance-visibility.test.cjs",
 "tests/partner-money-free-workspace.test.cjs",
 "tests/partner-count-dashboard.test.cjs",
 "tests/partner-company-code-auth.test.cjs",
 "tests/partner-existing-ranking.test.cjs",
 "tests/verified-dual-count-dashboards.test.mjs",
 "tests/verified-dual-count-view.test.mjs",
 "tests/owner-product-visibility-rankings.test.mjs",
 "tests/owner-visible-count-server-handler.test.mjs",
 "tests/owner-visible-count-atomic-loader.test.mjs",
 "tests/canonical-joint-count-sku-reader.test.mjs",
 "tests/verified-two-month-count-input.test.mjs",
 "tests/verified-joint-month-http-bridge.test.mjs",
 "tests/ranking-day-week-deployment-parity.test.cjs"],{stdio:"inherit"});
console.log("REVIEW_ONLY_COUNT_RANKING_PASS_NO_DEPLOY_NO_LIVE_CREDENTIALS");
