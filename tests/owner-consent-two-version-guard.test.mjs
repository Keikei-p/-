import test from "node:test";
import assert from "node:assert/strict";
import {NEW,PROJECT,REGION,EXPECTED_FLAGS} from "../tools/production/owner-setup-six-release-scope.mjs";
import {TARGETS,DEPLOY_TARGETS,snapshotAllExceptTwo,compareTwoVersions}
 from "../tools/production/owner-consent-two-version-guard.mjs";
const base="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const entry=(name,time="2026-11-10T00:00:00Z")=>({
 name:base+name,updateTime:time,state:"ACTIVE",
 buildConfig:{entryPoint:name,runtime:"nodejs22"},
 serviceConfig:{uri:"https://reviewed.run.app",environmentVariables:EXPECTED_FLAGS}
});
const before=()=>[
 ...NEW.map(n=>entry(n)),
 entry("submitPartnerWorkspaceCounts"),
 entry("getPartnerWorkspace"),
 entry("getVerifiedJointCountRanking"),
 entry("getPartnerQuickCounts")
];
const after=()=>before().map(x=>TARGETS.some(n=>x.name===base+n)?
 {...x,updateTime:"2026-11-10T02:00:00Z"}:x);
test("exact 2 owner consent targets, no finance, counts, mapping or other owner function",()=>{
 assert.deepEqual(TARGETS,["getRankingOwnerConsentStatus","setRankingOwnerConsent"]);
 assert.deepEqual(DEPLOY_TARGETS,[
  "functions:ranking-owner-approvals:getRankingOwnerConsentStatus",
  "functions:ranking-owner-approvals:setRankingOwnerConsent"
 ]);
 const frozen=snapshotAllExceptTwo(before());
 assert.equal(frozen.count,8);
 const result=compareTwoVersions(frozen,after());
 assert.equal(result.updatedOwnerConsentFunctions,2);
 assert.equal(result.unchangedOtherGen2Functions,8);
 assert.equal(result.productionDocumentWrites,0);
});
test("fail closed for even one old function change, missing revisions, duplicates or third addition",()=>{
 const frozen=snapshotAllExceptTwo(before());
 const refuse=items=>assert.throws(()=>compareTwoVersions(frozen,items),
  /STOP_OWNER_CONSENT_TWO_RELEASE|STOP_OWNER_SIX_RELEASE/);
 refuse(before());
 refuse(after().map(x=>x.name===base+"setRankingOwnerConsent"?
  {...x,updateTime:"2026-11-10T00:00:00Z"}:x));
 refuse(after().map(x=>x.name===base+"setOwnerProductVisibility"?
  {...x,updateTime:"2026-11-10T02:00:00Z"}:x));
 refuse(after().slice(1));
 refuse([...after(),entry("unknownExtra")]);
 refuse([...after(),after()[0]]);
});
