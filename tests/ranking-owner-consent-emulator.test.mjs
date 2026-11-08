import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createRankingOwnerConsentService}
 from "../ranking/ranking-owner-consent-service.mjs";
import {createFreshCombinedRankingContext}
 from "../ranking/trusted-combined-ranking-context.mjs";
import {createOwnerRankingConsentStatusReader}
 from "../ranking/ranking-owner-consent-status.mjs";

const PROJECT="demo-nico-partner-ranking";
const LOCAL=/^(?:127[.]0[.]0[.]1|localhost):[0-9]{2,5}$/;
const requireAdmin=createRequire(
 new URL("../functions-partner-workspace/package.json",import.meta.url));
const {makeRankingOwnerCallables}=createRequire(import.meta.url)(
 "../functions-ranking-approvals/controller.cjs");
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
  const status=createOwnerRankingConsentStatusReader({db});
  const initial=await status(approval(hubOwner));
  assert.deepEqual(initial.partners.map(x=>({
   id:x.partnerCompanyId,own:x.ownApproved,other:x.otherApproved,version:x.version
  })),[{id:partner,own:false,other:false,version:0}]);
  // The real Firebase callable controller must re-verify every bearer and
  // current Auth profile, even if the callable SDK supplied request.auth.
  class MockHttpsError extends Error{
   constructor(code,message){super(message);this.code=code;}
  }
  const hubToken="H".repeat(40),partnerToken="P".repeat(40);
  const uidFromToken=token=>token===hubToken?hubOwner:
   token===partnerToken?partnerOwner:null;
  const callable=makeRankingOwnerCallables({
   db,FieldValue,HttpsError:MockHttpsError,enabled:()=>true,
   getAuth:()=>({
    verifyIdToken:async(token,revoke)=>{
     assert.equal(revoke,true);
     const uid=uidFromToken(token);
     if(!uid)throw Error("revoked_or_unknown_token");
     return {uid,email:approval(uid).email,email_verified:true};
    },
    getUser:async uid=>({
     uid,email:approval(uid).email,emailVerified:true,disabled:false
    })
   })
  });
  const request=(uid,data={})=>({
   data,auth:{uid,token:{email_verified:true,email:approval(uid).email}},
   rawRequest:{headers:{authorization:"Bearer "+
    (uid===hubOwner?hubToken:partnerToken)}}
  });
  const firstStatus=await callable.status(request(hubOwner));
  assert.equal(firstStatus.partners[0].ownApproved,false);
  const act=(uid,enable,expectedVersion)=>callable.save(request(uid,{
   partnerCompanyId:partner,enable,expectedVersion
  }));
  await assert.rejects(callable.save(request(hubOwner,{
   partnerCompanyId:partner,enable:true,expectedVersion:0,totalRevenue:100000
  })),e=>e.code==="invalid-argument");
  await assert.rejects(callable.status({
   ...request(hubOwner),auth:{uid:partnerOwner,token:{
    email_verified:true,email:approval(partnerOwner).email
   }}
  }),e=>e.code==="unauthenticated");
  await assert.rejects(callable.status({
   ...request(hubOwner),rawRequest:{headers:{}}
  }),e=>e.code==="unauthenticated");
  const first=await act(hubOwner,true,0);
  assert.deepEqual(first,{saved:true,enabled:true,partnerCompanyId:partner,version:1});
  const relationBefore=(await db.doc("partnerRelations/"+partner).get()).data();
  assert.equal(relationBefore.combinedRankingApprovedByHub,true);
  assert.equal(relationBefore.combinedRankingApprovedByPartner,undefined);
  const hubStatus=await status(approval(hubOwner));
  assert.equal(hubStatus.partners[0].ownApproved,true);
  assert.equal(hubStatus.partners[0].otherApproved,false);
  assert.equal(hubStatus.partners[0].version,1);
  await assert.rejects(createFreshCombinedRankingContext({db})(approval(partnerOwner)),/UNVERIFIED/);
  const second=await act(partnerOwner,true,0);
  assert.equal(second.version,1);
  const context=await createFreshCombinedRankingContext({db})(approval(partnerOwner));
  assert.deepEqual(context.approvedCompanyIds,[hub,partner]);
  assert.equal((await act(partnerOwner,true,1)).saved,false);
  await assert.rejects(act(partnerOwner,false,0),
   error=>error.code==="permission-denied"&&error.message==="ranking_owner_action_denied");
  const revoked=await act(partnerOwner,false,1);
  assert.equal(revoked.version,2);
  await assert.rejects(createFreshCombinedRankingContext({db})(approval(partnerOwner)),/UNVERIFIED/);
  const reapproved=await act(partnerOwner,true,2);
  assert.equal(reapproved.version,3);
  const callableStatus=await callable.status(request(partnerOwner));
  assert.equal(callableStatus.partners[0].version,3);
  assert.equal(callableStatus.partners[0].ownApproved,true);
  const partnerStatus=await status(approval(partnerOwner));
  assert.equal(partnerStatus.role,"partner_owner");
  assert.equal(partnerStatus.partners[0].ownApproved,true);
  assert.equal(partnerStatus.partners[0].otherApproved,true);
  assert.equal(partnerStatus.partners[0].version,3);
  const again=await createFreshCombinedRankingContext({db})(approval(partnerOwner));
  assert.deepEqual(again.approvedCompanyIds,[hub,partner]);
  await assert.rejects(act(partnerOwner,false,1),
   error=>error.code==="permission-denied"&&error.message==="ranking_owner_action_denied");
  assert.equal((await db.doc("companies/"+partner+"/rankingApprovals/"+hub).get())
   .data().version,3);
  assert.equal((await db.doc("partnerRelations/"+partner).get()).data()
   .individualNamesApprovedByHub,true);
  assert.equal((await db.doc("partnerRelations/"+partner).get()).data()
   .individualNamesApprovedByPartner,true);
  const hubHistory=await db.collection("companies").doc(hub)
   .collection("rankingApprovalAudits").get();
  const partnerHistory=await db.collection("companies").doc(partner)
   .collection("rankingApprovalAudits").get();
  assert.equal(hubHistory.size,1);
  assert.equal(partnerHistory.size,3);
  assert.equal((await db.doc("records/immutable-ranking-consent-finance").get())
   .data().totalRevenue,oldMoney.totalRevenue);
  assert.deepEqual((await db.doc("records/immutable-ranking-consent-finance").get())
   .data(),oldMoney);
 }finally{await deleteApp(app);}
});
