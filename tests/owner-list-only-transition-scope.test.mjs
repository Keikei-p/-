import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 TARGET,exactListOnlyTarget,inspectBeforeOwnerListOnly,
 inspectAfterOwnerListOnly,assertReadOnlyListSource
} from "../tools/production/owner-list-only-transition-scope.mjs";
const make=(name,flag,options={})=>({
 id:"projects/sales-management-cc116/locations/asia-northeast1/functions/"+name,
 projectId:"sales-management-cc116",region:"asia-northeast1",
 codebase:"hub-owner-correction-v3",platform:"gcfv2",state:"ACTIVE",
 environmentVariables:{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:flag},
 updateTime:options.updateTime||"2026-11-09T01:00:00.000Z"
});
const base=()=>({result:[
 make("listHubPartnerCounts","disabled"),
 make("correctHubPartnerCounts","disabled"),
 {id:"projects/sales-management-cc116/locations/asia-northeast1/functions/getPartnerWorkspace",
  state:"ACTIVE",region:"asia-northeast1",updateTime:"2026-11-08T01:00:00Z"}
]});
const changed=()=>{const b=base();b.result[0]=make("listHubPartnerCounts","enabled",
 {updateTime:"2026-11-09T02:00:00.000Z"});return b};
test("exact one-function selector cannot broaden activation to writer",()=>{
 assert.equal(exactListOnlyTarget(TARGET),TARGET);
 for(const bad of [
  "functions:hub-owner-correction-v3:correctHubPartnerCounts",
  "functions:hub-owner-correction-v3:listHubPartnerCounts,functions:hub-owner-correction-v3:correctHubPartnerCounts",
  "functions","functions:hub-owner-correction-v3",""
 ])assert.throws(()=>exactListOnlyTarget(bad),/STOP_OWNER_LIST_ONLY_UNREVIEWED_TARGET/);
});
test("before disabled, after list enabled and writer remains metadata-byte-identical",()=>{
 const before=base(),after=changed();
 assert.equal(inspectBeforeOwnerListOnly(before).correctionDisabled,true);
 const result=inspectAfterOwnerListOnly(before,after);
 assert.equal(result.enabledReadOnlyCallable,true);
 assert.equal(result.correctionFunctionStillDisabled,true);
 assert.equal(result.originalWriterMetadataUnchanged,true);
 assert.equal(result.replacedFunctionCount,1);
 assert.equal(result.addedFunctions,0);
 assert.equal(result.dataWrites,0);
 assert.equal(result.authenticatedOwnerRuntimeTested,false);
});
test("writer activation, writer metadata changes, original Function drift and set changes are rejected",()=>{
 const cases=[
  (()=>{const x=changed();x.result[1].environmentVariables.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED="enabled";return x})(),
  (()=>{const x=changed();x.result[1].updateTime="2026-11-09T02:00:00Z";return x})(),
  (()=>{const x=changed();x.result[2].updateTime="CHANGED";return x})(),
  (()=>{const x=changed();x.result.push({...x.result[2],id:x.result[2].id+"_rogue"});return x})(),
  (()=>{const x=changed();x.result.splice(1,1);return x})()
 ];
 for(const after of cases)assert.throws(
  ()=>inspectAfterOwnerListOnly(base(),after),/STOP_OWNER_LIST_ONLY_/);
});
test("preflight fails if either target is already enabled or renamed",()=>{
 const wrong=base();wrong.result[0].environmentVariables.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED="enabled";
 assert.throws(()=>inspectBeforeOwnerListOnly(wrong),/STOP_OWNER_LIST_ONLY_NOT_BOTH_DISABLED/);
 const missing=base();missing.result.pop();missing.result.shift();
 assert.throws(()=>inspectBeforeOwnerListOnly(missing),/STOP_OWNER_LIST_ONLY_/);
});
test("actual frozen staged list code contains no writes and is exclusively scoped",()=>{
 const entry=readFileSync(new URL("../staging/partner-owner-correction-v3/entry.cjs",import.meta.url),"utf8");
 const service=readFileSync(new URL("../staging/partner-owner-correction-v3/service.cjs",import.meta.url),"utf8");
 assert.equal(assertReadOnlyListSource({entry,service}),true);
 assert.throws(()=>assertReadOnlyListSource({
  entry,service:service.replace(" async function correct(request){"," tx.update(er,{counts:{}});\n async function correct(request){")
 }),/STOP_OWNER_LIST_ONLY_READ_SERVICE_CONTRACT_CHANGED/);
});
