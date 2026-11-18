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
const {createOwnerSkuMappingCallables}=require("./owner-sku-mapping-controller.cjs");
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
 * ADDITIVE STAGING: only the verified hub owner may review exact partner
 * category -> hub product IDs. OFF unless separately approved. Writes only
 * canonical mapping + append-only audit, never source counts or prices.
 */
const skuMapping=createOwnerSkuMappingCallables({
 db:getFirestore(),FieldValue,getAuth,HttpsError,
 enabled:()=>process.env.NICO_OWNER_SKU_MAPPING_ENABLED==="enabled"
});
exports.getOwnerReviewedSkuMapping=onCall(options,skuMapping.get);
exports.setOwnerReviewedSkuMapping=onCall(options,skuMapping.save);

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
 // Both release proofs MUST be enabled before any Auth/Firestore read.
 // Do not silently fall back to old owner-product publication settings.
 enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"&&
  process.env.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled",
 loadHandler:async()=>{
  const {createCanonicalOwnerCountHandler}=await import(
   "./ranking/canonical-owner-count-server-factory.mjs"
  );
  return createCanonicalOwnerCountHandler({
   enabled:true,auth:getAuth(),db:getFirestore(),FieldValue,
   // Same active hub catalog + original partner ledger, no extra Owner
   // merchant ON/OFF settings. Existing zero-setup linker matches only
   // unique canonical names/known legacy aliases; unmatched SKUs remain
   // distinct so historic counts can never silently vanish or double count.
   // Double release gate: BOTH env vars must explicitly be "enabled".
   // No new Fn endpoint, financial access path or Firestore write is added.
   // DO NOT enable until live finance denial, isolated restore and E2E pass.
   zeroSetupLink:process.env.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"
  });
 }
}));

