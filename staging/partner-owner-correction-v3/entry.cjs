"use strict";
/**
 * STAGING ONLY. Future isolated Cloud Functions codebase.
 * NEVER deploy this source directory directly: the approved bundle must
 * be prepared and reviewed separately. No production index is changed.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeAuthenticatedOwnerCorrectionV3}=require("./trusted-auth.cjs");
initializeApp();
const service=makeAuthenticatedOwnerCorrectionV3({
 db:getFirestore(),getAuth,FieldValue,HttpsError,
 enabled:()=>process.env.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled"
});
const options={
 region:"asia-northeast1",
 maxInstances:2,
 minInstances:0,
 cors:["https://nico-factory.web.app"]
};
exports.listHubPartnerCounts=onCall(options,service.list);
exports.correctHubPartnerCounts=onCall(options,service.correct);
