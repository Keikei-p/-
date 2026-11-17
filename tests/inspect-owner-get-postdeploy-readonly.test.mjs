import test from "node:test";
import assert from "node:assert/strict";
import {PROJECT,REGION,TARGET} from "../tools/production/owner-get-single-function-guard.mjs";
import {inspectOwnerGetPostDeploy,EARLIEST_RELEASE_UPDATE}
 from "../tools/production/inspect-owner-get-postdeploy-readonly.mjs";
const mk=(i)=>({
 name:"projects/"+PROJECT+"/locations/"+REGION+"/functions/"+
  (i===0?"getPartnerWorkspace":"someFunction"+i),
 state:"ACTIVE",
 updateTime:i===0?"2026-11-17T10:01:57Z":"2026-11-10T10:00:00Z",
 buildConfig:{runtime:"nodejs22",entryPoint:i===0?"getPartnerWorkspace":"someFunction"+i},
 serviceConfig:{
  uri:"https://function"+i+".run.app",
  environmentVariables:i===0?{
   PARTNER_WORKSPACE_ENABLED:"enabled",
   NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED:"disabled"
  }:{}
 }
});
const seed=()=>Array.from({length:20},(_,i)=>mk(i));
test("live read-only audit verifies release happened after CLI start and 20 functions active",()=>{
 const p=inspectOwnerGetPostDeploy(seed());
 assert.equal(EARLIEST_RELEASE_UPDATE,"2026-11-17T10:00:48.000Z");
 assert.equal(p.liveTargetUpdateTime,"2026-11-17T10:01:57Z");
 assert.equal(p.liveFunctionsFound,20);
 assert.equal(p.highRiskCountAndRankingModesDisabled,true);
 assert.equal(p.postDeployAuditDocumentWrites,0);
 assert.equal(p.otherFunctionsByteForByteUnchangedVerified,false);
 assert.equal(p.realOwnerAuthenticatedGetVerified,false);
});
test("cannot falsely pass if target updateTime has not advanced",()=>{
 const x=seed();x[0].updateTime="2026-11-17T10:00:45Z";
 assert.throws(()=>inspectOwnerGetPostDeploy(x),/TARGET_NOT_UPDATED_IN_RELEASE_WINDOW/);
});
test("cannot pass missing/duplicated functions or inactive unrelated function",()=>{
 for(const variant of ["missing","duplicate","inactive"]){
  const x=seed();
  if(variant==="missing")x.pop();
  if(variant==="duplicate")x[1]=structuredClone(x[0]);
  if(variant==="inactive")x[19].state="FAILED";
  assert.throws(()=>inspectOwnerGetPostDeploy(x),/STOP_OWNER_GET_/);
 }
});
test("cannot pass enabled financial-risk flags or newly introduced unknown environment key",()=>{
 for(const flag of ["NICO_PARTNER_SHARED_RANKING_ENABLED",
  "NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
  "NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED",
  "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED","UNREVIEWED_RUNTIME_TOKEN"]){
  const x=seed();x[0].serviceConfig.environmentVariables[flag]="enabled";
  assert.throws(()=>inspectOwnerGetPostDeploy(x),/STOP_OWNER_GET_/);
 }
});
test("does not accept a changed target, source configuration or missing source metadata",()=>{
 for(const mutate of [
  x=>x[0].buildConfig.entryPoint="submitPartnerWorkspaceCounts",
  x=>x[0].buildConfig.runtime="nodejs20",
  x=>x[0].serviceConfig.uri="http://example.com",
  x=>delete x[0].serviceConfig.environmentVariables
 ]){
  const x=seed();mutate(x);
  assert.throws(()=>inspectOwnerGetPostDeploy(x),/STOP_OWNER_GET_/);
 }
});
