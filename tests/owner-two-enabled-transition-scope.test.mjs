import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {beforeDisabled,afterEnabled,inspectActivation,TARGETS}
 from "../tools/production/owner-two-enabled-transition-scope.mjs";
const row=(name,flag="disabled",fields={})=>({
 id:"projects/sales-management-cc116/locations/asia-northeast1/functions/"+name,
 projectId:"sales-management-cc116",region:"asia-northeast1",codebase:"hub-owner-correction-v3",
 platform:"gcfv2",state:"ACTIVE",
 environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:flag},
 ...fields
});
const base={result:[row("getPartnerWorkspace","disabled",{codebase:"partner-workspace"}),
 row("listHubPartnerCounts"),row("correctHubPartnerCounts")]};
const active={result:[base.result[0],
 row("listHubPartnerCounts","enabled"),row("correctHubPartnerCounts","enabled")]};
test("the two exact Tokyo active owner Function flags can transition from disabled to enabled",()=>{
 assert.equal(TARGETS.length,2);
 assert.equal(beforeDisabled(base),true);
 assert.equal(afterEnabled(active),true);
 const status=inspectActivation(base,active);
 assert.equal(status.exactExistingTwoActivated,true);
 assert.equal(status.addedFunctions,0);
 assert.equal(status.ownerOnlyCountCallablesEnabled,true);
 assert.equal(status.realAccountCountCorrectionTested,false);
});
test("partially enabled, altered codebase, extra Function and original deletion are refused",()=>{
 const cases=[
  {result:[...active.result.slice(0,2),row("correctHubPartnerCounts")]},
  {result:[...active.result,row("unexpectedNewFunction")]},
  {result:active.result.slice(1)},
  {result:[active.result[0],row("listHubPartnerCounts","enabled",{codebase:"default"}),active.result[2]]},
  {result:[active.result[0],row("listHubPartnerCounts","enabled",{region:"us-central1"}),active.result[2]]},
  {result:[active.result[0],row("listHubPartnerCounts","enabled",{state:"FAILED"}),active.result[2]]}
 ];
 for(const sample of cases)assert.throws(()=>inspectActivation(base,sample),
  /STOP_OWNER_ENABLE_/);
 assert.throws(()=>inspectActivation(active,active),/STOP_OWNER_ENABLE_FLAG_TRANSITION/);
});
test("release gate uses existing codebase, exact original pins and verifies both flags",()=>{
 const wf=readFileSync(new URL("../.github/workflows/nico-owner-two-enable-release.yml",import.meta.url),"utf8");
 assert.match(wf,/startsWith\(github\.event\.head_commit\.message, 'release: owner correction v3 enable 20261109'/);
 assert.match(wf,/needs\.offline\.result == 'success'/);
 assert.match(wf,/HUB_OWNER_COUNT_CORRECTION_V3_ENABLED=enabled/);
 assert.match(wf,/prepare-hub-owner-correction-v3-package\.mjs --prepare/);
 assert.match(wf,/protect-ranking-original-functions-versions\.mjs before/);
 assert.match(wf,/protect-ranking-original-functions-versions\.mjs after/);
 assert.match(wf,/inspectActivation\(before,after\)/);
 assert.match(wf,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.doesNotMatch(wf,/firebase deploy --only hosting|firebase deploy --only firestore|--force|firestore:delete|upload-artifact/);
 assert.match(wf,/NO_RETRY_IF_FIREBASE_CLI_REPORTS_ERROR/);
});
