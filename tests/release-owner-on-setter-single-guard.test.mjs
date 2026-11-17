import test from "node:test";
import assert from "node:assert/strict";
import {PREFIX,TARGET,inspectOwnerOnSetterMetadata,
 compareOwnerOnSetterUpdate}
 from "../tools/production/release-owner-on-setter-single-guard.mjs";
const names=["getOwnerProductVisibility","setOwnerProductVisibility",
 "getOwnerReviewedSkuMapping","setOwnerReviewedSkuMapping",
 "getPartnerWorkspace","submitPartnerWorkspaceCounts",
 "getVerifiedJointCountRanking",...Array.from({length:13},(_,i)=>"other"+i)];
function functions(){
 return names.map(name=>({
  name:PREFIX+name,state:"ACTIVE",updateTime:"2026-11-17T00:00:00Z",
  buildConfig:{runtime:"nodejs22",entryPoint:name},
  serviceConfig:{uri:"https://"+name.toLowerCase()+"-a.run.app",
   serviceAccountEmail:"functions@example.iam.gserviceaccount.com",
   environmentVariables:name==="setOwnerProductVisibility"?
    {NICO_OWNER_PRODUCT_VISIBILITY_ENABLED:"enabled",
     NICO_JOINT_COUNT_RANKING_ENABLED:"disabled"}:
    name==="getVerifiedJointCountRanking"?
     {NICO_JOINT_COUNT_RANKING_ENABLED:"disabled"}:
     {NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED:"disabled"}}
 }));
}
test("one ACTIVE setter with four Owner callables and 20 functions preserves flags",()=>{
 const result=inspectOwnerOnSetterMetadata(functions());
 assert.equal(result.inventoryCount,20);
 assert.equal(result.target,TARGET);
 assert.equal(result.approvedForDeployment,false);
 assert.equal(result.productionDocumentWritesByInspection,0);
 assert.match(result.envText,/NICO_OWNER_PRODUCT_VISIBILITY_ENABLED=enabled/);
 assert.match(result.envText,/NICO_JOINT_COUNT_RANKING_ENABLED=disabled/);
 assert(!/FIREBASE_CONFIG|GCLOUD_PROJECT/.test(result.envText));
});
test("only one changed target timestamp, all other nineteen unchanged is accepted",()=>{
 const old=functions(),updated=structuredClone(old);
 updated.find(x=>x.name===TARGET).updateTime="2026-11-18T00:00:00Z";
 const proof=compareOwnerOnSetterUpdate(
  inspectOwnerOnSetterMetadata(old),inspectOwnerOnSetterMetadata(updated));
 assert.equal(proof.exactlyOneOwnerSetterUpdated,true);
 assert.equal(proof.otherNineteenUnchanged,true);
 assert.equal(proof.firestoreDocumentWritesByAudit,0);
 assert.equal(proof.authenticatedOwnerSaveNotYetVerified,true);
});
test("unknown or missing environment, secret key, extra function, rank or ledger ON stop",()=>{
 const mutators=[
  x=>x[1].serviceConfig.environmentVariables.UNREVIEWED_TOKEN="bad",
  x=>x[1].serviceConfig.environmentVariables.NICO_OWNER_PRODUCT_VISIBILITY_ENABLED="disabled",
  x=>x[1].serviceConfig.environmentVariables.NICO_JOINT_COUNT_RANKING_ENABLED="enabled",
  x=>x[1].serviceConfig.secretEnvironmentVariables=[{key:"private"}],
  x=>x[6].serviceConfig.environmentVariables.NICO_JOINT_COUNT_RANKING_ENABLED="enabled",
  x=>x[5].serviceConfig.environmentVariables.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED="enabled",
  x=>x[0].state="FAILED",
  x=>x.push({...x[0],name:PREFIX+"surpriseExtra"})
 ];
 for(const mutate of mutators){
  const rows=functions();mutate(rows);
  assert.throws(()=>inspectOwnerOnSetterMetadata(rows),/STOP_OWNER_ON_SETTER_/);
 }
});
test("unrelated function changes, target service account and user-flag drift fail after deploy",()=>{
 const mutators=[
  x=>x[0].updateTime="2026-11-18T00:00:00Z",
  x=>x[0].serviceConfig.uri="https://different.run.app",
  x=>x[1].serviceConfig.serviceAccountEmail="other@example.com",
  x=>x[1].serviceConfig.environmentVariables.NICO_OWNER_PRODUCT_VISIBILITY_ENABLED="disabled",
  x=>x[1].buildConfig.entryPoint="newFunction"
 ];
 for(const mutate of mutators){
  const old=functions(),after=structuredClone(old);
  after[1].updateTime="2026-11-18T00:00:00Z";
  mutate(after);
  let fail=true;
  try{
   compareOwnerOnSetterUpdate(inspectOwnerOnSetterMetadata(old),
    inspectOwnerOnSetterMetadata(after));
   fail=false;
  }catch(e){assert.match(e.message,/STOP_OWNER_ON_SETTER_/);}
  assert.equal(fail,true,"unapproved change must be detected");
 }
 const old=functions();
 assert.throws(()=>compareOwnerOnSetterUpdate(
  inspectOwnerOnSetterMetadata(old),inspectOwnerOnSetterMetadata(old)),
 /STOP_OWNER_ON_SETTER_TARGET_NOT_REVIEWED_OR_ENV_CHANGED/);
});
