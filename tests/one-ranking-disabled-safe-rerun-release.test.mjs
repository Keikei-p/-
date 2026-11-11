import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const w=readFileSync(new URL("../.github/workflows/nico-one-ranking-disabled-safe-rerun-release.yml",import.meta.url),"utf8");
test("first main push never loads live identity or deploys, only explicit second attempt on exact SHA",()=>{
 assert.match(w,/GITHUB_RUN_ATTEMPT" = 1/);
 assert.match(w,/echo 'approved=false' >> "\$GITHUB_OUTPUT"/);
 assert.match(w,/GITHUB_RUN_ATTEMPT" = 2/);
 assert.match(w,/test "\$GITHUB_EVENT_NAME" = push/);
 assert.match(w,/test "\$GITHUB_REF" = refs\/heads\/main/);
 assert.match(w,/test "\$GITHUB_SHA" = "\$\(git rev-parse HEAD\)"/);
 assert.match(w,/test "\$GITHUB_SHA" = "\$\(gh api repos\/Keikei-p\/-\/branches\/main --jq \.commit\.sha\)"/);
 assert.match(w,/echo 'approved=true' >> "\$GITHUB_OUTPUT"/);
 assert.doesNotMatch(w,/workflow_dispatch|github\.event\.inputs/);
});
test("one NEW ranking Function, all setup and ranking flags OFF, originals preserved",()=>{
 for(const [name,value] of [
  ["APPROVED_SCOPE","EXACT_ONE_NEW_DISABLED_JOINT_RANKING_FUNCTION_ONLY"],
  ["APPROVED_USAGE","FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED"],
  ["RULES_APPROVAL","NO_RULES_HOSTING_AUTH_COUNTS_OR_FINANCE_CHANGES"]
 ]){
  assert.match(w,new RegExp("^          "+name+": "+value+"$","m"));
  assert.ok(w.includes('test "$'+name+'" = '+value));
 }
 assert.match(w,/ensureExactTarget\(process\.env\.TARGET\)/);
 assert.match(w,/getIds\(data\)/);
 assert.match(w,/STOP_RANKING_FUNCTION_ALREADY_PRESENT/);
 assert.match(w,/protect-ranking-original-functions-versions\.mjs before/);
 assert.match(w,/protect-ranking-original-functions-versions\.mjs after/);
 assert.match(w,/NICO_JOINT_COUNT_RANKING_ENABLED=disabled/);
 assert.match(w,/RANKING_FUNCTION_ANONYMOUS_503_VERIFIED_FEATURE_OFF/);
 assert.match(w,/RANKING_DEPLOY_FAILED_NO_AUTOMATIC_RETRY/);
 assert.equal((w.match(/firebase deploy --non-interactive/g)||[]).length,1);
 assert.match(w,/--config firebase\.ranking-approvals\.json --only "\$TARGET"/);
 assert.doesNotMatch(w,/firebase deploy --force|firestore:delete|auth:delete|--only hosting|--only firestore/);
});
test("all real credential/network/deploy steps are explicitly gated; cleanup always runs",()=>{
 const lines=w.split("\n"),scopes=[];
 for(let i=0;i<lines.length;i++){
  if(!lines[i].startsWith("      - name: "))continue;
  const name=lines[i].slice("      - name: ".length);
  if(name.startsWith("Manual approval")||name.startsWith("Remove temporary"))continue;
  scopes.push(name);
  assert.match(lines[i+1]||"",/if: \$\{\{ steps\.gate\.outputs\.approved == 'true'/,
    "unguarded operation: "+name);
 }
 assert(scopes.length>=10);
 assert.match(w,/if: always\(\)/);
 assert.match(w,/FIREBASE_SERVICE_ACCOUNT_JSON: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT_JSON \}\}/);
});
