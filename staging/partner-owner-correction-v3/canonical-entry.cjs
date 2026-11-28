"use strict";
// STAGING / NO DEPLOY. Package only through the exact-pinned integrated builder.
// Reuse the same verified count transaction as get/submitPartnerWorkspaceCounts.
// Do not create a second correction ledger or export any other callable.
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeWorkspace}=require("./service.cjs");
initializeApp();
const ownerEnabled=()=>process.env.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled";
const service=makeWorkspace({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:ownerEnabled,ownerCorrectionReadEnabled:ownerEnabled,
 ownerCorrectionWriteEnabled:ownerEnabled,
 submissionPublicationEnabled:()=>process.env.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled",
 individualCountInputEnabled:()=>process.env.NICO_PARTNER_INDIVIDUAL_COUNT_INPUT_ENABLED==="enabled"
});
const options={region:"asia-northeast1",maxInstances:2,minInstances:0,
 cors:["https://nico-factory.web.app"]};
exports.listHubPartnerCounts=onCall(options,service.listHubPartnerCounts);
exports.correctHubPartnerCounts=onCall(options,service.correctHubPartnerCounts);
