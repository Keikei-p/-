"use strict";
// PR #704 only: exact current sources and existing functional regression suites.
// This cannot authorize a release, main push, credentials or workflow_dispatch.
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {execFileSync}=require("node:child_process");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const branch="integration/nico-sales-count-publication-rank-ready-20261113";
assert.equal(process.env.GITHUB_EVENT_NAME,"pull_request","OFFLINE_704_PR_ONLY");
assert.equal(process.env.GITHUB_REPOSITORY,"Keikei-p/-","OFFLINE_704_REPOSITORY");
assert.equal(process.env.GITHUB_HEAD_REF,branch,"OFFLINE_704_BRANCH");
for(const key of ["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON",
 "FIREBASE_TOKEN","NICO_RULES_APPROVAL","NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
 "NICO_PARTNER_SHARED_RANKING_ENABLED","NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED",
 "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED","NICO_JOINT_COUNT_RANKING_ENABLED",
 "HUB_OWNER_COUNT_CORRECTION_V3_ENABLED"])
 assert.ok(!process.env[key],"OFFLINE_704_NO_CREDENTIALS_OR_RELEASE_FLAG_"+key);
assert.ok(process.argv.length===2||process.argv.length===3&&
 process.argv[2]==="--sources-only","OFFLINE_704_ARGUMENT");
assert.ok(process.env.GITHUB_EVENT_PATH,"OFFLINE_704_EVENT_REQUIRED");
const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,"utf8"));
assert.equal(event.pull_request?.number,704,"OFFLINE_704_NUMBER");
assert.equal(event.pull_request?.head?.ref,branch,"OFFLINE_704_EVENT_BRANCH");
assert.equal(event.pull_request?.head?.repo?.full_name,"Keikei-p/-","OFFLINE_704_HEAD_REPO");
assert.equal(event.pull_request?.base?.repo?.full_name,"Keikei-p/-","OFFLINE_704_BASE_REPO");
const report=JSON.parse(execFileSync(process.execPath,[
 "tools/production/verify-integrated-count-release-candidate.mjs","--offline",".",
 "docs/integrated-count-release-candidate-20261115.json"
],{cwd:root,encoding:"utf8",maxBuffer:2*1024*1024}));
assert.equal(report.localSourceVerified,true,"OFFLINE_704_SOURCE_VERIFICATION");
assert.equal(report.productionWrites,0,"OFFLINE_704_NO_PRODUCTION_WRITES");
assert.equal(report.safeToApply,false,"OFFLINE_704_CANNOT_APPLY");
assert.equal(report.releaseApproved,false,"OFFLINE_704_NO_RELEASE_APPROVAL");
// Preserve functional checks originally run inside the legacy exact-source
// reviewer scripts. Direct workflow test steps remain independently enabled.
const legacyRegressionSuites=Object.freeze([
 "tests/partner-submission-publication-guard.test.mjs",
 "tests/partner-workspace.test.cjs",
 "tests/partner-money-free-workspace.test.cjs",
 "tests/partner-count-dashboard.test.cjs",
 "tests/internal-owner-finance-visibility.test.cjs",
 "tests/partner-company-code-auth.test.cjs",
 "tests/approved-partner-count-standings.test.cjs",
 "tests/owner-product-visibility-firestore.test.mjs",
 "tests/verified-joint-count-host-wiring.test.mjs",
 "tests/verified-joint-month-http-bridge.test.mjs",
 "tests/verified-dual-count-view.test.mjs",
 "tests/verified-dual-count-dashboards.test.mjs",
 "tests/approved-partner-ranking-ui.test.mjs",
 "tests/partner-existing-ranking.test.cjs"
]);
if(!process.argv.includes("--sources-only"))execFileSync(process.execPath,
 ["--test",...legacyRegressionSuites],{cwd:root,stdio:"inherit"});
console.log("EXACT_704_OFFLINE_SOURCES_VERIFIED_NO_APPROVAL_NO_DEPLOY");
