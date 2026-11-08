import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {createFreshCombinedRankingContext,createVerifiedRankTokenReader}
 from "../ranking/trusted-combined-ranking-context.mjs";

const PROJECT="demo-nico-partner-ranking";
const LOCAL=/^(?:127[.]0[.]0[.]1|localhost):[0-9]{2,5}$/;
const requireAdmin=createRequire(new URL("../functions-partner-workspace/package.json",import.meta.url));
test("REAL isolated Firestore emulator: independent owner consents are Admin-only, revoked access fails",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.GCLOUD_PROJECT!==PROJECT||
    !LOCAL.test(process.env.FIRESTORE_EMULATOR_HOST)||
    process.env.GOOGLE_APPLICATION_CREDENTIALS||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error("STOP_NOT_ISOLATED_RANKING_FIRESTORE_EMULATOR");
 const {initializeApp,deleteApp}=requireAdmin("firebase-admin/app");
 const {getFirestore}=requireAdmin("firebase-admin/firestore");
 const {initializeTestEnvironment,assertFails}=await import("@firebase/rules-unit-testing");
 const {doc,getDoc,setDoc,getDocsFromServer,collection}=
   await import("firebase/firestore");
 const app=initializeApp({projectId:PROJECT},"ranking-consent-emulator-only");
 const db=getFirestore(app);
 const env=await initializeTestEnvironment({
  projectId:PROJECT,firestore:{rules:readFileSync(
   new URL("../firestore.rules",import.meta.url),"utf8")}
 });
 const hub="hub",partner="partner",hubOwner="hubOwner",partnerOwner="partnerOwner";
 const write=(path,obj)=>db.doc(path).set(obj);
 const relation={
  hubCompanyId:hub,partnerCompanyId:partner,active:true,
  countSharingApproved:true,
  combinedRankingApprovedByHub:true,combinedRankingApprovedByPartner:true,
  individualNamesApprovedByHub:true,individualNamesApprovedByPartner:true
 };
 try{
  await Promise.all([
   write("companies/"+hub,{companyKind:"internal",active:true,ownerUid:hubOwner}),
   write("companies/"+partner,{
    companyKind:"partner",active:true,ownerUid:partnerOwner,hubCompanyId:hub}),
   write("partnerRelations/"+partner,relation)
  ]);
  for(const [uid,cid,kind,type] of [
   [hubOwner,hub,"internal","direct"],[partnerOwner,partner,"partner","cooperator"]
  ]){
   const profile={uid,companyId:cid,companyRole:"owner",role:"leader",
    email:uid+"@example.test",active:true,accessKind:kind,memberType:type,
    canViewRevenue:kind==="internal",canViewUnitPrice:kind==="internal"};
   await Promise.all([
    write("users/"+uid,profile),
    write("companies/"+cid+"/members/"+uid,profile)
   ]);
  }
  const approval=(cid,owner)=>({
   companyId:cid,hubCompanyId:hub,partnerCompanyId:partner,
   approvedByUid:owner,active:true,scope:"combined_rank_only",version:1,
   combinedRankingApproved:true,individualNamesApproved:true
  });
  const hubConsent="companies/"+hub+"/rankingApprovals/"+partner;
  const partnerConsent="companies/"+partner+"/rankingApprovals/"+hub;
  await Promise.all([
   write(hubConsent,approval(hub,hubOwner)),
   write(partnerConsent,approval(partner,partnerOwner))
  ]);
  const fresh=createFreshCombinedRankingContext({db});
  for(const uid of [hubOwner,partnerOwner]){
   const verify=createVerifiedRankTokenReader({auth:{
    verifyIdToken:async(_token,revoked)=>{
     assert.equal(revoked,true);
     return {uid,email:uid+"@example.test",email_verified:true};
    },
    getUser:async()=>({uid,email:uid+"@example.test",
     disabled:false,emailVerified:true})
   }});
   const principal=await verify("x".repeat(32));
   const ctx=await fresh(principal);
   assert.equal(ctx.hubCompanyId,hub);
   assert.deepEqual(ctx.approvedCompanyIds,[hub,partner]);
   const browser=env.authenticatedContext(uid,{
    email:uid+"@example.test",email_verified:true}).firestore();
   for(const path of [hubConsent,partnerConsent]){
    await assertFails(getDoc(doc(browser,path)));
    await assertFails(setDoc(doc(browser,path),{
     ...approval(hub,hubOwner),active:true
    }));
   }
   await assertFails(getDocsFromServer(collection(browser,
    "companies",hub,"rankingApprovals")));
  }
  await db.doc(partnerConsent).update({active:false});
  await assert.rejects(fresh({uid:partnerOwner,
   email:partnerOwner+"@example.test",emailVerified:true}),
   /UNVERIFIED/);
  assert.equal((await db.doc(hubConsent).get()).data().active,true);
 }finally{
  await env.cleanup();
  await deleteApp(app);
 }
});
