"use strict";
// Exact PR #708/current-main candidate, OFFLINE ONLY. These source pins do
// not approve a deployment, production Rules, user identity or live data.
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {execFileSync}=require("node:child_process");
const event=process.env.GITHUB_EVENT_NAME;
assert.ok(event==="pull_request"&&process.env.GITHUB_HEAD_REF===
 "review/partner-onoff-count-write-guard-no-deploy-20261114"||
 event==="push"&&process.env.GITHUB_REF==="refs/heads/main",
 "ISOLATED_REVIEW_PR708_OR_MAIN_ONLY_NO_DEPLOY");
for(const key of ["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON",
 "FIREBASE_TOKEN","NICO_RULES_APPROVAL","NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
 "NICO_PARTNER_SHARED_RANKING_ENABLED"])
 assert.ok(!process.env[key],"NO_LIVE_CREDENTIAL_OR_RELEASE_FLAG_"+key);
assert.ok(process.argv.length===2||process.argv.length===3&&
 process.argv[2]==="--sources-only","UNKNOWN_ISOLATED_REVIEW_ARGUMENT");
// Current #706 Hosting source and unchanged financial Rules/Functions were
// compared against main df9523bb079c57fd0abbfb771b55a40fd88a416f.
const pins=Object.freeze({
 "tests/approved-partner-count-standings.test.cjs":"b5d35a33c2f5a931a850f79a018c3f22dab25ff8",
 "index.html": "5edde6d5e5459ba283d12d157c021d4eee03d587",
 "firestore.rules": "d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "functions/index.js": "dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "firebase.json": "d4d918a83f2675994d7aa211c42bb2c9e7242478",
 "firebase.partner-workspace.json": "a6ceedec5fab4e22e0a8efe19c685716a2db9750",
 "functions-partner-workspace/index.js": "90d51246477cf5cfa6966f3e822326ef06cccd0f",
 "functions-partner-workspace/service.cjs": "614f3216e008642ddf5eda6b93c35cc0469557c3",
 "functions-partner-workspace/company-code-auth.cjs": "f7e5899cdb9e36da610846d787955b13c1e16e4b",
 "functions-partner-workspace/approved-published-categories.cjs": "0e020d2b38152cd3669d65bf005bc76fba2cc568",
 "functions-partner-workspace/submission-publication-guard.cjs": "a56ae6100ce70602ed90233af038549129941cd9",
 "functions-partner-workspace/shared-count-standings.cjs": "d8ae8e2a8bfeec66bb82dee049d5f104db26414a",
 "ranking/approved-published-categories.mjs": "6a091a7896bfe957ac74ff0fb994873efb1c0a37",
 "ranking/partner-submission-publication-guard.mjs": "057be44f77b88fa70aa61c52931de557bca94903",
 "partner-workspace.html": "431b200e02934315eda57b6998bdde801252f78f",
 "sales-archive.js": "aa82307d20cda39a8e7199b5f65c7df62100f49c",
 "security/secondary-finance-read-fence.mjs": "f37b0c05499305dcd710773b3f31ee2fccc86642",
 "tests/partner-publication-write-ranking-consistency.test.cjs": "ecd2fa55e176e4c3ea7395d66f06ae29e5299944",
 "tests/partner-off-only-zero-rank-protection.test.cjs": "3929020cf22789c8fd7b7cc0a4177d284b7b16dc",
 "tests/partner-submission-publication-guard.test.mjs": "f9c1725a60b638e88cdca42a5d178d8c56cb6a4f",
 "tests/partner-workspace.test.cjs": "decec4fa1278aa13a82a8a795ac3950a615f6520"
});
for(const [path,expected]of Object.entries(pins))
 assert.equal(execFileSync("git",["hash-object",path],{encoding:"utf8"}).trim(),
 expected,"ISOLATED_SOURCE_CHANGED_"+path);
const read=p=>readFileSync(p,"utf8").replace(/\r\n/g,"\n");
const commonjs=p=>read(p).replace(/^"use strict";\n/,"")
 .replace(/\nmodule\.exports=\{[^}]+\};\s*$/,"").trim();
const canonical=read("ranking/partner-submission-publication-guard.mjs")
 .replace('import {allowedPartnerCategories} from "./approved-published-categories.mjs";',
  'const {allowedPartnerCategories}=require("./approved-published-categories.cjs");')
 .replace("export function createPartnerSubmissionPublicationGuard(",
  "function createPartnerSubmissionPublicationGuard(").trim();
assert.equal(commonjs("functions-partner-workspace/submission-publication-guard.cjs"),
 canonical,"CANONICAL_VENDOR_DRIFT");
assert.equal(commonjs("functions-partner-workspace/approved-published-categories.cjs"),
 read("ranking/approved-published-categories.mjs")
 .replace("export function allowedPartnerCategories(","function allowedPartnerCategories(")
 .replace(/\nexport \{KEYS\};\s*$/,"").trim(),"PUBLISHED_CATEGORY_VENDOR_DRIFT");
const service=read("functions-partner-workspace/service.cjs"),
 index=read("functions-partner-workspace/index.js");
assert.match(service,/submissionPublicationEnabled=\(\)=>false/);
assert.match(service,/previousCounts:prior,nextCounts:counts/);
assert.match(index,/NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/);
assert.match(index,/sharedRankingEnabled:/);
assert.doesNotMatch(service,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
assert.doesNotMatch(service,/\btx\.delete\s*\(|\brecursiveDelete\s*\(/);
if(!process.argv.includes("--sources-only"))execFileSync("node",["--test",
 "tests/partner-publication-write-ranking-consistency.test.cjs",
 "tests/partner-off-only-zero-rank-protection.test.cjs",
 "tests/partner-submission-publication-guard.test.mjs",
 "tests/partner-workspace.test.cjs","tests/partner-money-free-workspace.test.cjs",
 "tests/partner-count-dashboard.test.cjs","tests/internal-owner-finance-visibility.test.cjs",
 "tests/partner-company-code-auth.test.cjs","tests/approved-partner-count-standings.test.cjs",
 "tests/owner-product-visibility-firestore.test.mjs"],{stdio:"inherit"});
console.log("EXACT_PR708_COUNT_GUARD_SOURCE_PASS_NO_PRODUCTION_APPROVAL_NO_DEPLOY");
