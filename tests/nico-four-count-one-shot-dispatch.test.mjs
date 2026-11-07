import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const wf=readFileSync(new URL("../.github/workflows/nico-four-count-one-shot-dispatch-20261108.yml",import.meta.url),"utf8");

test("one-shot dispatcher has no direct production or billing writes",()=>{
  assert.match(wf,/name: NICO reviewed one-time four count Functions dispatcher/);
  assert.match(wf,/github\.event_name == 'push'/);
  assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
  assert.match(wf,/github\.repository == 'Keikei-p\/-'/);
  assert.match(wf,/startsWith\(github\.event\.head_commit\.message,/);
  assert.match(wf,/needs\.offline\.result == 'success'/);
  assert.match(wf,/persist-credentials: false/);
  assert.match(wf,/actions: write/);
  assert.doesNotMatch(wf,/firebase deploy|gcloud functions deploy|firebase deploy --force|firestore:rules|firebase use/);
});
test("it dispatches ONLY existing reviewed four-count workflow with strict approvals",()=>{
  assert.match(wf,/gh workflow run "\$workflow" --repo "\$repo" --ref main/);
  assert.match(wf,/workflow='nico-partner-four-count-functions-manual\.yml'/);
  assert.match(wf,/reviewed_main_sha="\$GITHUB_SHA"/);
  assert.match(wf,/CONFIRM_FOUR_COUNT_FUNCTIONS_ONLY/);
  assert.match(wf,/FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED/);
  assert.match(wf,/NO_FIRESTORE_RULES_CHANGES/);
  assert.match(wf,/test "\$GITHUB_SHA" = "\$\(gh api repos\/Keikei-p\/-\/branches\/main/);
  assert.match(wf,/gh run watch "\$observed" --repo "\$repo" --exit-status/);
  assert.match(wf,/BLOCK_GUARDED_FOUR_DEPLOY_NOT_VERIFIED/);
});
test("immutable original financial sources and original function tests remain mandatory",()=>{
  for(const needle of [
    "tests/partner-workspace.test.cjs",
    "tests/protect-original-functions-versions.test.mjs",
    "tests/partner-four-function-release-scope.test.mjs",
    "git hash-object firestore.rules",
    "git hash-object functions/index.js",
    "git hash-object functions-partner-workspace/index.js",
    "git hash-object functions-partner-workspace/service.cjs",
    "git hash-object firebase.partner-workspace.json"
  ]) assert.ok(wf.includes(needle),needle);
  assert.match(wf,/REAL_PARTNER_COUNT_INPUT_AND_FINANCE_DENIAL_NOT_YET_VERIFIED/);
});
