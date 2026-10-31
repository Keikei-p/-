"use strict";
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeWorkspace}=require("./service.cjs");
initializeApp();
const service=makeWorkspace({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_WORKSPACE_ENABLED==="enabled",
 // Separate explicit activation gate. Default OFF even if the workspace is enabled.
 sharingApprovalEnabled:()=>process.env.PARTNER_SHARING_APPROVAL_ENABLED==="finance-reviewed"
});
const opts={region:"asia-northeast1",maxInstances:3,
 cors:["https://nico-factory.web.app"]};
exports.getPartnerWorkspace=onCall(opts,service.view);
exports.managePartnerWorkspace=onCall(opts,service.manage);
exports.acceptPartnerWorkspaceInvite=onCall(opts,service.accept);
exports.submitPartnerWorkspaceCounts=onCall(opts,service.submit);
