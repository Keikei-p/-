import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {ORIGINAL} from "../tools/production/inspect-original-partner-functions-readonly.mjs";
import {classifyOwnerTarget,inspectAfterOwnerListFailure}
 from "../tools/production/inspect-owner-list-deploy-aftermath-readonly.mjs";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const v1="https://cloudfunctions.googleapis.com/v1/"+ROOT;
const v2="https://cloudfunctions.googleapis.com/v2/"+ROOT;
const oldTime="2026-11-08T08:00:00Z",recent="2026-11-09T08:46:00Z";
function owner(name,flag="disabled",updateTime=oldTime){
 return {name:ROOT+name,state:"ACTIVE",updateTime,
  labels:{"firebase-functions-codebase":"hub-owner-correction-v3"},
  buildConfig:{runtime:"nodejs22",entryPoint:name},
  serviceConfig:{environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:flag},
   minInstanceCount:0,maxInstanceCount:2,uri:"https://function.example.invalid"}};
}
function original(name,when=oldTime){
 return {name:ROOT+name,state:"ACTIVE",updateTime:when,
  buildConfig:{runtime:"nodejs22",entryPoint:name},
  serviceConfig:{uri:"https://function.example.invalid",environmentVariables:{}}};
}
function mock({reader=owner("listHubPartnerCounts","enabled",recent),
 writer=owner("correctHubPartnerCounts","disabled",oldTime),
 originalsNewer=false,missingOriginal=false}={}){
 const calls=[];
 const read=async url=>{
  calls.push(url);
  if(url===v2+"listHubPartnerCounts")return {status:200,json:async()=>reader};
  if(url===v2+"correctHubPartnerCounts")return {status:200,json:async()=>writer};
  if(ORIGINAL.some(n=>url===v1+n))return {status:404};
  const name=ORIGINAL.find(n=>url===v2+n);
  if(name&&missingOriginal&&name===ORIGINAL[0])return {status:404};
  if(name)return {status:200,json:async()=>original(name,
    originalsNewer&&name===ORIGINAL[0]?recent:oldTime)};
  throw Error("UNEXPECTED_GET");
 };
 return {read,calls};
}
test("Cloud Functions direct GET proves one reader enabled, writer disabled and six originals unchanged since start",async()=>{
 const fixture=mock();
 const report=await inspectAfterOwnerListFailure(fixture);
 assert.equal(report.audit,"CLOUD_FUNCTIONS_API_DIRECT_GET_ONLY");
 assert.equal(report.list.enabled,true);
 assert.equal(report.correction.disabled,true);
 assert.equal(report.releaseVerifiedAsExactOne,true);
 assert.equal(report.originalsChecked,ORIGINAL.length);
 assert.equal(report.originalsUpdatedSinceStart,0);
 assert.equal(report.firestoreWrites,0);
 assert.equal(report.functionsDeployedByAudit,0);
 assert.equal(report.safeToEnableCorrection,false);
 assert.equal(fixture.calls.length,2+ORIGINAL.length*2);
 assert(fixture.calls.every(x=>x.startsWith(v1)||x.startsWith(v2)));
});
test("writer metadata changed during failed release means not safe to claim exact one",async()=>{
 const r=await inspectAfterOwnerListFailure(mock({
  writer:owner("correctHubPartnerCounts","disabled",recent)}));
 assert.equal(r.correction.disabled,true);
 assert.equal(r.correction.updatedSinceFailedDeployStart,true);
 assert.equal(r.releaseVerifiedAsExactOne,false);
});
test("unexpected writer enable or original six update is never called safe",async()=>{
 for(const opts of [
  {writer:owner("correctHubPartnerCounts","enabled",recent)},
  {originalsNewer:true}
 ]){
  const r=await inspectAfterOwnerListFailure(mock(opts));
  assert.equal(r.releaseVerifiedAsExactOne,false);
 }
});
test("missing original, invalid state and unknown flags stop without calls to write",async()=>{
 await assert.rejects(inspectAfterOwnerListFailure(mock({missingOriginal:true})),
  /STOP_OWNER_AFTER_FAILURE_READONLY_ORIGINAL_FUNCTION_MISSING/);
 for(const b of [
  owner("listHubPartnerCounts","unknown"),
  {...owner("listHubPartnerCounts","enabled"),state:"UNKNOWN"},
  {...owner("listHubPartnerCounts","enabled"),labels:{"firebase-functions-codebase":"other"}}
 ]){
  await assert.rejects(inspectAfterOwnerListFailure(mock({reader:b})),
   /STOP_OWNER_AFTER_FAILURE_READONLY_/);
 }
});
test("source contains no deploy, Firestore, accounts or write side effects",()=>{
 const src=readFileSync(new URL("../tools/production/inspect-owner-list-deploy-aftermath-readonly.mjs",import.meta.url),"utf8");
 assert.match(src,/method:"GET"/);
 assert.doesNotMatch(src,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|runTransaction\(|method:"PATCH"|method:"POST"|signInWith/);
 assert.match(src,/safeToEnableCorrection:false/);
});
