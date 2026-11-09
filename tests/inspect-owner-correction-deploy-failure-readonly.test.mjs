import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyFailure,classifyFunctionInventory,classifyTargetOperations}
 from "../tools/production/inspect-owner-correction-deploy-failure-readonly.mjs";
const target=name=>({
 id:"projects/sales-management-cc116/locations/asia-northeast1/functions/"+name,
 region:"asia-northeast1",projectId:"sales-management-cc116",
 codebase:"hub-owner-correction-v3",platform:"gcfv2",state:"ACTIVE",
 environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:"disabled"}
});
test("post-failure inventory can distinguish absent, half deployed, and disabled exact two",()=>{
 const empty=classifyFunctionInventory({result:[]});
 assert.equal(empty.listHubPartnerCountsListed,false);
 assert.equal(empty.correctHubPartnerCountsListed,false);
 const partial=classifyFunctionInventory({result:[target("listHubPartnerCounts")]});
 assert.equal(partial.listTargetTokyoDisabled,true);
 assert.equal(partial.correctHubPartnerCountsListed,false);
 const both=classifyFunctionInventory({result:[
  target("listHubPartnerCounts"),target("correctHubPartnerCounts")
 ]});
 assert.equal(both.listTargetTokyoDisabled,true);
 assert.equal(both.correctTargetTokyoDisabled,true);
 assert.equal(both.realOwnerCorrectionAvailable,false);
 assert.equal(both.deployments,0);
});
test("unexpected flags, project or region must not be claimed as correct",()=>{
 for(const extra of [
  {environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:"enabled"}},
  {region:"us-central1"}, {codebase:"default"}, {projectId:"another-project"},
  {state:"FAILED"}
 ]){
  const outcome=classifyFunctionInventory({result:[{...target("listHubPartnerCounts"),...extra}]});
  assert.equal(outcome.listTargetTokyoDisabled,false);
 }
 assert.throws(()=>classifyFunctionInventory({result:[
  target("listHubPartnerCounts"),target("listHubPartnerCounts")
 ]}),/STOP_OWNER_FAILURE_TRIAGE_DUPLICATE_TARGET/);
 assert.throws(()=>classifyFunctionInventory({result:null}),
  /STOP_OWNER_FAILURE_TRIAGE_INVENTORY/);
});
test("operation metadata exposes only classifications, not raw secret-bearing messages or IDs",()=>{
 const data={operations:[
  {metadata:{target:"projects/sales-management-cc116/locations/asia-northeast1/functions/listHubPartnerCounts"},
   done:true,error:{code:7,message:"Permission iam.serviceAccounts.actAs denied for principal private@example.com"}},
  {metadata:{target:"projects/sales-management-cc116/locations/asia-northeast1/functions/correctHubPartnerCounts"},
   done:true,error:{code:8,message:"Quota exceeded for private tenant"}},
  {metadata:{target:"projects/sales-management-cc116/locations/asia-northeast1/functions/unrelated"},
   done:true,error:{code:13,message:"secret"}},
  {metadata:{target:"projects/sales-management-cc116/locations/asia-northeast1/functions/listHubPartnerCounts"},
   done:false}
 ]};
 const out=classifyTargetOperations(data),encoded=JSON.stringify(out);
 assert.equal(out.targetOperationsFound,3);
 assert.equal(out.failuresByClass.IAM_PERMISSION,1);
 assert.equal(out.failuresByClass.QUOTA_OR_RATE_LIMIT,1);
 assert.equal(out.targetOperationStillPending,true);
 assert(!encoded.includes("private@example.com"));
 assert(!encoded.includes("private tenant"));
 assert(!encoded.includes("iam.serviceAccounts.actAs"));
});
test("classified error codes never expose arbitrary raw Cloud Build or IAM content",()=>{
 for(const [message,expected] of [
  ["PERMISSION_DENIED Missing required permission","IAM_PERMISSION"],
  ["429 Quota exceeded","QUOTA_OR_RATE_LIMIT"],
  ["Billing account required","BILLING_OR_BUDGET"],
  ["cloud build failed","BUILD_FAILURE"],
  ["Artifact Registry image issue","ARTIFACT_REGISTRY"],
  ["A service account required","SERVICE_ACCOUNT_CONFIG"],
  ["409 already exists","CONFLICT"],
  ["Invalid argument 400","INVALID_CONFIG"],
  ["503 service unavailable","PLATFORM_TEMPORARY"],
  ["Unrecognized detail for client private@example.com","UNKNOWN"]
 ])assert.equal(classifyFailure(message),expected);
});
test("workflow lists live Functions and cloud operation metadata via GET, without redeploying",()=>{
 const yaml=readFileSync(new URL("../.github/workflows/nico-owner-disabled-deploy-failure-readonly.yml",import.meta.url),"utf8");
 const source=readFileSync(new URL("../tools/production/inspect-owner-correction-deploy-failure-readonly.mjs",import.meta.url),"utf8");
 assert.match(yaml,/github\.event_name == 'push'/);
 assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
 assert.match(yaml,/firebase functions:list --project/);
 assert.match(yaml,/inspect-owner-correction-deploy-failure-readonly\.mjs --readonly/);
 assert.match(yaml,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.doesNotMatch(yaml,/firebase deploy|--force|firestore:delete|upload-artifact/);
 assert.match(source,/method:"GET"/);
 assert.doesNotMatch(source,/method:"POST"|method:"PUT"|method:"PATCH"|method:"DELETE"/);
 assert.doesNotMatch(source,/console\.log\((?:data|ops|response|error|token)/);
});
