import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 PROJECT,RELEASE_URL,gitBlob,auditLiveFirestoreRules
} from "../tools/production/audit-live-firestore-rules-readonly.mjs";

const reviewed=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const RULESET="projects/"+PROJECT+"/rulesets/abc123456789";
const calls=[];
const fixture=(live=reviewed)=>async url=>{
 calls.push(url);
 if(url===RELEASE_URL)
  return {status:200,json:async()=>({
   name:"projects/"+PROJECT+"/releases/cloud.firestore",
   rulesetName:RULESET
  })};
 if(url==="https://firebaserules.googleapis.com/v1/"+RULESET)
  return {status:200,json:async()=>({
   name:RULESET,source:{files:[{name:"firestore.rules",content:live}]}
  })};
 throw Error("UNEXPECTED_REMOTE_URL");
};
test("reviewed original is immutable and live rules require precisely two metadata GETs",async()=>{
 calls.length=0;
 assert.equal(gitBlob(reviewed),"d9f4df6a2ac0f8b5720534a2461ec66b94379190");
 const outcome=await auditLiveFirestoreRules({read:fixture(),reviewedSource:reviewed});
 assert.deepEqual(calls,[
  RELEASE_URL,
  "https://firebaserules.googleapis.com/v1/"+RULESET
 ]);
 assert.equal(outcome.project,PROJECT);
 assert.equal(outcome.liveRulesMatchReviewedAndTested,true);
 assert.equal(outcome.exactReviewedSource,true);
 assert.equal(outcome.liveFinanceBoundaryMarkers,true);
 assert.equal(outcome.realPartnerGetListProven,false);
 assert.equal(outcome.productionWrites,0);
 assert.equal(outcome.userDataReads,0);
 assert.equal(outcome.deploys,0);
 assert.doesNotMatch(JSON.stringify(outcome),/abc123456789|pricingOptions|Bearer |privateCounts/i);
});
test("an old or insecure published Ruleset must NEVER be reported current",async()=>{
 calls.length=0;
 const previous=reviewed.replace(
  "&& company.get('companyKind', 'internal') == 'internal'",
  "&& true");
 assert.notEqual(previous,reviewed);
 const out=await auditLiveFirestoreRules({read:fixture(previous),reviewedSource:reviewed});
 assert.equal(out.exactReviewedSource,false);
 assert.equal(out.liveRulesMatchReviewedAndTested,false);
 assert.equal(out.realPartnerGetListProven,false);
 assert.equal(calls.length,2);
});
test("changed local finance rules hash fails closed BEFORE touching Firebase",async()=>{
 calls.length=0;
 await assert.rejects(auditLiveFirestoreRules({
  read:fixture(),reviewedSource:reviewed+" "
 }),/STOP_NICO_LIVE_RULES_READONLY_REVIEWED_RULES_CHANGED/);
 assert.equal(calls.length,0);
});
test("wrong release, foreign project ruleset, extra file, malicious response are rejected",async()=>{
 const bad=[
  {name:"projects/other/releases/cloud.firestore",rulesetName:RULESET},
  {name:"projects/"+PROJECT+"/releases/cloud.firestore",
   rulesetName:"projects/other/rulesets/abc123456789"},
  {name:"projects/"+PROJECT+"/releases/cloud.firestore",
   rulesetName:"projects/"+PROJECT+"/rulesets/../../admin"},
  {}
 ];
 for(const release of bad){
  await assert.rejects(auditLiveFirestoreRules({
   reviewedSource:reviewed,
   read:async()=>({status:200,json:async()=>release})
  }),/STOP_NICO_LIVE_RULES_READONLY_RELEASE_UNVERIFIED/);
 }
 for(const content of [
  {name:RULESET,source:{files:[]}},
  {name:RULESET,source:{files:[
   {name:"A",content:reviewed},{name:"B",content:reviewed}
  ]}},
  {name:RULESET,source:{files:[{name:"A",content:42}]}},
  {name:"projects/other/rulesets/abc123456789",
   source:{files:[{name:"firestore.rules",content:reviewed}]}}
 ]){
  await assert.rejects(auditLiveFirestoreRules({
   reviewedSource:reviewed,
   read:async url=>url===RELEASE_URL?{
    status:200,json:async()=>({
     name:"projects/"+PROJECT+"/releases/cloud.firestore",
     rulesetName:RULESET
    })
   }:{status:200,json:async()=>content}
  }),/STOP_NICO_LIVE_RULES_READONLY_RULESET_UNVERIFIED/);
 }
});
test("permission denial and invalid HTTP never count as verified release",async()=>{
 for(const code of [401,403,404,429,500]){
  await assert.rejects(auditLiveFirestoreRules({
   reviewedSource:reviewed,
   read:async()=>({status:code,json:async()=>({})})
  }),/STOP_NICO_LIVE_RULES_READONLY_/);
 }
 await assert.rejects(auditLiveFirestoreRules({
  reviewedSource:reviewed,
  read:async()=>{throw Error("private token or audit credential")}
 }),/STOP_NICO_LIVE_RULES_READONLY_GET_UNVERIFIED/);
});
test("auditor never exposes financial documents, account secrets or uses writes",()=>{
 const source=readFileSync(new URL("../tools/production/audit-live-firestore-rules-readonly.mjs",import.meta.url),"utf8");
 assert.match(source,/method:"GET"/);
 assert.match(source,/FIREBASE_PROJECT_ID!==PROJECT/);
 assert.match(source,/realPartnerGetListProven:false/);
 assert.doesNotMatch(source,/method:"POST"|method:"PATCH"|method:"DELETE"|firebase deploy|setDoc\(|getDoc\(|fetch\("https:\/\/firestore/);
 assert.doesNotMatch(source,/\b(?:const|let|var)\s+URL\s*=/);
});
