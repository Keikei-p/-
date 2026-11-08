import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TARGETS,NAMES,ensureExactOnly,inspectSource} from
 "../tools/production/partner-four-function-release-scope.mjs";
const src=readFileSync(new URL(
 "../.github/workflows/nico-existing-four-count-update-once.yml",
 import.meta.url),"utf8");
const cfg=readFileSync(new URL("../firebase.partner-workspace.json",import.meta.url),"utf8");
const code=readFileSync(new URL("../functions-partner-workspace/index.js",import.meta.url),"utf8");
test("manual release updates exactly all four already-active trusted callable exports",()=>{
 assert.equal(TARGETS.length,4);
 assert.deepEqual([...NAMES].sort(),[
  "getPartnerWorkspace","submitPartnerWorkspaceCounts",
  "managePartnerWorkspace","acceptPartnerWorkspaceInvite"].sort());
 assert.equal(ensureExactOnly(TARGETS.join(",")),true);
 assert.equal(inspectSource(code,cfg),true);
 assert.match(src,/TARGETS="\$\(node -e/);
 assert.match(src,/ensureExactOnly\(process\.env\.TARGETS\)/);
 assert.match(src,/--config firebase\.partner-workspace\.json --only "\$TARGETS"/);
 assert.equal((src.match(/\bfirebase deploy\b/g)||[]).length,1);
 assert.doesNotMatch(src,/--force|--only firestore|firebase deploy --only hosting|firebase functions:delete|firebase deploy --only functions\b/);
});
test("no PR, non-main, wrong SHA or absent billing approval can run production job",()=>{
 assert.match(src,/workflow_dispatch:/);
 assert.match(src,/github\.event_name == 'workflow_dispatch'/);
 assert.match(src,/github\.repository == 'Keikei-p\/-'/);
 assert.match(src,/github\.ref == 'refs\/heads\/main'/);
 assert.match(src,/inputs\.reviewed_main_sha == github\.sha/);
 assert.match(src,/CONFIRM_UPDATE_EXISTING_FOUR_COUNT_FUNCTIONS_ONLY/);
 assert.match(src,/FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED/);
 assert.match(src,/needs\.offline\.result == 'success'/);
 assert.match(src,/concurrency:/);
 assert.match(src,/cancel-in-progress: false/);
 assert.match(src,/gh api repos\/Keikei-p\/-\/branches\/main/);
});
test("original financial source, history and all six original Functions are protected",()=>{
 assert.match(src,/d9f4df6a2ac0f8b5720534a2461ec66b94379190/);
 assert.match(src,/dfb4c48ada6fa89a24c898cd4a2f911bcede822f/);
 assert.match(src,/b94a6aba231dc2569009580a178297a5b6194bda/);
 assert.match(src,/38da7e9174ffea7c406c92292dccfc651b565eb0/);
 assert.match(src,/protect-original-functions-versions.mjs before/);
 assert.match(src,/protect-original-functions-versions.mjs after/);
 assert.match(src,/EXACT_FOUR_ALREADY_ACTIVE_SCOPED_TO_COUNT_CODEBASE/);
 assert.match(src,/EXACT_FOUR_EXISTING_COUNT_FUNCTIONS_ACTIVE_AFTER_UPDATE/);
 assert.match(src,/workspaceFlagEnabled!==1/);
 assert.match(src,/gen2Listed!==1/);
 assert.match(src,/count create\/correction survives/);
 assert.match(src,/secondary-finance-counts-integration-emulator\.test\.mjs/);
 assert.doesNotMatch(src,/functions-partner-workspace\/service\.cjs"?\s*>>/);
 assert.match(src,/REAL_ACCOUNT_COUNT_SAVE_AND_CORRECTION_STILL_REQUIRE_OWNER_VERIFICATION/);
});
test("CLI nonzero is never retried or reported as successful deployment",()=>{
 assert.match(src,/STOP_FOUR_UPDATE_CLI_NOT_CONFIRMED_CHECK_EXISTING_STATE_NO_AUTOMATIC_RETRY/);
 assert.match(src,/exit 1/);
 assert.match(src,/FOUR_COUNT_FUNCTION_UPDATE_CLI_SUCCESS/);
 assert.match(src,/if: always\(\)/);
 assert.match(src,/rm -f functions-partner-workspace\/\.env\.sales-management-cc116/);
 assert.doesNotMatch(src,/firebase deploy[^\n]*\|\|\s*true/);
});
