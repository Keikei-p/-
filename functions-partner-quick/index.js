"use strict";
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall}=require("firebase-functions/v2/https");
const {HttpsError}=require("firebase-functions/v2/https");
const {makeQuickCounts}=require("./quick-counts.cjs");
initializeApp();
const service=makeQuickCounts({
 db:getFirestore(),getAuth,FieldValue,HttpsError,
 enabled:()=>process.env.PARTNER_QUICK_COUNTS_ENABLED==="enabled"
});
const opts={region:"asia-northeast1",maxInstances:3,
 cors:["https://nico-factory.web.app"]};
exports.submitPartnerQuickCounts=onCall(opts,service.submit);
exports.getPartnerQuickCounts=onCall(opts,service.view);
