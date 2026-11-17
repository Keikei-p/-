"use strict";
/**
 * NO DEPLOY, PR/main-commit only. This is a strict alternate validation
 * path for the separately reviewed default-OFF count-ranking candidate.
 * New read-only reviewer for updated current main after Owner GET rollout prep.
 * Historical PR/dispatch release reviewers remain unchanged.
 * No Firebase credentials, deployment or data writes.
 */
const fs=require("node:fs");
const {execFileSync}=require("node:child_process");
const assert=require("node:assert/strict");
const permitted=process.env.GITHUB_EVENT_NAME==="pull_request"&&
 process.env.GITHUB_HEAD_REF==="fix/main-count-rank-review-current-main-20261117"||
 process.env.GITHUB_EVENT_NAME==="push"&&process.env.GITHUB_REF==="refs/heads/main";
assert.ok(permitted,"REVIEW_ONLY_NEVER_WORKFLOW_DISPATCH");
const hashes=Object.freeze({
 "functions-partner-workspace/service.cjs":"712bf523ac83942c02767c25321bfed7059055be",
 "functions-partner-workspace/index.js":"42eea81ab01449bedbbedabdc1a8fb6bfba1e284",
 "functions-partner-workspace/shared-count-standings.cjs":"d8ae8e2a8bfeec66bb82dee049d5f104db26414a",
 "functions-partner-workspace/approved-published-categories.cjs":"0e020d2b38152cd3669d65bf005bc76fba2cc568",
 "partner-workspace.html":"d8262633f35cf0f015de44c9a223c4289f8d2a6b",
 "ranking/owner-product-visibility-firestore.mjs":"83484484d44dde5144852baee29164034cd79d1e",
 "functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs":"83484484d44dde5144852baee29164034cd79d1e",
 "functions-ranking-approvals/ranking/owner-product-visibility-firestore.mjs":"83484484d44dde5144852baee29164034cd79d1e",
 "index.html":"03e213565a2037c73913602701363476ae0db9fd",
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
assert.match(src,/previousCounts:prior,previousPrivateCounts:savedPrivate\.counts/,
 "COUNT_CORRECTION_MUST_USE_PREVIOUS_COUNTS_IN_LEDGER");
assert.match(src,/const n=companyCounts\[key\]\+counts\[key\]-prior\[key\]/,
 "COUNT_DELTA_MUST_SUBTRACT_PREVIOUS_COUNTS");
assert.match(page,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
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
console.log("CURRENT_MAIN_COUNT_RANKING_REVIEW_PASS_NO_DEPLOY_NO_LIVE_CREDENTIALS");
