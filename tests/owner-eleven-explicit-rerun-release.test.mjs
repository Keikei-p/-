import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL(
 "../.github/workflows/nico-owner-eleven-explicit-rerun-release.yml",import.meta.url),"utf8");
test("hosting release cannot trigger on first push, PR or anything but a manual rerun",()=>{
 assert.match(source,/GITHUB_RUN_ATTEMPT" = 1/);
 assert.match(source,/GITHUB_RUN_ATTEMPT" = 2/);
 assert.match(source,/approved=false/);
 assert.match(source,/approved=true/);
 assert.match(source,/GITHUB_EVENT_NAME" = push/);
 assert.match(source,/GITHUB_REF" = refs\/heads\/main/);
 assert.match(source,/gh api repos\/Keikei-p\/-\/branches\/main/);
 assert.match(source,/release\(hosting\): approved manual rerun eleven Owner static assets/);
 assert.doesNotMatch(source,/pull_request_target/);
 assert.doesNotMatch(source,/\n  workflow_dispatch:/);
});
test("hosting-only exact source and active six owner functions proof are mandatory",()=>{
 assert.match(source,/CONFIRM_ONLY_ELEVEN_NEW_OWNER_SETUP_ASSETS/);
 assert.match(source,/HOSTING_OPERATIONS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED/);
 assert.match(source,/NO_FUNCTIONS_AUTH_FIRESTORE_RULES_CHANGES/);
 assert.match(source,/checkDeployedMetadata\(body.functions/);
 assert.match(source,/release-owner-setup-additive.mjs --dry-run/);
 assert.match(source,/release-owner-setup-additive.mjs --release/);
 assert.match(source,/OFFICIAL_OWNER_SETUP_ELEVEN_STATIC_ASSETS_VERIFIED/);
 assert.match(source,/d9f4df6a2ac0f8b5720534a2461ec66b94379190/);
 assert.match(source,/614f3216e008642ddf5eda6b93c35cc0469557c3/);
 assert.match(source,/secrets.FIREBASE_SERVICE_ACCOUNT_JSON/);
 assert.doesNotMatch(source,/firebase deploy|--only firestore|--only functions|firebase auth:|firebase firestore:/);
 const step=source.split("\n      - name: ").find(x=>
  x.includes("release-owner-setup-additive.mjs --release"));
 assert.match(step,/if: \$\{\{ steps.approval.outputs.approved == 'true' && success\(\) \}\}/);
});
