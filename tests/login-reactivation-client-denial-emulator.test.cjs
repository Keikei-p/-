"use strict";
/** Emulator only. Never use production credentials or perform real writes. */
const {test,before,beforeEach,after}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const {initializeTestEnvironment,assertFails,assertSucceeds}=
 require("@firebase/rules-unit-testing");
const {
 doc,getDoc,updateDoc,setDoc,serverTimestamp,writeBatch
}=require("firebase/firestore");
const PROJECT="demo-sales-support";
const CID="verified_company",OWNER="main_owner",STAFF="disabled_staff",OUTSIDER="outsider";
const host=process.env.FIRESTORE_EMULATOR_HOST||"";
if(!/^(?:localhost|127\.0\.0\.1):\d{2,5}$/.test(host)||
  process.env.GOOGLE_APPLICATION_CREDENTIALS||
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
  process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_PROJECT_ID!==PROJECT||
  process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==PROJECT)
 throw Error("STOP_LOGIN_RECOVERY_RULES_EMULATOR_ONLY");
let env;
const db=uid=>env.authenticatedContext(uid,{
 email:uid+"@example.invalid",email_verified:true
}).firestore();
const userDoc=(d,uid)=>doc(d,"users",uid);
const memberDoc=(d,uid)=>doc(d,"companies",CID,"members",uid);
async function seed(){
 await env.withSecurityRulesDisabled(async context=>{
  const d=context.firestore();
  await setDoc(doc(d,"companies",CID),{
   name:"Nico Factory",ownerUid:OWNER,masterUid:OWNER,active:true,
   companyKind:"internal",createdAt:serverTimestamp()
  });
  for(const uid of [OWNER,STAFF]){
   const active=uid===OWNER;
   const data={uid,companyId:CID,active,
    companyRole:active?"owner":"member",
    role:active?"leader":"member",
    teamId:active?null:"team_A",name:active?"主Owner":"停止スタッフ",
    email:uid+"@example.invalid",accessKind:"internal",memberType:"internal",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
   };
   await setDoc(userDoc(d,uid),data);
   await setDoc(memberDoc(d,uid),data);
  }
  await setDoc(userDoc(d,OUTSIDER),{
   uid:OUTSIDER,companyId:"different_company",active:true,
   companyRole:"owner",role:"leader",teamId:null,
   email:OUTSIDER+"@example.invalid",name:"外部",
   accessKind:"internal",createdAt:serverTimestamp()
  });
 });
}
before(async()=>{
 const rules=readFileSync(resolve(__dirname,"../firestore.rules"),"utf8");
 assert.match(rules,/match \/users\/\{userId\}/);
 assert.match(rules,/match \/members\/\{memberId\}/);
 assert.doesNotMatch(rules,/match \/loginReactivationAudit\//);
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules}});
});
beforeEach(async()=>{await env.clearFirestore();await seed()});
after(async()=>{await env?.cleanup()});
test("primary Owner cannot single-field activate suspended users or members directly",async()=>{
 const d=db(OWNER);
 await assertFails(updateDoc(userDoc(d,STAFF),{active:true,updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(memberDoc(d,STAFF),{active:true,updatedAt:serverTimestamp()}));
 const u=(await getDoc(userDoc(d,STAFF))).data();
 const m=(await getDoc(memberDoc(d,STAFF))).data();
 assert.equal(u.active,false);
 assert.equal(m.active,false);
});
test("secondary account cannot self-reactivate even with valid verified email",async()=>{
 const d=db(STAFF);
 await assertFails(updateDoc(userDoc(d,STAFF),{active:true,updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(memberDoc(d,STAFF),{active:true,updatedAt:serverTimestamp()}));
});
test("atomic client batch cannot reactivate both documents to evade single-update rules",async()=>{
 const d=db(OWNER),batch=writeBatch(d);
 batch.update(userDoc(d,STAFF),{active:true,updatedAt:serverTimestamp()});
 batch.update(memberDoc(d,STAFF),{active:true,updatedAt:serverTimestamp()});
 await assertFails(batch.commit());
 const after=(await getDoc(userDoc(d,STAFF))).data();
 assert.equal(after.active,false);
});
test("cross-company and anonymous client cannot activate suspended account",async()=>{
 const outsider=db(OUTSIDER);
 await assertFails(updateDoc(userDoc(outsider,STAFF),{active:true,updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(memberDoc(outsider,STAFF),{active:true,updatedAt:serverTimestamp()}));
 const anon=env.unauthenticatedContext().firestore();
 await assertFails(updateDoc(userDoc(anon,STAFF),{active:true,updatedAt:serverTimestamp()}));
});
test("recovery audit collection cannot be forged or overwritten by any browser identity",async()=>{
 for(const uid of [OWNER,STAFF,OUTSIDER]){
  const d=db(uid),target=doc(d,"loginReactivationAudit","fake_recovery");
  await assertFails(setDoc(target,{
   kind:"owner-approved-internal-login-reactivation",
   hubCompanyId:CID,ownerUid:OWNER,targetUid:STAFF,
   reasonCode:"OWNER_CONFIRMED_ACCOUNT_RESTORE",
   createdAt:serverTimestamp()
  }));
 }
});
test("normal Owner self-profile rename still works with existing Rules",async()=>{
 const d=db(OWNER);
 await assertSucceeds(updateDoc(userDoc(d,OWNER),{
  name:"更新した主Owner",updatedAt:serverTimestamp()
 }));
 const after=(await getDoc(userDoc(d,OWNER))).data();
 assert.equal(after.name,"更新した主Owner");
 assert.equal(after.active,true);
});
test("all fake test refs are scoped to localhost emulator and project, no production writes",()=>{
 assert.equal(PROJECT,"demo-sales-support");
 assert.match(host,/^(?:localhost|127\.0\.0\.1):/);
 assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||"","");
});
