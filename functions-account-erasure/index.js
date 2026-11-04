"use strict";
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeAccountErasure}=require("./service.cjs");
initializeApp();
const service=makeAccountErasure({
 db:getFirestore(),getAuth,FieldValue,HttpsError,
 enabled:()=>process.env.NICO_ACCOUNT_ERASURE_ENABLED==="enabled"
});
const opts={region:"asia-northeast1",maxInstances:1,
 cors:["https://nico-factory.web.app"]};
// Named independently from legacy suspend-only deleteCompanyMemberAccount.
// Never repurpose that existing operation for hard deletion.
exports.previewManagedAccountErasure=onCall(opts,service.preview);
exports.listManagedAccountErasurePending=onCall(opts,service.listPending);
exports.confirmManagedAccountErasure=onCall(opts,service.confirm);
