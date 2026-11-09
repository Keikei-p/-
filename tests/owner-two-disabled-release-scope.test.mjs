import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TARGETS,exactDeploymentTarget,verifyDisabledDeployment,inspectReviewedSource}
 from "../tools/production/owner-two-disabled-release-scope.mjs";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const item=(name,patch={})=>({
 id:"projects/"+PROJECT+"/locations/"+REGION+"/functions/"+name,
 platform:"gcfv2",projectId:PROJECT,region:REGION,
 codebase:"hub-owner-correction-v3",state:"ACTIVE",
 environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:"disabled"},
 ...patch
});
const initial={result:[item("getPartnerWorkspace",{codebase:"partner-workspace"})]};
const after={result:[...initial.result,item("listHubPartnerCounts"),item("correctHubPartnerCounts")]};
const copy=x=>JSON.parse(JSON.stringify(x));
test("exact 2 new disabled Tokyo Gen2 callable functions preserve all earlier functions",()=>{
 assert.equal(TARGETS.length,2);
 assert.equal(exactDeploymentTarget(TARGETS.join(",")),TARGETS.join(","));
 const report=verifyDisabledDeployment(initial,after);
 assert.equal(report.exactTwoAdditiveFunctions,true);
 assert.equal(report.featureFlagDisabled,true);
 assert.equal(report.allPreviousFunctionIdsStillListed,true);
 assert.equal(report.countCorrectionsProductionEnabled,false);
 assert.equal(report.dataWrites,0);
 assert.throws(()=>exactDeploymentTarget("functions:legacy:delete"),/STOP_OWNER_TWO_DISABLED_TARGET/);
});
test("unexpected function, wrong project, region, codebase, gen, activation or duplicate stops",()=>{
 const scenarios=[
  {result:[...initial.result,item("listHubPartnerCounts")]},
  {result:[...after.result,item("deleteRawSales")]},
  {result:after.result.filter(x=>!x.id.endsWith("/getPartnerWorkspace"))},
  {result:[...initial.result,item("listHubPartnerCounts",{region:"us-central1"}),item("correctHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts",{projectId:"another-project"}),item("correctHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts",{codebase:"default"}),item("correctHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts",{platform:"gcfv1"}),item("correctHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts",{state:"FAILED"}),item("correctHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts",{environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:"enabled"}}),item("correctHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts"),item("listHubPartnerCounts")]},
  {result:[...initial.result,item("listHubPartnerCounts",{environmentVariables:{}}),item("correctHubPartnerCounts")]}
 ];
 for(const sample of scenarios)assert.throws(()=>verifyDisabledDeployment(initial,sample),
  /STOP_OWNER_TWO_DISABLED_/);
 const pre=copy(initial);
 pre.result.push(item("listHubPartnerCounts"));
 assert.throws(()=>verifyDisabledDeployment(pre,after),/STOP_OWNER_TWO_DISABLED_OWNER_FUNCTION_ALREADY_EXISTS/);
});
test("source exact two, Tokyo, zero minimum, max 2, default disabled, CORS restricted",()=>{
 const index=readFileSync(new URL("../staging/partner-owner-correction-v3/entry.cjs",import.meta.url),"utf8");
 const config=readFileSync(new URL("../staging/partner-owner-correction-v3/firebase.owner-correction.json",import.meta.url),"utf8");
 assert.equal(inspectReviewedSource({index,config}),true);
 for(const changed of [
  index.replace('minInstances:0','minInstances:1'),
  index.replace('maxInstances:2','maxInstances:50'),
  index.replace('region:"asia-northeast1"','region:"us-central1"'),
  index.replace('HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled"','true'),
  index+'\nexports.deleteAllSales=()=>{};'
 ])assert.throws(()=>inspectReviewedSource({index:changed,config}),/STOP_OWNER_TWO_DISABLED_/);
});
test("release workflow is commit-pinned, one-shot, additive and has no Firestore/Hosting/Rules deployment",()=>{
 const wf=readFileSync(new URL("../.github/workflows/nico-owner-two-disabled-release.yml",import.meta.url),"utf8");
 assert.match(wf,/github\.event_name == 'push'/);
 assert.match(wf,/startsWith\(github\.event\.head_commit\.message, 'release: owner correction v3 disabled 20261109'/);
 assert.match(wf,/needs\.offline\.result == 'success'/);
 assert.match(wf,/--only "\$TARGET"/);
 assert.match(wf,/HUB_OWNER_COUNT_CORRECTION_V3_ENABLED=disabled/);
 assert.match(wf,/prepare-hub-owner-correction-v3-package\.mjs --prepare/);
 assert.match(wf,/protect-ranking-original-functions-versions\.mjs before/);
 assert.match(wf,/protect-ranking-original-functions-versions\.mjs after/);
 assert.match(wf,/test "\$GITHUB_SHA" = "\$\(gh api repos\/Keikei-p\/-\/branches\/main --jq \.commit\.sha\)"/);
 assert.match(wf,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.match(wf,/test "\$\(git hash-object functions\/index\.js\)"/);
 assert.doesNotMatch(wf,/firebase deploy --only firestore|firebase deploy --only hosting|firestore:delete|--force|--only functions:partner-workspace/);
 assert.doesNotMatch(wf,/upload-artifact/);
});
