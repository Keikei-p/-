import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL(
 "../.github/workflows/nico-owner-unclaimed-consent-status-manual.yml",import.meta.url
),"utf8");
test("the initial main push is strictly NO DEPLOY, a connector job rerun exactly attempt 2 is mandatory",()=>{
 assert.match(s,/GITHUB_RUN_ATTEMPT" = 1/);
 assert.match(s,/approved=false/);
 assert.match(s,/GITHUB_RUN_ATTEMPT" = 2/);
 assert.match(s,/approved=true/);
 assert.match(s,/GITHUB_REF" = refs\/heads\/main/);
 assert.match(s,/GITHUB_EVENT_NAME" = push/);
 assert.match(s,/gh api repos\/Keikei-p\/-\/branches\/main/);
 assert.match(s,/release\(owner\): one safe consent status read update for unclaimed partner workspace/);
 assert.doesNotMatch(s,/\n  workflow_dispatch:/);
});
test("exact one export-only deploy, original six and all Gen2 snapshots before/after, joint ranks still off",()=>{
 assert.match(s,/UPDATE_ONLY_getRankingOwnerConsentStatus_PRESERVE_ALL_OTHER_FUNCTIONS/);
 assert.match(s,/NO_FIRESTORE_AUTH_IAM_OR_HOSTING_CHANGES/);
 assert.match(s,/FUNCTION_BUILD_TRIAL_CHARGE_EXPLICITLY_APPROVED/);
 assert.match(s,/export TARGET=functions:ranking-owner-approvals:getRankingOwnerConsentStatus/);
 assert.match(s,/--only "\$TARGET"/);
 assert.match(s,/process.env.TARGET/);
 assert.match(s,/NICO_JOINT_COUNT_RANKING_ENABLED=disabled/);
 assert.match(s,/protect-ranking-original-functions-versions.mjs before/);
 assert.match(s,/protect-ranking-original-functions-versions.mjs after/);
 assert.match(s,/snapshotOtherFunctions/);
 assert.match(s,/compareSingleFunctionVersion/);
 assert.match(s,/NO_DEPLOY_RETRY_EVEN_ON_PARTIAL_CLI_FAILURE/);
 assert.match(s,/ONE_OWNER_CONSENT_STATUS_LIVE_REVISION_VERIFIED/);
 assert.doesNotMatch(s,/--only firestore|--only hosting|--force/);
 const dangerous=s.split("\n      - name: ").filter(x=>
  x.includes("firebase deploy "));
 assert.equal(dangerous.length,1);
 assert.match(dangerous[0],/if: \$\{\{ steps.gate.outputs.approved == 'true' \}\}/);
});
