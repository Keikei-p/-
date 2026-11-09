"use strict";
/**
 * Distinct deployment codebase. Not included in existing workspace functions.
 * FEATURE FLAG DEFAULT OFF. Do not deploy until live finance isolation,
 * backup restore and real-account count save/correction are confirmed.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,onRequest,HttpsError}=require("firebase-functions/v2/https");
const {createJointCountHttpAdapter}=require("./joint-count-http-adapter.cjs");
const {makeRankingOwnerCallables}=require("./controller.cjs");
const {makeProductVisibilityCallables}=require("./product-visibility-controller.cjs");
initializeApp();
const service=makeRankingOwnerCallables({
 db:getFirestore(),FieldValue,getAuth,HttpsError,
 enabled:()=>process.env.NICO_RANKING_OWNER_SETTINGS_ENABLED==="enabled"
});
const options={
 region:"asia-northeast1",maxInstances:2,concurrency:10,
 cors:["https://nico-factory.web.app"]
};
exports.getRankingOwnerConsentStatus=onCall(options,service.status);
exports.setRankingOwnerConsent=onCall(options,service.save);
const visibility=makeProductVisibilityCallables({
 db:getFirestore(),FieldValue,getAuth,HttpsError,
 enabled:()=>process.env.NICO_OWNER_PRODUCT_VISIBILITY_ENABLED==="enabled"
});
exports.getOwnerProductVisibility=onCall(options,visibility.load);
exports.setOwnerProductVisibility=onCall(options,visibility.save);
/**
 * ADDITIVE STAGING ONLY: standalone ranking GET endpoint.
 * No existing count-write or finance Functions are changed.
 * The production flag is absent => 503 with zero Firestore/Auth reads.
 * Hosting /v1 rewrite, live Rules proof and release signoff are separate
 * deployment prerequisites. Never expose raw records or payment fields.
 */
exports.getVerifiedJointCountRanking=onRequest({
 region:"asia-northeast1",maxInstances:2,concurrency:10,cors:false
},createJointCountHttpAdapter({
 enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled",
 loadHandler:async()=>{
  const {createCanonicalOwnerCountHandler}=await import(
   "./ranking/canonical-owner-count-server-factory.mjs"
  );
  return createCanonicalOwnerCountHandler({
   enabled:true,auth:getAuth(),db:getFirestore(),FieldValue
  });
 }
}));

