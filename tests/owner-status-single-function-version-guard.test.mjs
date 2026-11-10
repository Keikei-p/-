import test from "node:test";
import assert from "node:assert/strict";
import {NEW,PROJECT,REGION,EXPECTED_FLAGS} from "../tools/production/owner-setup-six-release-scope.mjs";
import {TARGET,DEPLOY_TARGET,snapshotOtherFunctions,
 compareSingleFunctionVersion} from "../tools/production/owner-status-single-function-version-guard.mjs";
const root="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const entry=(name,time="2026-11-10T00:00:00Z")=>({
 name:root+name,updateTime:time,state:"ACTIVE",
 buildConfig:{runtime:"nodejs22",entryPoint:name},
 serviceConfig:{uri:"https://internal.a.run.app",environmentVariables:{...EXPECTED_FLAGS}}
});
const orig=()=>[
 ...NEW.map(x=>entry(x)),
 entry("getPartnerWorkspace"),entry("submitPartnerWorkspaceCounts"),
 entry("managePartnerWorkspace"),entry("acceptPartnerWorkspaceInvite")
];
const updated=(v=orig())=>v.map(x=>x.name===root+TARGET?{
 ...x,updateTime:"2026-11-10T01:00:00Z"
}:x);
test("single scoped function deployment excludes every other original and ranking GET",()=>{
 assert.equal(DEPLOY_TARGET,"functions:ranking-owner-approvals:getRankingOwnerConsentStatus");
 assert(!DEPLOY_TARGET.includes("setRankingOwnerConsent"));
 assert(!DEPLOY_TARGET.includes("getVerifiedJointCountRanking"));
 assert(!DEPLOY_TARGET.includes("submitPartnerWorkspaceCounts"));
 const before=snapshotOtherFunctions(orig());
 assert.equal(before.protectedCount,9);
 const report=compareSingleFunctionVersion(before,updated());
 assert.equal(report.exactlyOneOwnerStatusRevisionUpdated,true);
 assert.equal(report.unaffectedExistingGen2,9);
 assert.equal(report.jointRankingStillDisabled,true);
 assert.equal(report.productionDocumentWrites,0);
});
test("all other Gen2 function changes and absent / unready status fail closed",()=>{
 const before=snapshotOtherFunctions(orig());
 assert.throws(()=>compareSingleFunctionVersion(before,orig()),
  /STOP_OWNER_STATUS_SINGLE_RELEASE_TARGET_REVISION_NOT_CHANGED/);
 assert.throws(()=>compareSingleFunctionVersion(before,updated().slice(1)),
  /STOP_OWNER_SIX_RELEASE_REQUIRED_FUNCTION_MISSING/);
 const corrupted=updated().map(x=>x.name===root+"setOwnerProductVisibility"?{
  ...x,updateTime:"2026-11-10T01:00:00Z"
 }:x);
 assert.throws(()=>compareSingleFunctionVersion(before,corrupted),
  /STOP_OWNER_STATUS_SINGLE_RELEASE_OTHER_FUNCTION_UPDATED_OR_DELETED/);
 assert.throws(()=>snapshotOtherFunctions([
  ...orig(),orig()[0]
 ]),/STOP_OWNER_SIX_RELEASE_REQUIRED_FUNCTION_MISSING|STOP_OWNER_STATUS_SINGLE_RELEASE_/);
});
