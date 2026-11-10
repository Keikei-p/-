"use strict";
/**
 * Separate from all existing live sales, count-save and ranking Functions.
 * OFF by default. Before real-account finance GET/LIST denial is proven,
 * NEVER enable NICO_PARTNER_OWNER_CLAIM_ENABLED in production.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {createPartnerOwnerClaimCallables}=require("./partner-owner-claim.cjs");
initializeApp();
const backend=createPartnerOwnerClaimCallables({
 db:getFirestore(),FieldValue,Timestamp,getAuth,HttpsError,
 enabled:()=>process.env.NICO_PARTNER_OWNER_CLAIM_ENABLED==="enabled"
});
const settings={
 region:"asia-northeast1",maxInstances:2,concurrency:10,
 cors:["https://nico-factory.web.app"]
};
exports.issuePartnerOwnerClaimInvite=onCall(settings,backend.issue);
exports.previewPartnerOwnerClaimInvite=onCall(settings,backend.preview);
exports.acceptPartnerOwnerClaimInvite=onCall(settings,backend.accept);
