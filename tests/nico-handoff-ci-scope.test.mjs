import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workflow=readFileSync(new URL("../.github/workflows/nico-real-handoff-emulator-only.yml",import.meta.url),"utf8");

test("handoff emulator does not run for unrelated backup, billing or catalog PRs",()=>{
 const head=workflow.slice(0,workflow.indexOf("permissions:"));
 assert.match(head,/pull_request:\s*\n\s*branches: \[main\]\s*\n\s*paths:/);
 for(const name of [
  "tests/partner-secondary-primary-handoff-staging.test.cjs",
  "tests/nico-handoff-ci-scope.test.mjs",
  ".github/workflows/nico-real-handoff-emulator-only.yml",
  "docs/PARTNER_PRIMARY_HANDOFF_EXACT_EMULATOR_20261107.md"
 ])assert(head.includes("'"+name+"'"));
 assert(!head.includes("staging/**"));
 assert(!head.includes("firestore.rules"));
 assert(!head.includes("tests/**"));
});
test("handoff never stays tied to main commit 9632ea from previous month while checking only exact changed files",()=>{
 assert.match(workflow,/git fetch --no-tags origin main/);
 assert.match(workflow,/git merge-base HEAD origin\/main/);
 assert.match(workflow,/git diff --name-only origin\/main\.\.\.HEAD/);
 assert.doesNotMatch(workflow,/9632ea4bc063f165e0197a65f068e6d4529c4410/);
 assert.match(workflow,/test -s \/tmp\/handoff-changes/);
 assert.match(workflow,/HANDOFF_UNREVIEWED_SOURCE/);
 assert.match(workflow,/git diff --exit-code origin\/main HEAD -- firestore\.rules index\.html/);
});
test("the handoff job remains demo-emulator only without live credentials or deployments",()=>{
 for(const field of [
  'FIREBASE_PROJECT_ID: demo-nico-secondary-handoff',
  'GCLOUD_PROJECT: demo-nico-secondary-handoff',
  'FIREBASE_SERVICE_ACCOUNT_JSON: ""',
  'GOOGLE_APPLICATION_CREDENTIALS: ""',
  'node --test --test-concurrency=1',
  "LIVE_PARTNER_USER_FINANCE_GET_LIST_PROVED=false",
  "PRODUCTION_DEPLOYED=false"
 ])assert(workflow.includes(field),field);
 assert.doesNotMatch(workflow,/firebase deploy|gh workflow run|cloudfunctions\.net/);
});
