import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {NEW,TARGETS,PROJECT,REGION,EXPECTED_FLAGS,ensureExactTargets,
 inspectIsolatedSource,assertAbsent,compareDeployment,checkDeployedMetadata}
 from "../tools/production/owner-setup-six-release-scope.mjs";
const root="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const old={result:[
 {id:root+"getPartnerWorkspace",region:REGION},
 {id:root+"submitPartnerWorkspaceCounts",region:REGION},
 {id:root+"acceptPartnerWorkspaceInvite",region:REGION}
]};
const out={result:[...old.result,...NEW.map(n=>({id:root+n,region:REGION}))]};
const currentIndex=readFileSync(new URL("../functions-ranking-approvals/index.js",import.meta.url),"utf8");
const currentConfig=readFileSync(new URL("../firebase.ranking-approvals.json",import.meta.url),"utf8");
const meta=n=>({
 name:root+n,state:"ACTIVE",buildConfig:{entryPoint:n,runtime:"nodejs22"},
 serviceConfig:{uri:"https://private.a.run.app",environmentVariables:{...EXPECTED_FLAGS}}
});
test("actual reviewed isolated codebase exports only the exact six plus disabled ranking",()=>{
 assert.equal(inspectIsolatedSource(currentIndex,currentConfig),true);
 assert.equal(NEW.length,6);
 assert.equal(TARGETS.length,6);
 assert.equal(ensureExactTargets(TARGETS.join(",")),true);
 for(const suffix of ["getVerifiedJointCountRanking","getPartnerWorkspace","deleteUser"]){
  assert(!TARGETS.join(",").includes(":"+suffix));
  assert.throws(()=>ensureExactTargets(TARGETS.join(",")+","+
   "functions:ranking-owner-approvals:"+suffix),/STOP_OWNER_SIX_RELEASE_TARGET_MISMATCH/);
 }
 assert.throws(()=>inspectIsolatedSource(currentIndex.replace(
  'process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"','true'),currentConfig),
  /STOP_OWNER_SIX_RELEASE_FEATURE_FLAG_DRIFT/);
 assert.throws(()=>inspectIsolatedSource(
  currentIndex.replace("exports.getOwnerProductVisibility=onCall",
   "exports.getOwnerProductVisibility=onRequest"),currentConfig),
  /STOP_OWNER_SIX_RELEASE_FUNCTION_EXPORT_DRIFT/);
});
test("before deploy must contain zero new Owner Functions",()=>{
 assert.equal(assertAbsent(old).targetsAbsent,true);
 assert.throws(()=>assertAbsent(out),/STOP_OWNER_SIX_RELEASE_TARGET_ALREADY_EXISTS/);
 assert.throws(()=>assertAbsent({result:[...old.result,old.result[0]]}),
  /STOP_OWNER_SIX_RELEASE_INVENTORY_INVALID/);
});
test("after deploy keeps all originals and adds exactly six new functions",()=>{
 const proof=compareDeployment(old,out);
 assert.deepEqual(proof,{
  ownerFunctionsAdded:6,originalFunctionsRemoved:0,
  approvedTargetsOnly:true,financeOrRulesChanged:false,
  realAccountCountSaveVerified:false,financeRawGetListDeniedVerified:false,
  jointRankingProductionEnabled:false
 });
 assert.throws(()=>compareDeployment(old,{result:out.result.slice(1)}),
  /STOP_OWNER_SIX_RELEASE_EXISTING_FUNCTION_REMOVED/);
 assert.throws(()=>compareDeployment(old,{result:[...out.result,
  {id:root+"getVerifiedJointCountRanking",region:REGION}]}),
  /STOP_OWNER_SIX_RELEASE_ADDED_FUNCTION_SET_MISMATCH/);
 assert.throws(()=>compareDeployment(old,{result:[
  ...old.result,...NEW.map(n=>({id:"projects/other/locations/"+REGION+"/functions/"+n,region:REGION}))
 ]}),/STOP_OWNER_SIX_RELEASE_ADDED_REGION_MISMATCH/);
 assert.throws(()=>compareDeployment(old,{result:[...old.result,...NEW.map(n=>({id:n}))]}),
  /STOP_OWNER_SIX_RELEASE_SHORT_ID_NO_REGION/);
});
test("all six published callable metadata requires expected ON/OFF environment flags",()=>{
 const data=NEW.map(meta);
 assert.equal(checkDeployedMetadata(data).allSixActive,true);
 for(const bad of [
  data.slice(1),
  data.map((x,i)=>i===0?{...x,state:"FAILED"}:x),
  data.map((x,i)=>i===0?{...x,buildConfig:{runtime:"nodejs20",entryPoint:x.buildConfig.entryPoint}}:x),
  data.map((x,i)=>i===0?{...x,serviceConfig:{...x.serviceConfig,environmentVariables:{
   ...EXPECTED_FLAGS,NICO_OWNER_SKU_MAPPING_ENABLED:"disabled"
  }}}:x),
  [...data,{...meta("getVerifiedJointCountRanking"),
   serviceConfig:{...meta("getVerifiedJointCountRanking").serviceConfig,
    environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:"enabled"}}}]
 ]){
  assert.throws(()=>checkDeployedMetadata(bad),/STOP_OWNER_SIX_RELEASE_/);
 }
});
test("the manual release must have no production auto-push or legacy release edits",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/nico-owner-setup-six-manual-release.yml",import.meta.url),"utf8");
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/\n  push:/);
 assert.match(workflow,/CONFIRM_SIX_OWNER_SETTINGS_ONLY/);
 assert.match(workflow,/FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED/);
 assert.match(workflow,/NO_RULES_OR_HOSTING_CHANGES/);
 assert.match(workflow,/NICO_JOINT_COUNT_RANKING_ENABLED=disabled/);
 assert.match(workflow,/protect-ranking-original-functions-versions.mjs before/);
 assert.match(workflow,/protect-ranking-original-functions-versions.mjs after/);
 assert.match(workflow,/--only "\$TARGETS"/);
 assert.doesNotMatch(workflow,/--only firestore|--only hosting|firebase deploy.*--force/);
});
