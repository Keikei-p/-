import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {target,ensureExactTarget,inspectSource,
 compareInventory,getIds}
 from "../tools/production/ranking-disabled-function-scope.mjs";
const config=readFileSync(new URL("../firebase.ranking-approvals.json",import.meta.url),"utf8");
const code=readFileSync(new URL("../functions-ranking-approvals/index.js",import.meta.url),"utf8");
const before={result:[
 {id:"projects/sales-management-cc116/locations/asia-northeast1/functions/acceptPartnerCompanyInvitation"},
 {id:"projects/sales-management-cc116/locations/asia-northeast1/functions/sendMissingReportReminders"}
]};
const newId="projects/sales-management-cc116/locations/asia-northeast1/functions/getVerifiedJointCountRanking";
const after={result:[...before.result,{id:newId}]};
test("real function source + config are exact, one target, flag OFF without env override",()=>{
 assert.equal(target(),"functions:ranking-owner-approvals:getVerifiedJointCountRanking");
 assert.equal(ensureExactTarget(target()),true);
 assert.equal(inspectSource(code,config),true);
 for(const other of [
  "functions","functions:ranking-owner-approvals",
  "functions:partner-workspace:submitPartnerWorkspaceCounts",
  "functions:ranking-owner-approvals:getOwnerProductVisibility",
  target()+",functions:ranking-owner-approvals:setOwnerReviewedSkuMapping"
 ])assert.throws(()=>ensureExactTarget(other),/SCOPE_BLOCKED/);
});
test("one new exact region function and original identities unchanged",()=>{
 const x=compareInventory(before,after);
 assert.equal(x.newFunctionOnly,true);
 assert.equal(x.oldFunctionIdsPreserved,true);
 assert.equal(x.productionRankingEnabled,false);
 assert.equal(x.hostingRewritten,false);
 assert.equal(x.regionRequiresConfirmation,false);
});
test("an existing ranking endpoint, extra Function, missing originals or other region blocks",()=>{
 for(const [old,newer] of [
  [after,after],
  [before,{result:[...after.result,{id:"getOwnerReviewedSkuMapping"}]}],
  [before,{result:[{id:newId}]}],
  [before,{result:[...before.result,{id:newId.replace("asia-northeast1","us-central1")}]}],
  [before,{result:[...before.result,{id:"getVerifiedJointCountRanking"}, {id:"another"}]}]
 ])assert.throws(()=>compareInventory(old,newer),/SCOPE_BLOCKED/);
});
test("short Function IDs require explicit Tokyo region metadata",()=>{
 const short={result:[...before.result,{id:"getVerifiedJointCountRanking"}]};
 assert.throws(()=>compareInventory(before,short),/SCOPE_BLOCKED/);
 assert.throws(()=>compareInventory(before,{result:[
  ...before.result,{id:"getVerifiedJointCountRanking",region:"us-central1"}
 ]}),/SCOPE_BLOCKED/);
 const verified=compareInventory(before,{result:[
  ...before.result,{id:"getVerifiedJointCountRanking",region:"asia-northeast1"}
 ]});
 assert.equal(verified.regionRequiresConfirmation,false);
 assert.throws(()=>compareInventory(before,{result:[
  ...before.result,{id:newId,region:"us-central1"}
 ]}),/SCOPE_BLOCKED/);
});
test("duplicate/malformed/unavailable inventory refuses deployment proof",()=>{
 for(const invalid of [
  null,{},{result:null},{result:[{id:"bad id!"}]},
  {result:[before.result[0],before.result[0]]},
  {result:[{id:"x".repeat(290)}]}
 ])assert.throws(()=>getIds(invalid),/SCOPE_BLOCKED/);
});
test("altered isolated codebase, widened source, missing flag or export blocks",()=>{
 const bad=[
  config.replace("functions-ranking-approvals","functions-partner-workspace"),
  config.replace("ranking-owner-approvals","partner-workspace"),
  config.replace('"codebase": "ranking-owner-approvals"', '"codebase": "ranking-owner-approvals", "extra": true')
 ];
 for(const value of bad)assert.throws(()=>inspectSource(code,value),/SCOPE_BLOCKED/);
 for(const value of [
  code.replace('NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"', 'NICO_JOINT_COUNT_RANKING_ENABLED==="disabled"'),
  code.replace("exports.getVerifiedJointCountRanking=onRequest","exports.getVerifiedJointCountRanking=onCall"),
  code.replace("region:\"asia-northeast1\"","region:\"us-central1\""),
  code+"\nexports.exposeFinance=onRequest({});"
 ])assert.throws(()=>inspectSource(value,config),/SCOPE_BLOCKED/);
});

test("read-only PR CI stays independent while live deploy shares production serialization",()=>{
 const wf=readFileSync(new URL("../.github/workflows/nico-ranking-disabled-function-release.yml",import.meta.url),"utf8");
 const [head,jobs]=wf.split(/^jobs:/m);
 assert(jobs,"workflow jobs missing");
 assert.doesNotMatch(head,/\nconcurrency:/);
 assert.match(jobs,/^  offline:\n/m);
 assert.match(jobs,/^  deploy-disabled:\n    #[^\n]*\n    #[^\n]*\n    concurrency:\n      group: nico-partner-workspace-production\n      cancel-in-progress: false\n    needs: offline/m);
 assert.match(jobs,/github\.event_name == 'workflow_dispatch'/);
 assert.match(jobs,/inputs\.mode == 'deploy_disabled'/);
 assert.match(jobs,/reviewed_main_sha == github\.sha/);
 assert.match(jobs,/--only "\$TARGET"/);
});
