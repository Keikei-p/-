import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const hosting=readFileSync(".github/workflows/nico-factory-sync.yml","utf8");
const rules=readFileSync(".github/workflows/firebase-production-deploy.yml","utf8");
const doc=readFileSync("docs/SALES_SAFE_CUTOVER.md","utf8");
test("hosting deploy is manual and main+confirmation only, never auto on push",()=>{
  assert.match(hosting,/workflow_dispatch:\s*\n\s+inputs:/);
  assert.doesNotMatch(hosting,/\n  push:\s*\n/);
  assert.match(hosting,/github\.ref == 'refs\/heads\/main'/);
  assert.match(hosting,/inputs\.release_confirmation == 'CONFIRM_NICO_HOSTING_RELEASE'/);
  assert.match(hosting,/if:\s*\$\{\{[^\n]*release_confirmation[^\n]*\}\}/);
});
test("hosting deploy includes static assets only and checks NICO canonical domain",()=>{
  assert.match(hosting,/firebase deploy --only hosting/);
  assert.doesNotMatch(hosting,/--only firestore/);
  assert.match(hosting,/HOSTING_SITE_ID: nico-factory/);
  assert.match(hosting,/https:\/\/nico-factory\.web\.app\//);
  assert.doesNotMatch(hosting,/keikei-p\.github\.io/);
});
test("rules deployment separately requires main and NICO-only approval",()=>{
  assert.doesNotMatch(rules,/\n  push:\s*\n/);
  assert.match(rules,/workflow_dispatch:/);
  assert.match(rules,/github\.ref == 'refs\/heads\/main'/);
  assert.match(rules,/VERIFIED_NICO_URL_AND_DATA/);
  assert.match(rules,/firebase deploy --only firestore:rules/);
  assert.doesNotMatch(rules,/firebase deploy --only firestore:indexes/);
});
test("canonical release does not change Firestore history and old URL no longer required",()=>{
  assert.match(doc,/正式運用URLは https:\/\/nico-factory\.web\.app\//);
  assert.match(doc,/本番Firestore変更はこのPRでは一切行わない/);
  assert.doesNotMatch(doc,/両URLは一つ|双方継続/);
});
