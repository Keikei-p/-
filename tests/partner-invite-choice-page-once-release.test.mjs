import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const yaml=readFileSync(new URL("../.github/workflows/nico-partner-invite-choice-page-once-20261108.yml",import.meta.url),"utf8");
const page=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");

test("only an audited merge to current main can trigger the one-time page release",()=>{
 for(const s of [
  "github.event_name == 'push'",
  "github.repository == 'Keikei-p/-'",
  "github.ref == 'refs/heads/main'",
  "release: partner invite explicit choice page 20261108",
  "needs.offline.result == 'success'",
  "BLOCK_UNREVIEWED_RELEASE_COMMIT_SCOPE",
  "test \"$GITHUB_SHA\" = \"$(git rev-parse HEAD)\"",
  "test \"$GITHUB_SHA\" = \"$(gh api repos/Keikei-p/-/branches/main"
 ])assert.ok(yaml.includes(s),s);
 assert.match(yaml,/startsWith\(github\.event\.head_commit\.message/);
 assert.doesNotMatch(yaml,/continue-on-error: true/);
});

test("never replace page if live source differs from known deployed eleven-card old HTML",()=>{
 for(const s of [
  "git show a271cef8411874d1f0467f83689d798140c945b9:partner-workspace.html",
  "145fd8a1f3aaa9239c029d82ce97f602154cd819",
  "00d6d503f9061dba2b6113e52b99cb9c4ea3aedf",
  "STOP_UNREVIEWED_LIVE_WORKSPACE_HTML",
  "BLOCK_LIVE_HOSTING_MANIFEST_CHANGED",
  "BLOCK_UNREVIEWED_RELEASE_COMMIT_SCOPE",
  "sites/nico-factory/versions/[A-Za-z0-9_-]+ / 13",
  "LIVE_THIRTEEN_FILE_SNAPSHOT_VERIFIED_TWELVE_PRESERVED",
  "steps.live_state.outputs.already_live != 'true'"
 ])assert.ok(yaml.includes(s),s);
 assert.match(yaml,/cmp -s "\$RUNNER_TEMP\/nico-invite-choice-live-before\.private\.html" "\$RUNNER_TEMP\/nico-invite-choice-previous\.private\.html"/);
 assert.equal((yaml.match(/if: \$\{\{ steps\.live_state\.outputs\.already_live/g)||[]).length,6);
});

test("protect real original app, Functions, Rules, original price/revenue, count form and dashboard",()=>{
 for(const s of [
  "git hash-object index.html",
  "git hash-object firestore.rules",
  "git hash-object functions/index.js",
  "git hash-object functions-partner-workspace/index.js",
  "git hash-object functions-partner-workspace/service.cjs",
  "node --test tests/partner-dashboard-self-app-count-parity.test.mjs",
  "node --test tests/partner-invite-resend-and-accept.test.cjs",
  "tests/partner-workspace.test.cjs",
  "tests/internal-owner-finance-visibility.test.cjs",
  "FOUR_COUNT_FUNCTION_METADATA_PRESENT_ACTIVE_ENABLED_NO_BUILD",
  "ANONYMOUS_COUNT_CALLABLES_DENIED_ALL_FOUR"
 ])assert.ok(yaml.includes(s),s);
 assert.match(page,/id="transferExistingInternal" name="joinMembershipMode" type="radio"/);
 assert.match(page,/id="keepInternalMembership" name="joinMembershipMode" type="radio"/);
 assert.doesNotMatch(page,/type="checkbox" checked/);
 assert.match(page,/if\(!window\.confirm\(warning\)\)return/);
});

test("single HTML Hosting publish is the only remote write and requires full parity",()=>{
 const publish=yaml.indexOf("Publish EXACT one reviewed partner HTML");
 const probe=yaml.indexOf("Confirm live Hosting source version");
 const functions=yaml.indexOf("Verify FOUR original count-only callables");
 const anonymous=yaml.indexOf("Confirm anonymous user cannot use");
 const live=yaml.indexOf("Verify exact previous 11-card HTML");
 const credentials=yaml.indexOf("Configure existing protected audit identity");
 assert.ok(live>0&&credentials>live);
 assert.ok(publish>probe&&probe>functions&&functions>credentials);
 assert.ok(publish>anonymous&&anonymous>functions);
 for(const s of [
  "surgical-existing-partner-workspace.mjs --dry-run",
  "surgical-existing-partner-workspace.mjs --release",
  "cmp -s \"$RUNNER_TEMP/nico-live-partner-dashboard.private.html\" partner-workspace.html",
  "REAL_MEMBER_COUNT_SAVE_AND_FINANCE_DENIAL_STILL_REQUIRE_PROOF"
 ])assert.ok(yaml.includes(s),s);
 assert.doesNotMatch(yaml,/firebase deploy|gcloud (?:functions|run) deploy|firebase deploy --force|--only firestore|--only functions|recursiveDelete|upload-artifact/);
});

test("secrets and production values are never printed or uploaded",()=>{
 assert.match(yaml,/FIREBASE_SERVICE_ACCOUNT_JSON: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT_JSON \}\}/);
 assert.match(yaml,/rm -f "\$RUNNER_TEMP\/nico-invite-choice-previous\.private\.html"/);
 assert.match(yaml,/nico-invite-choice-release\.private\.json/);
 assert.doesNotMatch(yaml,/echo "\$FIREBASE_SERVICE_ACCOUNT_JSON"|cat "\$RUNNER_TEMP\/nico-invite-choice-functions/);
});
