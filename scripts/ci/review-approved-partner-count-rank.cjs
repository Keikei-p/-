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
 process.env.GITHUB_HEAD_REF==="feat/verified-partner-daily-month-count-ranking-main-20261110"||
 process.env.GITHUB_EVENT_NAME==="push"&&process.env.GITHUB_REF==="refs/heads/main";
assert.ok(permitted,"REVIEW_ONLY_NEVER_WORKFLOW_DISPATCH");
const hashes=Object.freeze({
 "functions-partner-workspace/service.cjs":"614f3216e008642ddf5eda6b93c35cc0469557c3",
 "functions-partner-workspace/index.js":"90d51246477cf5cfa6966f3e822326ef06cccd0f",
 "functions-partner-workspace/shared-count-standings.cjs":"4655436c58a73210f7b6ab38223652bb8376ed97",
 "functions-partner-workspace/approved-published-categories.cjs":"6ae0009c85f4fb95233a4b3880ea4ea3ae906f86",
 "partner-workspace.html":"431b200e02934315eda57b6998bdde801252f78f",
 "ranking/owner-product-visibility-firestore.mjs":"8e2289b1dd8b62f4d682dc6231a339294178abcb",
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs":"8e2289b1dd8b62f4d682dc6231a339294178abcb",
 "index.html":"88ef5636bfe9254e71f2109d452b6d3049f99861",
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
assert.match(src,/previousCounts:prior,nextCounts:counts/,
 "COUNT_CORRECTION_MUST_USE_SAME_TX_PREVIOUS_COUNTS");
assert.match(page,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
assert.ok(!/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/.test(src),
 "RAW_FINANCE_COLLECTION_IN_PARTNER_WORKSPACE");
assert.ok(!/\btx\.delete\s*\(|\brecursiveDelete\s*\(/.test(src),"DESTRUCTIVE_SOURCE");
assert.equal(fs.readFileSync(
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs","utf8"),
 fs.readFileSync("ranking/owner-product-visibility-firestore.mjs","utf8"),
 "COUNT_CATALOG_VENDOR_OUT_OF_SYNC");
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
 "tests/partner-existing-ranking.test.cjs"],{stdio:"inherit"});
console.log("REVIEW_ONLY_COUNT_RANKING_PASS_NO_DEPLOY_NO_LIVE_CREDENTIALS");
