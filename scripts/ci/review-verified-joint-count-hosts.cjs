"use strict";
// Single, source-locked, NO DEPLOY CI review for both original dashboard
// entrypoints. This NEVER relaxes historical workflow_dispatch release gates.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {execFileSync}=require("node:child_process");
const event=process.env.GITHUB_EVENT_NAME;
assert.ok(event==="pull_request"||
 event==="push"&&process.env.GITHUB_REF==="refs/heads/main",
 "JOINT_HOST_REVIEW_PR_OR_MAIN_ONLY_NOT_WORKFLOW_DISPATCH");
const pins=Object.freeze({
 "index.html":"88ef5636bfe9254e71f2109d452b6d3049f99861",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "functions-partner-workspace/index.js":"90d51246477cf5cfa6966f3e822326ef06cccd0f",
 "functions-partner-workspace/service.cjs":"614f3216e008642ddf5eda6b93c35cc0469557c3",
 "functions-partner-workspace/company-code-auth.cjs":"f7e5899cdb9e36da610846d787955b13c1e16e4b",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750",
 "sales-archive.js":"aa82307d20cda39a8e7199b5f65c7df62100f49c",
 "partner-workspace.html":"431b200e02934315eda57b6998bdde801252f78f",
 "ranking/verified-joint-month-http-bridge.mjs":"12f6895c0d9bbfe34045333ff3c30e9e1ee3177d",
 "ranking/verified-dual-count-view.mjs":"593182c7ad36bbf3256300becfef4553152c44a7",
 "ranking/verified-dual-count-view.css":"83603df15094afea509df022b26d8b93bc4661c2",
 "tests/verified-joint-count-host-wiring.test.mjs":"9b96e76d53e66526d79ac07ad206da4e35ea4719"
});
for(const [path,expected]of Object.entries(pins)){
 const actual=execFileSync("git",["hash-object",path],{encoding:"utf8"}).trim();
 assert.equal(actual,expected,"JOINT_HOST_SOURCE_UNREVIEWED_"+path);
}
for(const secret of ["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON"])
 assert.ok(!process.env[secret],"NO_FIREBASE_CREDENTIALS_"+secret);
const partner=fs.readFileSync("partner-workspace.html","utf8"),
 owner=fs.readFileSync("sales-archive.js","utf8");
// The newer source adds an independent default-OFF publication guard.
assert.match(fs.readFileSync("functions-partner-workspace/index.js","utf8"),
 /NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/);
assert.match(fs.readFileSync("functions-partner-workspace/service.cjs","utf8"),
 /submissionPublicationEnabled=\(\)=>false/);
assert.match(partner,/const NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false;/);
assert.match(owner,/const NICO_INTERNAL_JOINT_COUNT_MONTH_RELEASED=false;/);
assert.match(partner,/if\(!NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED\|\|/);
assert.match(owner,/if\(NICO_INTERNAL_JOINT_COUNT_MONTH_RELEASED\)\{/);
assert.ok(!/firebase-firestore\.js|\bgetFirestore\s*\(/.test(partner),
 "PARTNER_MUST_USE_COUNT_ONLY_API_NOT_RAW_FIRESTORE");
for(const f of ["sales-archive.js","ranking/verified-joint-month-http-bridge.mjs"])
 execFileSync("node",["--check",f],{stdio:"inherit"});
execFileSync("node",["--test",
 "tests/verified-joint-count-host-wiring.test.mjs",
 "tests/verified-joint-month-http-bridge.test.mjs",
 "tests/verified-dual-count-view.test.mjs",
 "tests/verified-dual-count-dashboards.test.mjs",
 "tests/partner-workspace.test.cjs",
 "tests/partner-money-free-workspace.test.cjs",
 "tests/partner-company-code-auth.test.cjs",
 "tests/internal-owner-finance-visibility.test.cjs"],{stdio:"inherit"});
console.log("REVIEWED_TWO_ORIGINAL_COUNT_DASHBOARDS_PASS_NO_DEPLOY_NO_LIVE_DATA");
