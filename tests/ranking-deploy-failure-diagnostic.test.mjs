import test from "node:test";
import assert from "node:assert/strict";
import {classifyFailureLog,summarizeFailedDeploy} from "../tools/production/ranking-deploy-failure-diagnostic.mjs";
import {readFileSync} from "node:fs";

const root="projects/sales-management-cc116/locations/asia-northeast1/functions/";
const before={result:[{id:root+"sendMissingReportReminders"},{id:root+"getPartnerWorkspace"}]};
const withTarget={result:[...before.result,{id:root+"getVerifiedJointCountRanking",region:"asia-northeast1"}]};

test("failed CLI with partial Function creation remains NO-GO and hides private log",()=>{
 const secret="PRIVATE_TOKEN_DO_NOT_PRINT";
 const result=summarizeFailedDeploy(before,withTarget,"Error: billing quota "+secret);
 assert.equal(result.rankingFunction,"PRESENT_BUT_UNVERIFIED");
 assert.equal(result.privateCliFailureCategory,"BILLING_OR_QUOTA");
 assert.equal(result.deploymentSucceeded,false);
 assert.equal(result.safeToRetryAutomatically,false);
 assert.equal(result.originalFunctionVersionsVerified,false);
 assert.equal(result.rankingFeatureDisabledVerified,false);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOKEN_DO_NOT_PRINT/);
});
test("failed CLI with absent Function reports absence, not success",()=>{
 const result=summarizeFailedDeploy(before,before,"unknown secret token");
 assert.equal(result.rankingFunction,"ABSENT");
 assert.equal(result.privateCliFailureCategory,"UNCLASSIFIED_PRIVATE_LOG");
});
test("removed originals, extra Function, wrong region and ambiguous short ID fail closed",()=>{
 assert.throws(()=>summarizeFailedDeploy(before,{result:[withTarget.result[2]]},""),/RECONCILIATION_REQUIRED/);
 assert.throws(()=>summarizeFailedDeploy(before,{result:[...withTarget.result,{id:root+"unexpected"}]},""),/RECONCILIATION_REQUIRED/);
 assert.throws(()=>summarizeFailedDeploy(before,{result:[...before.result,{id:"getVerifiedJointCountRanking"}]},""),/RECONCILIATION_REQUIRED/);
 assert.throws(()=>summarizeFailedDeploy(before,{result:[...before.result,{id:root+"getVerifiedJointCountRanking",region:"us-central1"}]},""),/RECONCILIATION_REQUIRED/);
});
test("classification emits only fixed safe categories",()=>{
 assert.equal(classifyFailureLog("PERMISSION_DENIED token=private"),"PERMISSION_OR_IAM");
 assert.equal(classifyFailureLog("Cloud Build failed private=secret"),"BUILD_OR_DEPENDENCY");
 assert.equal(classifyFailureLog("deadline exceeded"),"TIMEOUT");
 assert.equal(classifyFailureLog("API has not been used"),"API_NOT_ENABLED");
});
test("manual workflow never retries after failure and cleans private files",()=>{
 const wf=readFileSync(".github/workflows/nico-ranking-disabled-function-release.yml","utf8");
 assert.match(wf,/id: deploy_ranking/);
 assert.match(wf,/steps\.deploy_ranking\.outcome == 'failure'/);
 assert.match(wf,/ranking-deploy-failure-diagnostic\.mjs/);
 assert.match(wf,/RANKING_DEPLOY_FAILED_NO_AUTOMATIC_RETRY/);
 assert.match(wf,/nico-rank-after-failure\.private\.json/);
 assert.doesNotMatch(wf,/firebase deploy.*\|\|.*firebase deploy/);
});
