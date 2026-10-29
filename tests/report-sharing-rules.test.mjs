import test,{before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,setDoc,getDoc,serverTimestamp,updateDoc} from "firebase/firestore";
import {buildReportSharingRules} from "../reports/report-sharing-rules.mjs";

if(!process.env.FIRESTORE_EMULATOR_HOST)
  throw Error("LOCAL FIRESTORE EMULATOR REQUIRED; production access blocked");
const base=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const candidate=buildReportSharingRules(base);
let env;
const company="report-hub";
const dbFor=uid=>env.authenticatedContext(uid,{
 email:uid+"@example.test",email_verified:true
}).firestore();
const settings=(user="owner",values={})=>({
 enabled:true,weekdays:[1,2,3,4,5,6,0],time:"19:00",
 reportCompletionMode:"individual",lineEnabled:true,
 lineGroupId:"G_test_group",updatedBy:user,updatedAt:serverTimestamp(),
 ...values
});
before(async()=>{
 env=await initializeTestEnvironment({
  projectId:"demo-sales-report-sharing",
  firestore:{rules:candidate}
 });
});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  for(const [cid,owner] of [[company,"owner"],["other-company","otherOwner"]]){
   await setDoc(doc(db,"companies",cid),{name:"synthetic",ownerUid:owner,masterUid:owner,active:true});
  }
  for(const [uid,cid,role] of [
   ["owner",company,"owner"],["leader",company,"member"],
   ["partner",company,"member"],["otherOwner","other-company","owner"]
  ]){
   const user={uid,companyId:cid,name:uid,companyRole:role,role:"leader",
    teamId:"team1",active:true};
   await setDoc(doc(db,"users",uid),user);
   await setDoc(doc(db,"companies",cid,"members",uid),user);
  }
 });
});
after(async()=>{await env?.cleanup();});

test("staging extension changes only settings block, not existing financial or record rules",()=>{
 assert.notEqual(base,candidate);
 const start=base.indexOf("match /settings/{settingId}");
 const end=base.indexOf("match /linePairingCodes/",start);
 const startNew=candidate.indexOf("match /settings/{settingId}");
 const endNew=candidate.indexOf("match /linePairingCodes/",startNew);
 assert.equal(base.slice(0,start),candidate.slice(0,startNew));
 assert.equal(base.slice(end),candidate.slice(endNew));
 assert.match(candidate,/countsShareApproved/);
});

test("owner can save both-side share fields without rewriting previous settings",async()=>{
 const db=dbFor("owner"),ref=doc(db,"companies",company,"settings","notifications");
 await assertSucceeds(setDoc(ref,settings()));
 const before=(await getDoc(ref)).data();
 await assertSucceeds(updateDoc(ref,{
  aggregatePartnerReports:true,
  linkedCompanyIds:["other-company"],
  partnerTeamIds:["partner-team"],
  updatedBy:"owner",updatedAt:serverTimestamp()
 }));
 const after=(await getDoc(ref)).data();
 assert.equal(after.enabled,before.enabled);
 assert.equal(after.lineGroupId,before.lineGroupId);
 assert.deepEqual(after.linkedCompanyIds,["other-company"]);
 await assertSucceeds(updateDoc(ref,{
  aggregatePartnerReports:false,
  linkedCompanyIds:[],updatedBy:"owner",updatedAt:serverTimestamp()
 }));
});

test("leader and partner in same company cannot toggle cross-company sharing",async()=>{
 const ref=doc(dbFor("owner"),"companies",company,"settings","notifications");
 await assertSucceeds(setDoc(ref,settings()));
 for(const actor of ["leader","partner","otherOwner"]){
  await assertFails(updateDoc(doc(dbFor(actor),"companies",company,"settings","notifications"),{
    linkedCompanyIds:["other-company"],
    aggregatePartnerReports:true,
    updatedBy:actor,updatedAt:serverTimestamp()
  }));
 }
});
test("owner can revoke approval; invalid types and unexpected keys are rejected",async()=>{
 const db=dbFor("owner"),ref=doc(db,"companies",company,"settings","notifications");
 await assertSucceeds(setDoc(ref,settings()));
 await assertSucceeds(updateDoc(ref,{
  countsShareApproved:true,linkedHubCompanyId:"other-company",
  countsShareLineGroupId:"G_other",
  updatedBy:"owner",updatedAt:serverTimestamp()
 }));
 await assertSucceeds(updateDoc(ref,{
  countsShareApproved:false,updatedBy:"owner",updatedAt:serverTimestamp()
 }));
 for(const bad of [
  {linkedCompanyIds:"not-a-list"},
  {partnerTeamIds:"not-a-list"},
  {linkedCompanyIds:Array(31).fill("other-company")},
  {partnerTeamIds:Array(101).fill("team1")},
  {countsShareApproved:"yes"},
  {aggregatePartnerReports:1},
  {unknownMoneyField:100000}
 ]){
  await assertFails(updateDoc(ref,{
   ...bad,updatedBy:"owner",updatedAt:serverTimestamp()
  }));
 }
});
