import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workflow=readFileSync(new URL("../.github/workflows/nico-partner-quick-reviewed-once.yml",import.meta.url),"utf8");
const original=readFileSync(new URL("../.github/workflows/nico-partner-quick-release.yml",import.meta.url),"utf8");
test("one-shot auto release must require verified main parent, authenticated owner push and exact commit trigger",()=>{
 assert.match(workflow,/github\.repository == 'Keikei-p\/-'/);
 assert.match(workflow,/github\.actor == 'Keikei-p'/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/github\.event_name == 'push'/);
 assert.match(workflow,/EXPECTED_PARENT_SHA: b45daca1c98991d470074e1a87e01a3a7787abe4/);
 assert.match(workflow,/release: reviewed partner quick activation once/);
 assert.match(workflow,/git rev-parse HEAD\^/);
 assert.match(workflow,/UNREVIEWED_RELEASE_CHANGE/);
 assert.match(workflow,/git hash-object functions\/index\.js/);
 assert.match(workflow,/git hash-object functions\/partner-company-invitations\.cjs/);
});
test("only existing manually-gated quick release is dispatched; no Firebase secrets or database mutations from one-shot workflow",()=>{
 assert.match(workflow,/gh workflow run "\$workflow"/);
 assert.match(workflow,/workflow='nico-partner-quick-release\.yml'/);
 assert.match(workflow,/gh run watch "\$run" --repo "\$REPO" --exit-status/);
 assert.match(workflow,/validate\.result == 'success'/);
 assert.doesNotMatch(workflow,/firebase deploy|firestore:rules|--only firestore|FIREBASE_SERVICE_ACCOUNT_JSON|\bdeleteDoc\(|\bsetDoc\(/);
 assert.doesNotMatch(workflow,/nico-partner-full-sequenced-once\.yml|nico-partner-workspace-release\.yml/);
 assert.match(original,/github\.event_name == 'workflow_dispatch'/);
 assert.match(original,/steps\.count_page\.outputs\.already_live/);
});
test("postrelease confirms exact published count page, intact other routes, and rejects anonymous quick API calls",()=>{
 for(const str of ["partner-counts.html","partner-invite.html","partner-workspace.html",
  "submitPartnerQuickCounts","getPartnerQuickCounts","approvePartnerQuickCounts"]){
  assert.ok(workflow.includes(str),str);
 }
 assert.match(workflow,/cmp -s "\$RUNNER_TEMP\/partner-counts-live\.html" partner-counts\.html/);
 assert.match(workflow,/\[401,403\]\.includes\(response\.status\)/);
 assert.match(workflow,/REVIEWED_COUNTS_HTML_NOT_LIVE/);
});
