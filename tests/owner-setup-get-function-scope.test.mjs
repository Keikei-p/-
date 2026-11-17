import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {APPROVED,TARGET,inspectOwnerGetCandidate,inspectOwnerGetMetadata}
 from "../tools/production/owner-setup-get-function-scope.mjs";
const source=()=>Object.fromEntries(Object.keys(APPROVED).map(path=>
 [path,readFileSync(new URL("../"+path,import.meta.url),"utf8")]));
test("one existing getPartnerWorkspace only: strict current source + unchanged feature flags",()=>{
 const result=inspectOwnerGetCandidate(source());
 assert.equal(result.target,TARGET);
 assert.equal(result.ownerReadOnlyPathPresent,true);
 assert.equal(result.onlyGetTargetReviewed,true);
 assert.equal(result.liveOwnerAuthVerified,false);
 assert.equal(result.backendDeployedVerified,false);
 assert.equal(result.safeToDeploy,false);
 assert.equal(result.productionWrites,0);
});
test("reject another Function, altered services, release flags or wrong backend build",()=>{
 const inputs=source();
 for(const target of ["functions:partner-workspace","functions:partner-workspace:submitPartnerWorkspaceCounts",
  "functions:ranking-owner-approvals:getVerifiedJointCountRanking"]){
  assert.throws(()=>inspectOwnerGetCandidate(inputs,target),
   /STOP_OWNER_GET_ONLY_TARGET/);
 }
 for(const name of Object.keys(inputs)){
  assert.throws(()=>inspectOwnerGetCandidate({...inputs,[name]:inputs[name]+"\n// unreviewed change"}),
   /STOP_OWNER_GET_ONLY_SOURCE_DRIFT/);
 }
 assert.throws(()=>inspectOwnerGetCandidate({...inputs,extra:"unreviewed"}),
  /STOP_OWNER_GET_ONLY_SOURCE_SET/);
});
const key="projects/sales-management-cc116/locations/asia-northeast1/functions/";
const base=(name)=>({
 name:key+name,state:"ACTIVE",updateTime:"2026-11-16T00:00:00Z",
 buildConfig:{entryPoint:name,runtime:"nodejs22"},
 serviceConfig:{uri:"https://nico-existing.a.run.app",environmentVariables:{
  PARTNER_WORKSPACE_ENABLED:"enabled",
  NICO_PARTNER_SHARED_RANKING_ENABLED:"disabled",
  NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED:"disabled"
 }}
});
test("a single deployed GET can change, but all count writers and existing flags remain unchanged",()=>{
 const original=[base("getPartnerWorkspace"),base("submitPartnerWorkspaceCounts"),
  base("managePartnerWorkspace"),base("acceptPartnerWorkspaceInvite")];
 const updated=structuredClone(original);
 updated[0].updateTime="2026-11-17T00:00:00Z";
 const result=inspectOwnerGetMetadata({before:original,after:updated});
 assert.equal(result.otherFunctionsUnchanged,true);
 assert.equal(result.existingFlagsUnchanged,true);
 assert.equal(result.ownerAuthVerified,false);
 assert.equal(result.readyForOwnerUi,false);
});
test("silent change to other counts, runtime, flags, or function inventory is refused",()=>{
 const original=[base("getPartnerWorkspace"),base("submitPartnerWorkspaceCounts")];
 const cases=[
  rows=>{rows[1].updateTime="2026-11-17T00:00:00Z";},
  rows=>{rows[0].buildConfig.runtime="nodejs20";},
  rows=>{rows[0].serviceConfig.environmentVariables.NICO_PARTNER_SHARED_RANKING_ENABLED="enabled";},
  rows=>{rows[0].state="FAILED";},
  rows=>{rows.pop();}
 ];
 for(const edit of cases){
  const after=structuredClone(original);edit(after);
  assert.throws(()=>inspectOwnerGetMetadata({before:original,after}),
   /STOP_OWNER_GET_ONLY_/);
 }
});
test("preflight cannot deploy, write Firestore or claim real Owner verification",()=>{
 const s=readFileSync(new URL("../tools/production/owner-setup-get-function-scope.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(s,/firebase deploy|runTransaction\(|\.set\(|\.update\(|\.delete\(/);
 assert.match(s,/safeToDeploy:false/);
 assert.match(s,/liveOwnerAuthVerified:false/);
});
