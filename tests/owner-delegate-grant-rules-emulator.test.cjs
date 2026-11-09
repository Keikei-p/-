"use strict";
/**
 * READ-ONLY PRODUCTION GUARD: Execute ONLY against an isolated demo
 * Firestore Emulator. No production Admin credentials and no data migration.
 */
const {test,before,beforeEach,after}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {initializeTestEnvironment,assertFails,assertSucceeds}=
 require("@firebase/rules-unit-testing");
const {doc,setDoc,getDoc,updateDoc,serverTimestamp}=require("firebase/firestore");
const PROJECT="demo-sales-support";
const CID="company-owner-delegate-test";
const PRIMARY="existing-primary",SECONDARY="verified-secondary",OUTSIDER="unrelated-account";
if(!/^(?:localhost|127\.0\.0\.1):\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST||"")||
   process.env.GOOGLE_APPLICATION_CREDENTIALS||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
   process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_PROJECT_ID!==PROJECT||
   process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==PROJECT)
 throw Error("STOP_OWNER_DELEGATE_RULES_EMULATOR_ONLY");
let env;
const getDb=uid=>env.authenticatedContext(uid,{
 email:uid+"@test.invalid",email_verified:true
}).firestore();
async function setup(){
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,"companies",CID),{
   name:"Nico Factory",ownerUid:PRIMARY,masterUid:PRIMARY,
   companyKind:"internal",active:true,
   approvedHubOwnerUids:[],ownerGrantVersion:0,
   updatedAt:serverTimestamp()
  });
  for(const uid of [PRIMARY,SECONDARY]){
   const u={uid,companyId:CID,companyRole:"owner",
    role:"leader",active:true,accessKind:"internal",memberType:"internal"};
   await setDoc(doc(db,"users",uid),u);
   await setDoc(doc(db,"companies",CID,"members",uid),u);
  }
  await setDoc(doc(db,"users",OUTSIDER),{
   uid:OUTSIDER,companyId:"unrelated-company",companyRole:"owner",
   role:"leader",active:true,accessKind:"internal"
  });
 });
}
before(async()=>{
 const rules=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
 assert.match(rules,/match \/companies\/\{companyId\}/);
 assert.match(rules,/hasOnly\(\['name', 'updatedAt'\]\)/);
 assert.match(rules,/hasOnly\(\['ownerUid', 'updatedAt'\]\)/);
 assert.match(rules,/hasOnly\(\['masterUid', 'updatedAt'\]\)/);
 assert.doesNotMatch(rules,/match \/ownerDelegateAudit\//);
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules}});
});
beforeEach(async()=>{await env.clearFirestore();await setup()});
after(async()=>{await env?.cleanup()});
const companyRef=uid=>doc(getDb(uid),"companies",CID);

test("primary cannot directly add approvedHubOwnerUids or change grant version",async()=>{
 for(const updates of [
  {approvedHubOwnerUids:[SECONDARY]},
  {ownerGrantVersion:1},
  {approvedHubOwnerUids:[SECONDARY],ownerGrantVersion:1},
  {approvedHubOwnerUids:[SECONDARY],ownerGrantVersion:1,updatedAt:serverTimestamp()},
  {ownerUid:SECONDARY,approvedHubOwnerUids:[SECONDARY],updatedAt:serverTimestamp()},
  {masterUid:SECONDARY,approvedHubOwnerUids:[SECONDARY],updatedAt:serverTimestamp()}
 ]){
  await assertFails(updateDoc(companyRef(PRIMARY),updates));
 }
 const afterResult=(await getDoc(companyRef(PRIMARY))).data();
 assert.deepEqual(afterResult.approvedHubOwnerUids,[]);
 assert.equal(afterResult.ownerGrantVersion,0);
 assert.equal(afterResult.ownerUid,PRIMARY);
});
test("secondary with companyRole owner cannot self-grant or alter primary UID",async()=>{
 for(const changes of [
  {approvedHubOwnerUids:[SECONDARY],updatedAt:serverTimestamp()},
  {approvedHubOwnerUids:[PRIMARY],updatedAt:serverTimestamp()},
  {ownerGrantVersion:999},
  {ownerUid:SECONDARY,updatedAt:serverTimestamp()},
  {masterUid:SECONDARY,approvedHubOwnerUids:[SECONDARY],updatedAt:serverTimestamp()}
 ]){
  await assertFails(updateDoc(companyRef(SECONDARY),changes));
 }
});
test("unrelated account and anonymous caller cannot change same company's grants",async()=>{
 await assertFails(updateDoc(companyRef(OUTSIDER),{
  approvedHubOwnerUids:[OUTSIDER],ownerGrantVersion:2
 }));
 const anonymous=env.unauthenticatedContext().firestore();
 await assertFails(updateDoc(doc(anonymous,"companies",CID),{
  approvedHubOwnerUids:[OUTSIDER]
 }));
});
test("no client can create or overwrite append-only ownerDelegateAudit",async()=>{
 for(const actor of [PRIMARY,SECONDARY,OUTSIDER]){
  const db=getDb(actor);
  const target=doc(db,"ownerDelegateAudit","audit-1");
  await assertFails(setDoc(target,{
   kind:"hub-owner-explicit-delegate",hubCompanyId:CID,
   primaryOwnerUid:PRIMARY,delegatedOwnerUid:SECONDARY,
   action:"approve",previousVersion:0,nextVersion:1,
   createdAt:serverTimestamp()
  }));
 }
});
test("existing company rename and legitimate master transfer remain available",async()=>{
 await assertSucceeds(updateDoc(companyRef(PRIMARY),{
  name:"Nico Factory updated",updatedAt:serverTimestamp()
 }));
 const renamed=(await getDoc(companyRef(PRIMARY))).data();
 assert.equal(renamed.name,"Nico Factory updated");
 await assertSucceeds(updateDoc(companyRef(PRIMARY),{
  masterUid:SECONDARY,updatedAt:serverTimestamp()
 }));
 const afterResult=(await getDoc(companyRef(PRIMARY))).data();
 assert.equal(afterResult.masterUid,SECONDARY);
 assert.equal(afterResult.ownerUid,PRIMARY);
 assert.deepEqual(afterResult.approvedHubOwnerUids,[]);
 assert.equal(afterResult.ownerGrantVersion,0);
});
test("master transfer cannot smuggle delegate fields even after primary changes",async()=>{
 await assertSucceeds(updateDoc(companyRef(PRIMARY),{
  masterUid:SECONDARY,updatedAt:serverTimestamp()
 }));
 await assertFails(updateDoc(companyRef(SECONDARY),{
  masterUid:PRIMARY,
  approvedHubOwnerUids:[SECONDARY],
  ownerGrantVersion:1,updatedAt:serverTimestamp()
 }));
 const data=(await getDoc(companyRef(PRIMARY))).data();
 assert.equal(data.masterUid,SECONDARY);
 assert.deepEqual(data.approvedHubOwnerUids,[]);
 assert.equal(data.ownerGrantVersion,0);
});
