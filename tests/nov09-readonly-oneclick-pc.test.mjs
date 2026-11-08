import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const script=get("tools/local/NICO_NOV09_LIVE_READONLY.ps1");
const workflows=[
 "nico-four-count-cli-region-readonly-20261108.yml",
 "nico-secondary-production-inventory-readonly.yml",
 "nico-managed-backup-restore-preflight-readonly.yml",
 "nico-partner-live-readonly-audit.yml"
];
test("one-click PC script may invoke only exact reviewed, main-scoped read-only workflows",()=>{
 assert.equal((script.match(/'nico-[\w-]+[.]yml'/g)||[]).length,4);
 for(const name of workflows){
  assert.equal(script.split("'"+name+"'").length,2,name);
  const yaml=get(".github/workflows/"+name);
  assert.match(yaml,/^  workflow_dispatch:\s*$/m,name);
  assert.match(yaml,/github\.ref == 'refs\/heads\/main'/m,name);
  if(name==="nico-secondary-production-inventory-readonly.yml")
    assert.match(yaml,/github\.event_name != 'pull_request'/m,name);
  else
    assert.match(yaml,/github\.event_name == 'workflow_dispatch'/m,name);
  assert.match(yaml,/^\s+contents: read\s*$/m,name);
  if(name.includes("secondary-production-inventory"))
    assert.match(yaml,/READ_ONLY/);
  if(name.includes("four-count-cli"))
    assert.match(yaml,/functions:list/);
 }
 assert.match(script,/gh workflow run \$wf --repo \$repo --ref main/);
 assert.match(script,/gh run watch \$job.RunId --repo \$repo --exit-status/);
 assert.match(script,/gh api "repos\/\$repo\/branches\/main"/);
});
test("PowerShell run does not execute deploy or destructive change even when all probes pass",()=>{
 for(const pattern of [
  /\bgh\s+workflow\s+run\s+[^]*?nico-partner-four-count-functions-manual/,
  /\bgh\s+api\s+-X\s+(?:POST|PATCH|PUT|DELETE)/i,
  /\b(?:firebase|gcloud|gsutil)\s+(?:deploy|delete|firestore:delete)/i,
  /\bRemove-Item\b/i,
  /\bSet-Content\b/i,
  /\bNew-Item\b/i,
  /\bInvoke-Expression\b/i,
  /\bIEX\b/,
  /\bgh\s+secret\b/i,
  /\bgh\s+auth\s+token\b/i,
  /\bgh\s+workflow\s+run\s+.*-(?:release|deploy)[.]yml/i
 ])assert.doesNotMatch(script,pattern);
 assert.match(script,/PRODUCTION_DOCUMENT_WRITES=0 RULES_APPLIED=NO FUNCTIONS_DEPLOYED=NO/);
 assert.match(script,/FINANCE|READ ONLY|READ_ONLY/);
 assert.match(script,/finance-boundary-four[.]html/);
 assert.match(script,/partner-workspace[.]html/);
});
test("read-only manual workflows do not expose privileged jobs in PR context",()=>{
 for(const name of workflows){
  const yaml=get(".github/workflows/"+name);
  assert.match(yaml,/pull_request:/);
  if(name==="nico-four-count-cli-region-readonly-20261108.yml")
    assert.match(yaml,/github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  if(name==="nico-partner-live-readonly-audit.yml"||
     name==="nico-managed-backup-restore-preflight-readonly.yml")
    assert.match(yaml,/github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(yaml,/\bfirebase deploy\b|\bfirestore:delete\b|curl\s+-X\s+PATCH/i);
 }
});
test("reviewed original monetary Rules and count Functions remain exactly pinned",()=>{
 const fs=get("firestore.rules"),index=get("functions-partner-workspace/index.js");
 assert.match(fs,/match \/products\/\{productId\}/);
 assert.match(fs,/match \/records\/\{recordId\}/);
 assert.match(index,/submitPartnerWorkspaceCounts/);
});
