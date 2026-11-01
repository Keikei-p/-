import test from "node:test";
import assert from "node:assert/strict";
import {validCleanupPolicy,auditArtifactRepository,runAudit}
 from "../tools/production/audit-artifact-cleanup-iam.mjs";
const good={action:{type:"Delete"},condition:{tagState:"any",olderThan:"1d"}};
const repo={name:"projects/sales-management-cc116/locations/asia-northeast1/repositories/gcf-artifacts",
 cleanupPolicyDryRun:false,cleanupPolicies:{default:good}};
test("Google Artifact API uses action.type object; valid days, hours and seconds",()=>{
 assert.equal(validCleanupPolicy(good),true);
 for(const olderThan of ["86400s","1d","24h","1440m","7d"]){
  assert.equal(validCleanupPolicy({...good,condition:{tagState:"any",olderThan}}),true);
 }
 for(const olderThan of ["8d","30d","999999999s","0s","nonsense",undefined]){
  assert.equal(validCleanupPolicy({...good,condition:{tagState:"any",olderThan}}),false);
 }
});
test("conservative cleanup conditions: dry-run, filters, keep overrides rejected",()=>{
 assert.equal(validCleanupPolicy({...good,condition:{tagState:"tagged",olderThan:"1d"}}),false);
 assert.equal(validCleanupPolicy({...good,condition:{tagState:"any",olderThan:"1d",packageNamePrefixes:["narrow"]}}),false);
 assert.equal(auditArtifactRepository(repo).eligibleDeletionPolicy,true);
 assert.equal(auditArtifactRepository({...repo,cleanupPolicyDryRun:true}).eligibleDeletionPolicy,false);
 assert.equal(auditArtifactRepository({...repo,cleanupPolicies:{...repo.cleanupPolicies,keep:{action:{type:"Keep"},mostRecentVersions:{keepCount:9999}}}}).eligibleDeletionPolicy,false);
 assert.equal(auditArtifactRepository({...repo,cleanupPolicies:{}}).eligibleDeletionPolicy,false);
});
test("read-only diagnostics POST testIamPermissions only, no passwords or resource mutations",async()=>{
 const calls=[];
 const response=await runAudit({
  getToken:async()=>"TOKEN_IS_NEVER_LOGGED",
  request:async(url,opts)=>{
   calls.push({url,opts});
   if(opts.method==="POST")return {ok:true,json:async()=>({permissions:["artifactregistry.repositories.update"]})};
   return {ok:true,json:async()=>repo};
  }
 });
 assert.equal(response.eligibleDeletionPolicy,true);
 assert.equal(response.iamCanUpdate,true);
 assert.equal(response.iamCanDelete,false);
 assert.equal(calls.length,2);
 assert.equal(calls[0].opts.method,undefined);
 assert.equal(calls[1].opts.method,"POST");
 assert(calls[1].url.endsWith(":testIamPermissions"));
 assert.equal(JSON.stringify(calls[1].opts.body).includes("email"),false);
 await assert.rejects(
  runAudit({getToken:async()=>"token",request:async()=>({ok:true,json:async()=>({name:"wrong"})})}),
  /STOP_ARTIFACT_REPOSITORY_NAME/
 );
});
