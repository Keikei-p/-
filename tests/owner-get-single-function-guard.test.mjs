import test from "node:test";
import assert from "node:assert/strict";
import {PROJECT,REGION,TARGET,inspectOwnerGetMetadata,inspectOwnerGetEnvironmentKeyNames,compareSingleFunctionRollout}
 from "../tools/production/owner-get-single-function-guard.mjs";
const fn=(name,time="2026-11-17T00:00:00Z",env={})=>({
 name:"projects/"+PROJECT+"/locations/"+REGION+"/functions/"+name,
 state:"ACTIVE",updateTime:time,
 buildConfig:{entryPoint:name,runtime:"nodejs22"},
 serviceConfig:{uri:"https://"+name+".run.app",environmentVariables:env}
});
const base=()=>[
 fn("getPartnerWorkspace","2026-11-17T00:00:00Z",{
  PARTNER_WORKSPACE_ENABLED:"enabled",
  NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED:"disabled"
 }),
 fn("managePartnerWorkspace"),fn("submitPartnerWorkspaceCounts"),
 fn("acceptPartnerWorkspaceInvite")
];
test("inspect refuses every unknown env flag, secret, other enabled write mode and missing Function",()=>{
 const old=base(),state=inspectOwnerGetMetadata(old);
 assert.equal(state.count,4);
 assert.equal(state.productionWrites,0);
 assert.equal(state.safeToDeploy,false);
 assert.match(state.envText,/PARTNER_WORKSPACE_ENABLED=enabled/);
 assert.match(state.envText,/COUNT_PUBLICATION_WRITE_ENABLED=disabled/);
 for(const mutation of [
  rows=>rows[0].serviceConfig.environmentVariables.EXTRA_TOKEN="secret",
  rows=>rows[0].serviceConfig.environmentVariables.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED="enabled",
  rows=>rows[0].serviceConfig.secretEnvironmentVariables=[{key:"PRIVATE_KEY"}],
  rows=>rows[0].buildConfig.entryPoint="submitPartnerWorkspaceCounts",
  rows=>rows[0].state="FAILED",
  rows=>rows.splice(0,1)
 ]){
  const rows=structuredClone(old);mutation(rows);
  assert.throws(()=>inspectOwnerGetMetadata(rows),
   /STOP_OWNER_GET_ONE_FUNCTION_/);
 }
});
test("exact target rollout can update only GET; all other version, URI, identity and flags stay",()=>{
 const old=base(),before=inspectOwnerGetMetadata(old);
 const newer=structuredClone(old);
 newer[0].updateTime="2026-11-17T01:00:00Z";
 const after=inspectOwnerGetMetadata(newer);
 assert.deepEqual(compareSingleFunctionRollout(before,after),{
  exactlyOneFunctionUpdated:true,otherFunctionsUnchanged:true,
  existingFlagsPreserved:true,productionDocumentWrites:0,
  ownerAuthenticatedGetVerified:false,financeRulesChanged:false,hostingChanged:false
 });
 for(const mutate of [
  rows=>rows[1].updateTime="2026-11-17T01:00:00Z",
  rows=>rows[1].serviceConfig.uri="https://other.run.app",
  rows=>rows[0].serviceConfig.environmentVariables.PARTNER_WORKSPACE_ENABLED="disabled",
  rows=>rows[0].updateTime=old[0].updateTime,
  rows=>rows.pop()
 ]){
  const v=structuredClone(newer);mutate(v);
  assert.throws(()=>compareSingleFunctionRollout(before,inspectOwnerGetMetadata(v)),
   /STOP_OWNER_GET_ONE_FUNCTION_/);
 }
});

test("live name-only diagnostic reports unfamiliar keys but never accepts them for release",()=>{
 const records=base();
 records[0].serviceConfig.environmentVariables.RUNTIME_SPECIAL_KEY="private_value_never_logged";
 const names=inspectOwnerGetEnvironmentKeyNames(records);
 assert.deepEqual(names.unrecognizedKeyNames,["RUNTIME_SPECIAL_KEY"]);
 assert.equal(names.unrecognizedKeyCount,1);
 assert.equal(names.productionWrites,0);
 assert.equal(names.releaseApproved,false);
 assert(!JSON.stringify(names).includes("private_value_never_logged"));
 assert.throws(()=>inspectOwnerGetMetadata(records),
   /STOP_OWNER_GET_ONE_FUNCTION_UNREVIEWED_RUNTIME_VARIABLE/);
 records[0].serviceConfig.secretEnvironmentVariables=[{key:"TOKEN"}];
 assert.throws(()=>inspectOwnerGetEnvironmentKeyNames(records),
   /STOP_OWNER_GET_ONE_FUNCTION_KEY_AUDIT_UNVERIFIED/);
});
