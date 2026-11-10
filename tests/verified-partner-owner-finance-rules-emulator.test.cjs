"use strict";
/**
 * Demo-only real Firebase Firestore Rules emulator. Auth simulated with
 * partner Owner's exact post-accept profile, never a live customer token.
 * Checks GET and LIST of each financial original path on unchanged Rules.
 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {initializeTestEnvironment,assertSucceeds,assertFails}
 =require("@firebase/rules-unit-testing");
const {doc,setDoc,getDoc,collection,query,where,getDocsFromServer}
 =require("firebase/firestore");
const project="demo-partner-owner-claim";
const LOCAL=/^(?:127[.]0[.]0[.]1|localhost):[0-9]{2,5}$/;
test("Rules emulator: new verified partner Owner CANNOT raw GET or LIST any Hub finance originals, Hub owner remains able to read",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,
 timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==project||
    process.env.GCLOUD_PROJECT!==project||
    !LOCAL.test(process.env.FIRESTORE_EMULATOR_HOST)||
    process.env.GOOGLE_APPLICATION_CREDENTIALS||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error("REFUSE_LIVE_PARTNER_FINANCE_TEST");
 const rules=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
 const env=await initializeTestEnvironment({
  projectId:project,firestore:{rules}
 });
 const hub="demoHub",p="partner1",ownerUid="hubOwner",
  partnerOwner="verifiedPartnerOwner";
 const hubOwnerProfile={
  uid:ownerUid,companyId:hub,companyRole:"owner",role:"leader",
  active:true,accessKind:"internal",memberType:"direct",
  canViewRevenue:true,canViewUnitPrice:true
 };
 const verifiedPartnerProfile={
  uid:partnerOwner,companyId:p,companyRole:"owner",role:"leader",
  active:true,authKind:"verified_partner_owner",memberType:"cooperator",
  accessKind:"partner",canViewRevenue:false,canViewUnitPrice:false,
  canCreateInvite:false,teamId:null
 };
 const initial={
  product:{companyId:hub,name:"NURO光",revenue:50000,
   cashbackOptions:[1000,5000],pricingOptions:[{name:"標準",price:10000}]},
  record:{companyId:hub,totalRevenue:130000,uid:ownerUid,totalCount:3,
   results:{NURO:{count:3,revenuePerUnit:50000}}},
  correction:{companyId:hub,recordId:"financeRecord",before:{totalRevenue:100000},
   after:{totalRevenue:130000}},
  goal:{companyId:hub,month:"2026-11",targetRevenue:800000}
 };
 try{
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   for(const [path,value]of [
    ["companies/"+hub,{name:"NICO",ownerUid:ownerUid,
     companyKind:"internal",active:true}],
    ["companies/"+p,{name:"協力店",companyKind:"partner",
     hubCompanyId:hub,ownerUid:partnerOwner,active:true,
     companyCodePrincipalUid:"pc_secret",masterUid:"pc_secret"}],
    ["users/"+ownerUid,hubOwnerProfile],
    ["users/"+partnerOwner,verifiedPartnerProfile],
    ["companies/"+hub+"/members/"+ownerUid,hubOwnerProfile],
    ["companies/"+p+"/members/"+partnerOwner,verifiedPartnerProfile],
    ["products/financeProduct",initial.product],
    ["records/financeRecord",initial.record],
    ["recordCorrections/financeCorrection",initial.correction],
    ["revenueGoals/financeGoal",initial.goal]
   ])await setDoc(doc(db,path),value);
  });
  const auth={email:"partner@example.test",email_verified:true};
  const actor=env.authenticatedContext(partnerOwner,auth).firestore();
  const valid=env.authenticatedContext(ownerUid,{
   email:"hub@example.test",email_verified:true
  }).firestore();
  for(const [coll,id]of [
   ["products","financeProduct"],["records","financeRecord"],
   ["recordCorrections","financeCorrection"],["revenueGoals","financeGoal"]
  ]){
   await assertFails(getDoc(doc(actor,coll,id)));
   await assertFails(getDocsFromServer(query(
    collection(actor,coll),where("companyId","==",hub)
   )));
   // Original authorized company retains access to its business originals.
   const snap=await assertSucceeds(getDoc(doc(valid,coll,id)));
   assert.equal(snap.exists(),true);
  }
  // Verify through privileged EMULATOR control that no financial documents
  // were mutated during any of the partner's denied client reads.
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   const pdoc=(await getDoc(doc(db,"companies",p))).data();
   assert.equal(pdoc.ownerUid,partnerOwner);
   assert.equal(pdoc.companyCodePrincipalUid,"pc_secret");
   for(const [coll,id,key,value]of [
    ["products","financeProduct","revenue",50000],
    ["records","financeRecord","totalRevenue",130000],
    ["recordCorrections","financeCorrection","recordId","financeRecord"],
    ["revenueGoals","financeGoal","targetRevenue",800000]
   ]){
    const docu=(await getDoc(doc(db,coll,id))).data();
    assert.equal(docu[key],value);
   }
  });
 }finally{await env.cleanup();}
});
