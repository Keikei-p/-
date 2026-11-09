import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyRankingMetadata,PROJECT,REGION,FUNCTION,CODEBASE}
 from "../tools/production/inspect-ranking-function-cli-readonly.mjs";
const full="projects/"+PROJECT+"/locations/"+REGION+"/functions/"+FUNCTION;
const row=(extra={})=>({
 id:full,platform:"gcfv2",state:"ACTIVE",codebase:CODEBASE,
 serviceConfig:{environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:"disabled"}},
 ...extra
});
test("missing new API is a blocker, not a successful production deployment",()=>{
 const r=classifyRankingMetadata({result:[]});
 assert.equal(r.listed,false);
 assert.equal(r.matchingInventoryRows,0);
 assert.equal(r.safeToClaimDisabledDeployment,false);
 assert.equal(r.firebaseDeploys,0);
 assert.equal(r.safeToClaimLiveRankings,false);
});
test("correct Tokyo active Gen2 Function with explicit OFF flag is metadata-only proof",()=>{
 const r=classifyRankingMetadata({result:[row(),{
  id:"projects/"+PROJECT+"/locations/"+REGION+"/functions/submitPartnerQuickCounts",
  privateServiceAccount:"do_not_print"
 }]});
 assert.equal(r.listed,true);
 assert.equal(r.exactRegionActiveGen2Codebase,true);
 assert.equal(r.featureFlagExplicitlyDisabled,true);
 assert.equal(r.safeToClaimDisabledDeployment,true);
 assert.equal(r.serverFinanceAccessProven,false);
 assert.equal(r.realAccountCountCorrectionProven,false);
 assert.equal(r.originalFunctionInvocations,0);
 assert.equal(r.firestoreDocumentWrites,0);
 assert.equal(JSON.stringify(r).includes("do_not_print"),false);
});
test("unknown region, other project, wrong codebase, Gen1, failed state cannot pass",()=>{
 for(const edit of [
  {id:FUNCTION,region:undefined,codebase:CODEBASE},
  {id:full.replace(PROJECT,"another-project")},
  {id:full.replace(REGION,"us-central1")},
  {codebase:"partner-workspace"},
  {platform:"gcfv1"},
  {state:"FAILED"},
  {status:"ACTIVE",state:"DEPLOYING"},
  {id:FUNCTION,region:REGION,projectId:PROJECT,codebase:CODEBASE,platform:"gcfv2",state:"ACTIVE"}
 ]){
  const r=classifyRankingMetadata({result:[row(edit)]});
  if(edit.id===FUNCTION&&edit.region===REGION&&edit.projectId===PROJECT)
   assert.equal(r.safeToClaimDisabledDeployment,true);
  else assert.equal(r.safeToClaimDisabledDeployment,false);
  assert.equal(r.safeToClaimLiveRankings,false);
 }
});
test("missing flag never implies OFF and accidentally enabled flag is visible only as boolean",()=>{
 const noFlag=classifyRankingMetadata({result:[row({
  serviceConfig:{environmentVariables:{PRIVATE_KEY:"never_echo_me"}}
 })]});
 assert.equal(noFlag.featureFlagKnown,false);
 assert.equal(noFlag.safeToClaimDisabledDeployment,false);
 const enabled=classifyRankingMetadata({result:[row({
  environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:"enabled",
   FIREBASE_SECRET:"must_not_leak"}
 })]});
 assert.equal(enabled.featureFlagEnabled,true);
 assert.equal(enabled.safeToClaimDisabledDeployment,false);
 assert.equal(JSON.stringify(enabled).includes("must_not_leak"),false);
});
test("ambiguous duplicate, malformed entries, or partial list cannot certify release",()=>{
 const duplicate=classifyRankingMetadata({result:[row(),row()]});
 assert.equal(duplicate.matchingInventoryRows,2);
 assert.equal(duplicate.safeToClaimDisabledDeployment,false);
 for(const bad of [
  {},null,{result:null},{result:[null]},
  {result:[{id:""}]},{result:[{id:42}]},
  {result:[{name:"x".repeat(600)}]},
  {result:[],nextPageToken:"hidden"}
 ])
  assert.throws(()=>classifyRankingMetadata(bad),
   /STOP_RANKING_CLI_METADATA_/);
});
test("existing GitHub Actions workflow is GET-only, no production deploy or secrets logged",()=>{
 const w=readFileSync(new URL("../.github/workflows/nico-four-count-cli-region-readonly-20261108.yml",import.meta.url),"utf8");
 assert.match(w,/firebase functions:list --project/);
 assert.match(w,/inspect-ranking-function-cli-readonly\.mjs/);
 assert.match(w,/node --test tests\/inspect-ranking-function-cli-readonly\.test\.mjs/);
 assert.match(w,/firestore\.rules/);
 assert.doesNotMatch(w,/firebase deploy|gcloud functions deploy|firebase functions:delete|firebase firestore:delete/);
 assert.match(w,/Destroy private identity and metadata outputs/);
});
