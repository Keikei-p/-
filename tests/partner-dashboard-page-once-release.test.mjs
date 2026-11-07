import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const s=readFileSync(new URL("../.github/workflows/nico-partner-dashboard-page-once-20261108.yml",import.meta.url),"utf8");
test("one-shot release is main+exact marker only and isolated from PR checks",()=>{
 assert.match(s,/github\.event_name == 'push'/);
 assert.match(s,/github\.repository == 'Keikei-p\/-'/);
 assert.match(s,/github\.ref == 'refs\/heads\/main'/);
 assert.match(s,/startsWith\(github\.event\.head_commit\.message/);
 assert.match(s,/release: partner dashboard count-only page 20261108/);
 assert.match(s,/needs\.offline\.result == 'success'/);
 assert.match(s,/persist-credentials: false/);
 assert.doesNotMatch(s,/continue-on-error: true/);
});
test("frozen canonical app and money/count backend are verified before credentials",()=>{
 const begin=s.indexOf("Reject changed main SHA");
 const identity=s.indexOf("FIREBASE_SERVICE_ACCOUNT_JSON: ");
 assert.ok(begin>0&&identity>begin);
 for(const str of ["git hash-object partner-workspace.html","git hash-object index.html",
  "git hash-object firestore.rules","git hash-object functions/index.js",
  "git hash-object functions-partner-workspace/index.js",
  "git hash-object functions-partner-workspace/service.cjs"])
  assert.ok(s.includes(str),str);
 assert.match(s,/test "\$GITHUB_SHA" = "\$\(gh api repos\/Keikei-p\/-\/branches\/main/);
});
test("only existing one-page Firebase Hosting release tool can write",()=>{
 assert.match(s,/surgical-existing-partner-workspace\.mjs --dry-run/);
 assert.match(s,/surgical-existing-partner-workspace\.mjs --release/);
 assert.match(s,/sites\/nico-factory\/versions\/9dfdf2000344c040 \/ 13/);
 assert.match(s,/BLOCK_LIVE_HOSTING_SOURCE_CHANGED/);
 assert.match(s,/LIVE_THIRTEEN_FILE_SNAPSHOT_VERIFIED_TWELVE_PRESERVED/);
 assert.match(s,/cmp -s "\$RUNNER_TEMP\/nico-live-partner-dashboard\.private\.html" partner-workspace\.html/);
 assert.doesNotMatch(s,/firebase deploy|gcloud (?:functions|run) deploy|firebase deploy --force|--only firestore|--only functions|DELETE \/|PATCH \/|\/releases:rollback/);
});
test("counts API and anonymous access must be verified before Hosting writes",()=>{
 const stage=s.indexOf("Verify FOUR original count-only callables");
 const unauth=s.indexOf("Confirm anonymous user cannot use any of the four count APIs");
 const release=s.indexOf("Publish EXACT one reviewed partner HTML");
 assert.ok(stage>0&&unauth>stage&&release>unauth);
 for(const str of ["FOUR_COUNT_FUNCTION_METADATA_PRESENT_ACTIVE_ENABLED_NO_BUILD",
  "x.activeState!==1","x.expectedCodebase!==1","x.workspaceFlagEnabled!==1",
  "BLOCK_ANONYMOUS_COUNT_CALLABLE_NOT_VERIFIED","ANONYMOUS_COUNT_CALLABLES_DENIED_ALL_FOUR"])
  assert.ok(s.includes(str),str);
 assert.match(s,/!\[401,403\]\.includes\(res\.status\)/);
 assert.match(s,/REAL_MEMBER_COUNT_SAVE_AND_FINANCE_DENIAL_STILL_REQUIRE_PROOF/);
});
test("private runtime logs never uploaded or printed and no finance/token leak required",()=>{
 assert.match(s,/NICO_PARTNER_RELEASE_CONFIRMATION: CONFIRM_REPLACE_PARTNER_WORKSPACE_ONLY/);
 assert.match(s,/rm -f "\$RUNNER_TEMP\/nico-dashboard-release.private.json"/);
 assert.doesNotMatch(s,/upload-artifact|cat "\$RUNNER_TEMP\/nico-dashboard-functions|echo "\$FIREBASE_SERVICE_ACCOUNT_JSON"/);
});
