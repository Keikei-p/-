import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../.github/workflows/nico-owner-six-safe-rerun-release.yml",import.meta.url),"utf8");
test("the first push always performs TESTS ONLY; second attempt is explicitly tied to current main",()=>{
 assert.match(src,/GITHUB_RUN_ATTEMPT" = 1/);
 assert.match(src,/echo 'approved=false' >> "\$GITHUB_OUTPUT"/);
 assert.match(src,/GITHUB_RUN_ATTEMPT" = 2/);
 assert.match(src,/GITHUB_EVENT_NAME" = push/);
 assert.match(src,/GITHUB_REF" = refs\/heads\/main/);
 assert.match(src,/GITHUB_SHA" = "\$\(git rev-parse HEAD\)"/);
 assert.match(src,/gh api repos\/Keikei-p\/-\/branches\/main --jq \.commit\.sha/);
 assert.match(src,/echo 'approved=true' >> "\$GITHUB_OUTPUT"/);
 assert.doesNotMatch(src,/workflow_dispatch/);
});
test("approval constants match exactly and target six new Owner callables only",()=>{
 for(const [name,value] of [
  ["APPROVED_SCOPE","NEW_SIX_OWNER_SETTINGS_FUNCTIONS_ONLY_NO_RANKING"],
  ["APPROVED_USAGE","FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED"],
  ["RULES_APPROVAL","NO_RULES_HOSTING_AUTH_COUNT_OR_FINANCE_CHANGES"]
 ]){
  const env=src.match(new RegExp("^          "+name+": ([A-Z0-9_]+)$","m"));
  const check=src.match(new RegExp("test \\"\\$"+name+"\\" = ([A-Z0-9_]+)"));
  assert.ok(env,name+" env missing");
  assert.ok(check,name+" gate missing");
  assert.equal(env[1],value);
  assert.equal(check[1],value);
 }
 assert.match(src,/ensureExactTargets\(TARGETS\.join\(','\)\)/);
 assert.match(src,/assertAbsent\(JSON\.parse/);
 assert.match(src,/compareDeployment/);
 assert.match(src,/NICO_JOINT_COUNT_RANKING_ENABLED=disabled/);
 assert.match(src,/protect-ranking-original-functions-versions\.mjs before/);
 assert.match(src,/protect-ranking-original-functions-versions\.mjs after/);
 assert.match(src,/owner-setup-live-region-metadata\.mjs before/);
 assert.match(src,/owner-setup-live-region-metadata\.mjs after/);
 assert.match(src,/STOP_OWNER_SIX_DEPLOY_FAILED_NO_AUTOMATIC_RETRY/);
});
test("every cloud operation is gated by the second-attempt approval",()=>{
 for(const step of [
  "Pin exact current main commit and all six functions before credentials",
  "Install only official Firebase SDK and pinned CLI",
  "Configure existing service identity privately",
  "Snapshot original 6 and ALL existing Gen2; six new targets MUST be absent",
  "Enable only Owner setup, keep joint ranking GET disabled (temporary)",
  "Deploy exactly six NEW Owner callables, not ranking, Rules, Hosting or original Functions"
 ]){
  const start=src.indexOf("      - name: "+step+"\n");
  assert.ok(start>=0,"step missing: "+step);
  const body=src.slice(start,src.indexOf("\n      - name:",start+10));
  assert.match(body,/if: \$\{\{ steps\.gate\.outputs\.approved == 'true' \}\}/);
 }
 assert.equal((src.match(/firebase deploy --non-interactive/g)||[]).length,1);
 assert.match(src,/--config firebase\.ranking-approvals\.json --only "\$TARGETS"/);
 assert.doesNotMatch(src,/firebase deploy --force|--only hosting|--only firestore|firestore:delete|auth:delete|deleteUser\(/);
});
