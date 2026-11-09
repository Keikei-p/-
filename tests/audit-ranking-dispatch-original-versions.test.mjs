import test from "node:test";
import assert from "node:assert/strict";
import {auditRetrospectiveReadOnly} from "../tools/production/audit-ranking-dispatch-original-versions.mjs";
import {ORIGINAL} from "../tools/production/inspect-original-partner-functions-readonly.mjs";
import {readFileSync} from "node:fs";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const RANK="getVerifiedJointCountRanking";
const d="2026-11-09T03:27:20Z";
const now="2026-11-09T03:29:01.120Z";
const early="2026-11-08T23:30:21.123Z";
const v2=name=>({
 name:ROOT+name,state:"ACTIVE",updateTime:early,
 buildConfig:{runtime:"nodejs22",entryPoint:name},
 serviceConfig:{uri:"https://private-service.example.run.app",
  environmentVariables:{DO_NOT_LOG:"do-not-show"}}});
const v1=name=>({
 name:ROOT+name,status:"ACTIVE",updateTime:early,versionId:"45",
 runtime:"nodejs20",entryPoint:name,
 httpsTrigger:{url:"https://example.com/"+name},
 environmentVariables:{PRIVATE:"do-not-show"}});
const ranking=()=>({
 ...v2(RANK),updateTime:now,createTime:"2026-11-09T03:28:20Z",
 serviceConfig:{...v2(RANK).serviceConfig,environmentVariables:{
  NICO_JOINT_COUNT_RANKING_ENABLED:"disabled",
  PRIVATE_CREDENTIAL:"do-not-show"}}
});
const ok=body=>({status:200,json:async()=>body});
function fake(overrides={}){
 const urls=[],read=async url=>{
  urls.push(url);
  const name=url.split("/").at(-1),isV1=url.includes("/v1/");
  const key=(isV1?"v1/":"v2/")+name;
  if(Object.hasOwn(overrides,key)){
   const changed=overrides[key];
   if(changed instanceof Error)throw changed;
   return changed===null?{status:404}:ok(changed);
  }
  if(name===RANK)return isV1?{status:404}:ok(ranking());
  if(!ORIGINAL.includes(name))throw Error("UNKNOWN_PRIVATE_REQUEST");
  return isV1?{status:404}:ok(v2(name));
 };
 return {read,urls};
}
test("all six original config updateTimes before dispatch and new ranking OFF give narrow proof",async()=>{
 const f=fake();
 const result=await auditRetrospectiveReadOnly(f.read);
 assert.equal(f.urls.length,13);
 assert.equal(result.originalSixPresentAndActive,true);
 assert.equal(result.originalSixMetadataUpdateBeforeDispatch,true);
 assert.equal(result.rankingExistsActiveGen2ExplicitOff,true);
 assert.equal(result.originalVersionsByteIdenticalBeforeAndAfterProven,false);
 assert.equal(result.originalIamPolicyUnchangedProven,false);
 assert.equal(result.publicRankingReleaseAuthorized,false);
 assert.equal(result.financeRulesProtectionProven,false);
 assert.equal(result.firestoreWrites,0);
 assert.equal(result.productionDeploys,0);
 assert.equal(result.functionInvocations,0);
 assert(!JSON.stringify(result).includes("do-not-show"));
});
test("Gen1 originals also protected; audit rejects updates newer than dispatch",async()=>{
 const replaced=fake({"v2/"+ORIGINAL[0]:null,
  "v1/"+ORIGINAL[0]:v1(ORIGINAL[0])});
 const okReport=await auditRetrospectiveReadOnly(replaced.read);
 assert.equal(okReport.originalSixGenerationCount,6);
 for(const changed of [
  {...v2(ORIGINAL[0]),updateTime:"2026-11-09T03:27:21Z"},
  {...v2(ORIGINAL[0]),state:"FAILED"},
  {...v2(ORIGINAL[0]),serviceConfig:{uri:""}},
  {...v2(ORIGINAL[0]),updateTime:"not-a-date"},
  {...v2(ORIGINAL[0]),name:ROOT+"wrong"}
 ]){
  await assert.rejects(auditRetrospectiveReadOnly(fake({
   ["v2/"+ORIGINAL[0]]:changed
  }).read),/STOP_/);
 }
});
test("missing generation, denied metadata or extra Gen1 changes always stop",async()=>{
 const name=ORIGINAL[2];
 for(const overrides of [
  {["v2/"+name]:null,["v1/"+name]:null},
  {["v2/"+name]:new Error("PRIVATE_API_KEY")},
  {["v2/"+name]:{...v2(name),updateTime:"2026-11-09T03:28:00Z"}},
  {["v1/"+name]:{...v1(name),updateTime:"2026-11-09T03:28:00Z"}},
 ]){
  await assert.rejects(auditRetrospectiveReadOnly(fake(overrides).read),/STOP_/);
 }
});
test("ranking missing, switched ON, unverified create time, wrong project fail closed",async()=>{
 for(const altered of [
  null,
  {...ranking(),state:"FAILED"},
  {...ranking(),createTime:"2026-11-08T00:00:00Z"},
  {...ranking(),createTime:null},
  {...ranking(),name:"projects/another/locations/"+REGION+"/functions/"+RANK},
  {...ranking(),serviceConfig:{...ranking().serviceConfig,environmentVariables:{
   NICO_JOINT_COUNT_RANKING_ENABLED:"enabled"}}},
  {...ranking(),serviceConfig:{environmentVariables:{OTHER:"disabled"}}}
 ]){
  await assert.rejects(auditRetrospectiveReadOnly(fake({
   ["v2/"+RANK]:altered
  }).read),/STOP_/);
 }
});
test("allow mixed v1/v2 only when both generations still older than dispatch",async()=>{
 const name=ORIGINAL[0];
 const report=await auditRetrospectiveReadOnly(fake({
  ["v1/"+name]:v1(name)
 }).read);
 assert.equal(report.originalSixGenerationCount,7);
});
test("workflow is read-only; no Firebase deployment or raw logs are emitted",()=>{
 const y=readFileSync(new URL("../.github/workflows/nico-ranking-retrospective-original-six-readonly.yml",import.meta.url),"utf8");
 const js=readFileSync(new URL("../tools/production/audit-ranking-dispatch-original-versions.mjs",import.meta.url),"utf8");
 assert.match(y,/github\.event_name == 'push'/);
 assert.match(y,/--prefix functions/);
 assert.match(y,/node tools\/production\/audit-ranking-dispatch-original-versions\.mjs/);
 assert(!/firebase deploy|gcloud functions deploy|firebase firestore:delete|curl.*-X POST/.test(y));
 assert(!/method:"POST"|method:"PATCH"|method:"PUT"|method:"DELETE"/.test(js));
 assert(!/console\.log\(.*body|console\.log\(.*credentials|console\.log\(.*token/.test(js));
});
