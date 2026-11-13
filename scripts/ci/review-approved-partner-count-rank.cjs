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
 "functions-partner-workspace/service.cjs":"e657a2fd79365b9bb17440df48adcc17e41d9b2c",
 "functions-partner-workspace/index.js":"aac2924f8d376743f743ae91cfa04b3f1ee30604",
 "functions-partner-workspace/shared-count-standings.cjs":"b6a1e11f3b1efdd073064dbd75d23b3fa2552865",
 "functions-partner-workspace/approved-published-categories.cjs":"0e020d2b38152cd3669d65bf005bc76fba2cc568",
 "functions-partner-workspace/submission-publication-guard.cjs":"a56ae6100ce70602ed90233af038549129941cd9",
 "partner-workspace.html":"26af9dd9fde56cc6cfe3bd370d7f30641b03b921",
 "ranking/owner-product-visibility-firestore.mjs":"3d3924aa52a2655879605c358f26d36953462262",
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs":"3d3924aa52a2655879605c358f26d36953462262",
 "functions-ranking-approvals/ranking/owner-product-visibility-firestore.mjs":"3d3924aa52a2655879605c358f26d36953462262",
 "ranking/verified-dual-count-dashboards.mjs":"025219489df608fdf00bd941389812bbaa1dc6fa",
 "functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs":"025219489df608fdf00bd941389812bbaa1dc6fa",
 "ranking/owner-product-visibility-rankings.mjs":"18e900519eaf55bba12286e3cf994d0aec6e4651",
 "functions-ranking-approvals/ranking/owner-product-visibility-rankings.mjs":"18e900519eaf55bba12286e3cf994d0aec6e4651",
 "ranking/owner-visible-count-server-handler.mjs":"dd6618a609d7e3aeebfc4020aa8ed5d7430c2421",
 "ranking/owner-visible-count-atomic-loader.mjs":"a41e6e6ac97b97a77ffc6150d05a6455985d8a65",
 "ranking/canonical-joint-count-sku-reader.mjs":"381cacf167762471c66aedad541b3f2daeb41560",
 "ranking/verified-two-month-count-input.mjs":"cfdf4de159887785610eeab32f973a005940e942",
 "ranking/verified-joint-month-http-bridge.mjs":"fd6af0e899413cc13898d28d10e9f271938b47d9",
 "tests/verified-dual-count-dashboards.test.mjs":"d8296e5488adbd6433e9a505c95c9d8e4c11a299",
 "tests/owner-product-visibility-rankings.test.mjs":"e28c4ffbd4954785e7dcc8075959b9af2e0b86e4",
 "index.html":"1eda9836a0ced437bdb8710104a23919418071c3",
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
 "tests/ranking-day-week-deployment-parity.test.cjs",
 "tests/joint-count-http-adapter.test.cjs",
 "tests/verified-joint-count-host-wiring.test.mjs"],{stdio:"inherit"});
console.log("REVIEW_ONLY_COUNT_RANKING_PASS_NO_DEPLOY_NO_LIVE_CREDENTIALS");
