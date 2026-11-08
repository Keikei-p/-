import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createRankingOwnerConsentService}
 from "../ranking/ranking-owner-consent-service.mjs";
import {createFreshCombinedRankingContext}
 from "../ranking/trusted-combined-ranking-context.mjs";

const PROJECT="demo-nico-partner-ranking";
const LOCAL=/^(?:127[.]0[.]0[.]1|localhost):[0-9]{2,5}$/;
const requireAdmin=createRequire(
 new URL("../functions-partner-workspace/package.json",import.meta.url));
test("real Firestore Admin demo emulator: two owners sign independently, revoke transactionally; finance originals untouched",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.GCLOUD_PROJECT!==PROJECT||
    !LOCAL.test(process.env.FIRESTORE_EMULATOR_HOST)||
    process.env.GOOGLE_APPLICATION_CREDENTIALS||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error("STOP_RANKING_CONSENT_NOT_EMULATOR");
 const {initializeApp,deleteApp}=requireAdmin("firebase-admin/app");
 const {getFirestore,FieldValue}=requireAdmin("firebase-admin/firestore");
 const app=initializeApp({projectId:PROJECT},"ranking-consent-write-only-demo");
 const db=getFirestore(app);
 const names={hub:"hubConsentWrite",partner:"partnerConsentWrite",
  hubOwner:"hubConsentOwner",partnerOwner:"partnerConsentOwner"};
 const {hub,partner,hubOwner,partnerOwner}=names;
 const write=(path,value)=>db.doc(path).set(value);
 const approval=(uid)=>({uid,email:(uid+"@example.test").toLowerCase(),emailVerified:true});
 try{
  await Promise.all([
   write("companies/"+hub,{name:"自社",companyKind:"internal",
    active:true,ownerUid:hubOwner}),
   write("companies/"+partner,{name:"協力店",companyKind:"partner",
    active:true,ownerUid:partnerOwner,hubCompanyId:hub}),
   write("partnerRelations/"+partner,{
    partnerCompanyId:partner,hubCompanyId:hub,active:true,
    countSharingApproved:true}),
   write("records/immutable-ranking-consent-finance",{
    companyId:hub,unitPrice:42000,totalRevenue:123000,cashback:6000})
  ]);
  for(const [uid,cid,access,type] of [
   [hubOwner,hub,"internal","direct"],
   [partnerOwner,partner,"partner","cooperator"]
  ]){
   const profile={uid,companyId:cid,active:true,
    email:(uid+"@example.test").toLowerCase(),
    companyRole:"owner",role:"leader",accessKind:access,memberType:type,
    canViewRevenue:access==="internal",canViewUnitPrice:access==="internal"};
   await Promise.all([
    write("users/"+uid,profile),
    write("companies/"+cid+"/members/"+uid,profile)
   ]);
  }
  const oldMoney=(await db.doc("records/immutable-ranking-consent-finance").get()).data();
  const service=createRankingOwnerConsentService({db,FieldValue});
  const act=(uid,enable,expectedVersion)=>service({
   auth:approval(uid),partnerCompanyId:partner,enable,expectedVersion});
  const first=await act(hubOwner,true,0);
  assert.deepEqual(first,{saved:true,enabled:true,partnerCompanyId:partner,version:1});
  const relationBefore=(await db.doc("partnerRelations/"+partner).get()).data();
  assert.equal(relationBefore.combinedRankingApprovedByHub,true);
  assert.equal(relationBefore.combinedRankingApprovedByPartner,undefined);
  await assert.rejects(createFreshCombinedRankingContext({db})(approval(partnerOwner)),/UNVERIFIED/);
  const second=await act(partnerOwner,true,0);
  assert.equal(second.version,1);
  const context=await createFreshCombinedRankingContext({db})(approval(partnerOwner));
  assert.deepEqual(context.approvedCompanyIds,[hub,partner]);
  assert.equal((await act(partnerOwner,true,1)).saved,false);
  await assert.rejects(act(partnerOwner,false,0),/STALE/);
  const revoked=await act(partnerOwner,false,1);
  assert.equal(revoked.version,2);
  await assert.rejects(createFreshCombinedRankingContext({db})(approval(partnerOwner)),/UNVERIFIED/);
  assert.equal((await db.doc("partnerRelations/"+partner).get()).data()
   .individualNamesApprovedByHub,true);
  assert.equal((await db.doc("partnerRelations/"+partner).get()).data()
   .individualNamesApprovedByPartner,false);
  const hubHistory=await db.collection("companies").doc(hub)
   .collection("rankingApprovalAudits").get();
  const partnerHistory=await db.collection("companies").doc(partner)
   .collection("rankingApprovalAudits").get();
  assert.equal(hubHistory.size,1);
  assert.equal(partnerHistory.size,2);
  assert.equal((await db.doc("records/immutable-ranking-consent-finance").get())
   .data().totalRevenue,oldMoney.totalRevenue);
  assert.deepEqual((await db.doc("records/immutable-ranking-consent-finance").get())
   .data(),oldMoney);
 }finally{await deleteApp(app);}
});
