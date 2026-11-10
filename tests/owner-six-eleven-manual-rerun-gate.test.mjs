import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=readFileSync(new URL(
 "../.github/workflows/nico-owner-six-eleven-explicit-rerun-release.yml",import.meta.url
),"utf8");
test("first GitHub push is offline-only; deployment requires human manual job rerun",()=>{
 assert.match(file,/GITHUB_RUN_ATTEMPT" = 1/);
 assert.match(file,/GITHUB_RUN_ATTEMPT" = 2/);
 assert.match(file,/approved=false/);
 assert.match(file,/approved=true/);
 assert.match(file,/steps.gate.outputs.approved == 'true'/);
 assert.match(file,/GITHUB_EVENT_NAME" = push/);
 assert.match(file,/GITHUB_REF" = refs\/heads\/main/);
 assert.match(file,/gh api repos\/Keikei-p\/-\/branches\/main/);
 assert.match(file,/release\(owner\): approved manual rerun six Functions and eleven assets/);
 assert.doesNotMatch(file,/\n  workflow_dispatch:/);
 assert.doesNotMatch(file,/pull_request_target/);
});
test("Owner release all risky steps are gated, source-fixed and preserve originals",()=>{
 assert.match(file,/CONFIRM_SIX_OWNER_SETTINGS_ONLY_AND_ELEVEN_ADDITIVE_ASSETS/);
 assert.match(file,/FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED/);
 assert.match(file,/NO_FIRESTORE_RULES_AUTH_IAM_OR_ORIGINAL_FUNCTION_CHANGES/);
 assert.match(file,/NICO_JOINT_COUNT_RANKING_ENABLED=disabled/);
 assert.match(file,/protect-ranking-original-functions-versions.mjs before/);
 assert.match(file,/protect-ranking-original-functions-versions.mjs after/);
 assert.match(file,/owner-setup-live-region-metadata.mjs before/);
 assert.match(file,/owner-setup-live-region-metadata.mjs after/);
 assert.match(file,/--only "\$TARGETS"/);
 assert.match(file,/tools\/hosting\/release-owner-setup-additive.mjs --dry-run/);
 assert.match(file,/tools\/hosting\/release-owner-setup-additive.mjs --release/);
 assert.match(file,/ELEVEN_OWNER_STATIC_ASSETS_VERIFIED_OFFICIAL_URL/);
 assert.doesNotMatch(file,/--only hosting|--only firestore|firebase deploy.*--force/);
 const steps=file.split("\n      - name: ");
 for(const step of steps){
  const deploy=step.includes("firebase deploy ")||
    step.includes("release-owner-setup-additive.mjs --release");
  if(deploy)assert.match(step,/if: \$\{\{ steps.gate.outputs.approved == 'true'/,
   "any actual remote write step must require manually approved output");
 }
});
test("preserves exact expected original Rules, count source, Owner Functions and private key handling",()=>{
 assert.match(file,/d9f4df6a2ac0f8b5720534a2461ec66b94379190/);
 assert.match(file,/614f3216e008642ddf5eda6b93c35cc0469557c3/);
 assert.match(file,/54855609e372ee1056b5206e445f20c0a251b1ef/);
 assert.match(file,/secrets.FIREBASE_SERVICE_ACCOUNT_JSON/);
 assert.match(file,/rm -f "\$RUNNER_TEMP\/owner-approved-release.private.json"/);
 assert.match(file,/STOP_OWNER_SIX_PARTIAL_DEPLOY_NO_RETRY/);
});
