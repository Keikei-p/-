"use strict";
// Run ONLY via firebase emulators:exec --project demo-sales-support --only firestore.
// No production credential, site or database access is permitted.
const test=require("node:test");
const assert=require("node:assert/strict");
const {initializeApp,deleteApp}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {requireFactory}=require("../partner-company-invitations.cjs");
const crypto=require("node:crypto");
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error("FIRESTORE_EMULATOR_HOST required");
const project="demo-sales-support";
const app=initializeApp({projectId:project},"nico-partner-onboarding-emulator");
const db=getFirestore(app);
const unique=crypto.randomBytes(8).toString("hex");
const hub="testHub_"+unique,owner="testOwner_"+unique,guest="testGuest_"+unique;
const now=Date.parse("2026-10-30T12:00:00Z");
class CallError extends Error{constructor(code,message){super(message);this.code=code;}}
const users={
 [owner]:{uid:owner,email:"owner@example.test",emailVerified:true,disabled:false},
 [guest]:{uid:guest,email:"partner@example.test",emailVerified:true,disabled:false}
};
const bearer={
 ["o".repeat(30)]:owner,["g".repeat(30)]:guest
};
const auth={
 getUser:async uid=>users[uid],
 verifyIdToken:async token=>{
  const uid=bearer[token];if(!uid)throw Error("invalid");
  return {uid,email:users[uid].email,email_verified:true};
 }
};
const routes=requireFactory({
 db,getAuth:()=>auth,FieldValue,Timestamp,HttpsError:CallError,
 enabled:()=>true,now:()=>now
});
const req=(uid,data={})=>({
 auth:{uid,token:{email:users[uid].email,email_verified:true}},
 rawRequest:{headers:{authorization:"Bearer "+(uid===owner?"o":"g").repeat(30)}},
 data
});
test("Firestore emulator: accept once, separate company, preserve existing hub and original user",async()=>{
 const hubRef=db.doc("companies/"+hub),ownerRef=db.doc("users/"+owner),
 memberRef=db.doc("companies/"+hub+"/members/"+owner);
 const originalHub={name:"社内",ownerUid:owner,active:true,companyKind:"internal"};
 const originalOwner={uid:owner,email:users[owner].email,companyId:hub,active:true,companyRole:"owner",accessKind:"internal"};
 await hubRef.set(originalHub);
 await ownerRef.set(originalOwner);
 await memberRef.set({...originalOwner,role:"leader"});
 const invitation=await routes.create(req(owner,{email:users[guest].email,companyName:"協力店"}));
 const beforeOwner=(await ownerRef.get()).data();
 const beforeHub=(await hubRef.get()).data();
 const info=await routes.preview(req(guest,{token:invitation.token}));
 assert.equal(info.partnerCompanyName,"協力店");
 const accepted=await routes.accept(req(guest,{token:invitation.token}));
 assert.notEqual(accepted.partnerCompanyId,hub);
 const newCompany=(await db.doc("companies/"+accepted.partnerCompanyId).get()).data();
 const newMember=(await db.doc("companies/"+accepted.partnerCompanyId+"/members/"+guest).get()).data();
 const newUser=(await db.doc("users/"+guest).get()).data();
 const relation=(await db.doc("partnerRelations/"+accepted.partnerCompanyId).get()).data();
 assert.equal(newCompany.companyKind,"partner");
 assert.equal(newCompany.hubCompanyId,hub);
 assert.equal(newMember.companyId,accepted.partnerCompanyId);
 assert.equal(newMember.accessKind,"partner");
 assert.equal(newUser.companyId,accepted.partnerCompanyId);
 assert.equal(newUser.canViewRevenue,false);
 assert.equal(newMember.canViewUnitPrice,false);
 assert.equal(relation.active,false);
 assert.equal(relation.countSharingApproved,false);
 assert.deepEqual((await hubRef.get()).data(),beforeHub);
 assert.deepEqual((await ownerRef.get()).data(),beforeOwner);
 await assert.rejects(routes.accept(req(guest,{token:invitation.token})));
 await assert.rejects(routes.preview(req(guest,{token:invitation.token})));
});
test.after(async()=>deleteApp(app));
