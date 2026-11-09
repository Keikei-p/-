import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TARGET,ensureSingleRankingTarget,inspectIsolatedRankingSource,
 inspectPredeployInventory,compareOneDisabledFunction}
 from "../tools/production/joint-count-function-release-scope.mjs";
const src=readFileSync(new URL("../functions-ranking-approvals/index.js",import.meta.url),"utf8");
const config=readFileSync(new URL("../firebase.ranking-approvals.json",import.meta.url),"utf8");
const one={result:[
 {id:"getPartnerWorkspace",region:"asia-northeast1",status:"ACTIVE"},
 {id:"submitPartnerWorkspaceCounts",region:"asia-northeast1",status:"ACTIVE"},
 {id:"managePartnerWorkspace",region:"asia-northeast1",status:"ACTIVE"},
 {id:"acceptPartnerWorkspaceInvite",region:"asia-northeast1",status:"ACTIVE"},
 {id:"acceptPartnerCompanyInvitation",region:"asia-northeast1",status:"ACTIVE"},
 {id:"approvePartnerQuickCounts",region:"asia-northeast1",status:"ACTIVE"}
]};
const copy=x=>structuredClone(x);
test("exactly ONE new ranking Function may deploy; no Rules, Hosting or other calls",()=>{
 assert.equal(TARGET,"functions:ranking-owner-approvals:getVerifiedJointCountRanking");
 assert.equal(ensureSingleRankingTarget(TARGET),true);
 for(const target of [
  "functions:getVerifiedJointCountRanking",
  "functions:partner-workspace:getPartnerWorkspace",
  TARGET+",functions:ranking-owner-approvals:setOwnerProductVisibility",
  TARGET+" --force",
  "firestore:rules",null
 ])assert.throws(()=>ensureSingleRankingTarget(target),
  /JOINT_RANKING_DISABLED_RELEASE_EXTRA_OR_WRONG_FUNCTION/);
});
test("source and config are isolated, original onCall exports preserved and flag OFF unless explicitly enabled",()=>{
 assert.equal(inspectIsolatedRankingSource(src,config),true);
 for(const changed of [
  src.replace('NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"','true'),
  src.replace('NICO_OWNER_SKU_MAPPING_ENABLED==="enabled"','true'),
  src.replace('exports.getVerifiedJointCountRanking=onRequest({','exports.getVerifiedJointCountRanking=onCall({'),
  src.replace('cors:false','cors:true'),
  src+"\nexports.deleteAllRecords=onCall(options,visibility.save);"
 ])assert.throws(()=>inspectIsolatedRankingSource(changed,config),
  /JOINT_RANKING_DISABLED_RELEASE_/);
 assert.throws(()=>inspectIsolatedRankingSource(src,JSON.stringify({
  functions:{source:"functions",codebase:"default"},hosting:{public:"."}
 })),/JOINT_RANKING_DISABLED_RELEASE_/);
});
test("read-only inventory only approves missing new target; duplicates or incomplete list block",()=>{
 const p=inspectPredeployInventory(copy(one));
 assert.equal(p.newFunctionAbsent,true);
 const bad=copy(one);bad.result.push({id:"getVerifiedJointCountRanking",
  region:"asia-northeast1"});
 assert.throws(()=>inspectPredeployInventory(bad),
  /TARGET_ALREADY_PRESENT/);
 assert.throws(()=>inspectPredeployInventory({result:null}),/INVENTORY_UNAVAILABLE/);
 assert.throws(()=>inspectPredeployInventory({result:[{},{}]}),/INVENTORY_INVALID/);
});
test("original six Functions all preserved and exactly one new Tokyo ranking Function allowed",()=>{
 const after=copy(one);
 after.result.push({id:"projects/sales-management-cc116/locations/asia-northeast1/functions/getVerifiedJointCountRanking",
  status:"ACTIVE",region:"asia-northeast1"});
 const out=compareOneDisabledFunction(one,after);
 assert.equal(out.allOriginalFunctionsPreserved,true);
 assert.equal(out.exactlyOneNewRankingFunction,true);
 assert.equal(out.productionRankingEnabled,false);
 assert.equal(out.realFinanceBoundaryVerified,false);
});
test("adding extra Function, removing original, wrong region or existing target always blocks",()=>{
 const full="projects/sales-management-cc116/locations/asia-northeast1/functions/getVerifiedJointCountRanking";
 const foreign="projects/sales-management-cc116/locations/us-central1/functions/getVerifiedJointCountRanking";
 const tests=[
  a=>a.result.push({id:"getOwnerProductVisibility",region:"asia-northeast1"}),
  a=>a.result.pop(),
  a=>a.result.push({id:foreign,region:"us-central1"}),
  a=>a.result.push({id:"getVerifiedJointCountRanking",region:"us-central1"})
 ];
 for(const edit of tests){
  const after=copy(one);after.result.push({id:full,region:"asia-northeast1"});
  edit(after);
  assert.throws(()=>compareOneDisabledFunction(one,after),
   /JOINT_RANKING_DISABLED_RELEASE_/);
 }
 const already=copy(one);already.result.push({id:full,region:"asia-northeast1"});
 assert.throws(()=>compareOneDisabledFunction(already,already),
  /TARGET_ALREADY_PRESENT/);
});

test("review gate accepts the current seven exports but no eighth/unknown export",()=>{
 assert.equal(inspectIsolatedRankingSource(src,config),true);
 for(const required of ["getOwnerReviewedSkuMapping","setOwnerReviewedSkuMapping"]){
  assert(src.includes("exports."+required+"="));
  assert.throws(()=>inspectIsolatedRankingSource(
   src.replace("exports."+required+"=","exports.unsupportedExtra="),config
  ),/JOINT_RANKING_DISABLED_RELEASE_UNREVIEWED_EXPORTS/);
 }
});
