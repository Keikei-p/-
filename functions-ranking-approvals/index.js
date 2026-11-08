"use strict";
/**
 * Distinct deployment codebase. Not included in existing workspace functions.
 * FEATURE FLAG DEFAULT OFF. Do not deploy until live finance isolation,
 * backup restore and real-account count save/correction are confirmed.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeRankingOwnerCallables}=require("./controller.cjs");
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
