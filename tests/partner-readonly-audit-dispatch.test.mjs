import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflows=[
 "nico-live-partner-count-functions-audit.yml",
 "nico-original-partner-functions-audit.yml"
];
for(const file of workflows){
 const source=readFileSync(new URL("../.github/workflows/"+file,import.meta.url),"utf8");
 test(file+" permits opt-in read-only rechecks, with no PR secrets",()=>{
  assert.match(source,/^  workflow_dispatch:\s*$/m);
  assert.match(source,/github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(source,/github\.ref == 'refs\/heads\/main'/);
  assert.match(source,/github\.repository == 'Keikei-p\/-'/);
  assert.match(source,/needs\.offline\.result == 'success'/);
  assert.match(source,/permissions:\s*\n  contents: read/);
  const begin=source.indexOf("  offline:");
  const live=source.indexOf(file.startsWith("nico-live-")?"  live-metadata-only:":"  read-only-live:");
  assert.ok(begin>0&&live>begin);
  assert.doesNotMatch(source.slice(begin,live),/FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(source.slice(live),/FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(source,/(?:firebase deploy|functions:delete|firestore:delete|--force|method:\s*['"](?:POST|PATCH|PUT|DELETE)['"])/);
  assert.match(source,/GITHUB_SHA/);
  assert.match(source,/sales-management-cc116/);
  assert.match(source,/if: always\(\)/);
  assert.match(source,/node --test tests\/partner-readonly-audit-dispatch\.test\.mjs/);
 });
}
test("auditors inspect scoped function metadata without records or execution",()=>{
 for(const script of [
  "../tools/production/inspect-live-partner-callables-readonly.mjs",
  "../tools/production/inspect-original-partner-functions-readonly.mjs"
 ]){
  const source=readFileSync(new URL(script,import.meta.url),"utf8");
  assert.match(source,/method:'GET'/);
  assert.match(source,/safeToCutOver(?:Rules|FinanceRules):false/);
  assert.doesNotMatch(source,/firebase deploy|runTransaction\(|setDoc\(|updateDoc\(|deleteDoc\(/);
 }
});
