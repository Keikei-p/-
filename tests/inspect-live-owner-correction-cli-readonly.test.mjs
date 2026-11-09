import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyLiveOwnerCorrectionInventory} from
 "../tools/production/inspect-live-owner-correction-cli-readonly.mjs";
const NAMES=["listHubPartnerCounts","correctHubPartnerCounts"];
const f=(name,flags={HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:"disabled"})=>({
 id:"projects/sales-management-cc116/locations/asia-northeast1/functions/"+name,
 platform:"gcfv2",state:"ACTIVE",codebase:"hub-owner-correction-v3",
 environmentVariables:flags
});
const inspect=rows=>classifyLiveOwnerCorrectionInventory({result:rows});
test("both reviewed functions explicitly disabled are NOT proof of live writing",()=>{
 const x=inspect(NAMES.map(n=>f(n)));
 assert.equal(x.bothFunctionsActiveGen2,true);
 assert.equal(x.bothFunctionsExplicitlyDisabled,true);
 assert.equal(x.safeToClaimLiveCorrections,false);
 assert.equal(x.firestoreDocumentsRead,0);
 assert.equal(x.firestoreDocumentsWritten,0);
});
test("one successfully created function after failed deploy blocks subsequent blind retries",()=>{
 const x=inspect([f(NAMES[0])]);
 assert.equal(x.partialDeploy,true);
 assert.equal(x.functions[NAMES[0]].listed,true);
 assert.equal(x.functions[NAMES[1]].listed,false);
 assert.equal(x.bothFunctionsExplicitlyDisabled,false);
});
test("neither function listed is not deployed, NOT a successful release",()=>{
 const x=inspect([]);
 assert.equal(x.partialDeploy,false);
 assert.equal(x.bothFunctionsActiveGen2,false);
 assert.equal(x.bothFunctionsExplicitlyDisabled,false);
});
test("unknown flag, enabled flag, other region/project/codebase or Gen1 never certify disabled",()=>{
 for(const row of [
  f(NAMES[0],{}),
  f(NAMES[0],{HUB_OWNER_COUNT_CORRECTION_V3_ENABLED:"enabled"}),
  {...f(NAMES[0]),region:"us-central1"},
  {...f(NAMES[0]),codebase:"default"},
  {...f(NAMES[0]),platform:"gcfv1"},
  {...f(NAMES[0]),state:"FAILED"},
  {...f(NAMES[0]),id:"projects/other/locations/asia-northeast1/functions/listHubPartnerCounts"}
 ]){
  const x=inspect([row,f(NAMES[1])]);
  assert.equal(x.bothFunctionsExplicitlyDisabled,false);
 }
 const duplicate=inspect([f(NAMES[0]),f(NAMES[0]),f(NAMES[1])]);
 assert.equal(duplicate.bothFunctionsExplicitlyDisabled,false);
});
test("no sensitive metadata, source content or access tokens returned",()=>{
 const row={...f(NAMES[0]),secret:"auth_should_not_leak",
  serviceConfig:{environmentVariables:{SECRET:"do_not_print"}}};
 const report=JSON.stringify(inspect([row]));
 assert.equal(report.includes("auth_should_not_leak"),false);
 assert.equal(report.includes("do_not_print"),false);
 assert.equal(report.includes("firebaseapp.com"),false);
});
test("workflow is strict main-only GET inventory and no redeployment",()=>{
 const wf=readFileSync(new URL("../.github/workflows/nico-owner-correction-live-readonly-inventory.yml",import.meta.url),"utf8");
 const src=readFileSync(new URL("../tools/production/inspect-live-owner-correction-cli-readonly.mjs",import.meta.url),"utf8");
 assert.match(wf,/github\.event_name == 'push'/);
 assert.match(wf,/inspect-live-owner-correction-cli-readonly\.mjs/);
 assert.match(wf,/firebase functions:list/);
 assert.match(wf,/git hash-object firestore\.rules/);
 assert.doesNotMatch(wf,/firebase deploy|functions:delete|firebase firestore:delete|--only functions|upload-artifact/);
 assert.doesNotMatch(src,/setDoc\(|updateDoc\(|deleteDoc\(|firebase deploy/);
 assert.doesNotMatch(src,/console\.log\(data|console\.log\(row|console\.log\(flags/);
});
