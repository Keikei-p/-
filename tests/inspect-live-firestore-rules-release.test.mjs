import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectLiveFirestoreRules}
 from "../tools/production/inspect-live-firestore-rules-release.mjs";
import {proposeSecondaryFinanceFence}
 from "../security/secondary-finance-read-fence.mjs";
const PROJECT="sales-management-cc116";
const HOST="https://firebaserules.googleapis.com/v1/";
const RELEASE="projects/"+PROJECT+"/releases/cloud.firestore";
const SECOND=RELEASE+"/(default)";
const RULESET="projects/"+PROJECT+"/rulesets/verified_20261109";
const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const ok=data=>({status:200,json:async()=>data});
function fake(source,{release=RELEASE,ruleName=RULESET,files=null,
 releaseStatus=200,ruleStatus=200}={}){
 const urls=[];
 const read=async url=>{
  urls.push(url);
  if(url===HOST+RELEASE){
   if(releaseStatus===404)return {status:404};
   return releaseStatus===200?ok({name:release,rulesetName:ruleName}):
    {status:releaseStatus};
  }
  if(url===HOST+SECOND)
   return ok({name:release,rulesetName:ruleName});
  if(url===HOST+RULESET)return ruleStatus===200?
   ok({name:ruleName,source:{files:files??[{name:"firestore.rules",content:source}]}}):
   {status:ruleStatus};
  throw Error("UNEXPECTED_URL");
 };
 return {read,urls};
}
test("exact live source match to main is evidence of deployment only, not real partner finance denial",async()=>{
 const f=fake(rules);
 const report=await inspectLiveFirestoreRules(f.read,rules);
 assert.deepEqual(f.urls,[HOST+RELEASE,HOST+RULESET]);
 assert.equal(report.deployedSourceExactlyMatchesReviewedMain,true);
 assert.equal(report.deployedSourceExactlyMatchesSecondaryFenceCandidate,false);
 assert.equal(report.productionPartnerFinanceGetListDeniedProven,false);
 assert.equal(report.safeToEnableJointRanking,false);
 assert.equal(report.firestoreReads,0);
 assert.equal(report.firebaseRulesWrites,0);
 assert(!JSON.stringify(report).includes("service cloud.firestore"));
});
test("live secondary fence has exact fingerprint but still requires real account checks",async()=>{
 const f=fake(proposeSecondaryFinanceFence(rules));
 const report=await inspectLiveFirestoreRules(f.read,rules);
 assert.equal(report.deployedSourceExactlyMatchesReviewedMain,false);
 assert.equal(report.deployedSourceExactlyMatchesSecondaryFenceCandidate,true);
 assert.equal(report.productionPartnerIdentityMarkersVerified,false);
 assert.equal(report.safeToApplyFinanceRules,false);
});
test("unreviewed deployed text is explicitly BLOCK even if it resembles financial fence",async()=>{
 const f=fake(rules+"\n// local unauthorized change\n");
 const report=await inspectLiveFirestoreRules(f.read,rules);
 assert.equal(report.deployedSourceUnexpected,true);
 assert.equal(report.deployedSourceExactlyMatchesReviewedMain,false);
 assert.equal(report.deployedSourceExactlyMatchesSecondaryFenceCandidate,false);
 assert.equal(report.safeToEnableJointRanking,false);
});
test("default firestore release may have explicit /(default) alias, never guess other releases",async()=>{
 const f=fake(rules,{release:SECOND,releaseStatus:404});
 const report=await inspectLiveFirestoreRules(f.read,rules);
 assert.equal(report.deployedSourceExactlyMatchesReviewedMain,true);
 assert.deepEqual(f.urls,[HOST+RELEASE,HOST+SECOND,HOST+RULESET]);
});
test("unknown/other-project release, ruleset, multiple source files or service denial is rejected",async()=>{
 for(const opt of [
  {release:"projects/other/releases/cloud.firestore"},
  {release:RELEASE+"/tenant"},
  {ruleName:"projects/another-project/rulesets/verified_20261109"},
  {ruleName:"projects/"+PROJECT+"/rulesets/../../danger"},
  {files:[{name:"firestore.rules",content:rules},{name:"other",content:rules}]},
  {files:[]},
  {files:[{name:"firestore.rules",content:null}]},
  {releaseStatus:403},
  {ruleStatus:403}
 ]){
  const f=fake(rules,opt);
  await assert.rejects(inspectLiveFirestoreRules(f.read,rules),
   /STOP_LIVE_FIRESTORE_RULES_/);
 }
});
test("missing or unreliable release cannot be called secure",async()=>{
 for(const read of [
  async()=>({status:404}),
  async()=>{throw Error("secret bearer oauth");},
  async()=>({status:200,json:async()=>{throw Error("raw rules source");}}),
 ]){
  await assert.rejects(inspectLiveFirestoreRules(read,rules),
   /STOP_LIVE_FIRESTORE_RULES_/);
 }
});
test("changing the immutable main rules anchor refuses comparison",async()=>{
 await assert.rejects(inspectLiveFirestoreRules(fake(rules).read,
  rules+"\n// unauthorized source\n"),/STOP_LIVE_FIRESTORE_RULES_CANDIDATE_SOURCE_UNVERIFIED/);
});
test("workflow is auto-triggered only for main live GET and has no Rules writes or production tests",()=>{
 const w=readFileSync(new URL("../.github/workflows/nico-live-rules-release-readonly.yml",import.meta.url),"utf8");
 const source=readFileSync(new URL("../tools/production/inspect-live-firestore-rules-release.mjs",import.meta.url),"utf8");
 assert.match(w,/github\.event_name == 'push'/);
 assert.match(w,/node tools\/production\/inspect-live-firestore-rules-release\.mjs/);
 assert.match(w,/test "\$\(git hash-object firestore.rules\)"/);
 assert.doesNotMatch(w,/firebase deploy|rules:release|firebase firestore:delete|--only firestore|gcloud firestore/);
 assert.match(source,/method:"GET"/);
 assert.doesNotMatch(source,/method:"POST"|method:"PUT"|method:"PATCH"|method:"DELETE"/);
 assert.doesNotMatch(source,/console\.log\(release|console\.log\(source|console\.log\(token/);
});
