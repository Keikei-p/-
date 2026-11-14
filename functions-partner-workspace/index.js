"use strict";
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeWorkspace}=require("./service.cjs");
const {makeCompanyCodeAuth}=require("./company-code-auth.cjs");
initializeApp();
const service=makeWorkspace({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_WORKSPACE_ENABLED==="enabled",
 // Must be explicitly enabled only after approved SKU mapping and finance proof.
 sharedRankingEnabled:()=>process.env.NICO_PARTNER_SHARED_RANKING_ENABLED==="enabled",
 // Separate hard OFF: existing count save/correction behavior is unchanged
 // until owner SKU publication, finance denial and restore are verified.
 submissionPublicationEnabled:()=>process.env.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled",
 // Independent gates; neither list nor correction is enabled by the workspace.
 ownerCorrectionReadEnabled:()=>process.env.NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED==="enabled",
 ownerCorrectionWriteEnabled:()=>process.env.NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED==="enabled"
});
const opts={region:"asia-northeast1",maxInstances:3,
 cors:["https://nico-factory.web.app"]};
exports.getPartnerWorkspace=onCall(opts,service.view);
exports.managePartnerWorkspace=onCall(opts,service.manage);
exports.acceptPartnerWorkspaceInvite=onCall(opts,service.accept);
exports.submitPartnerWorkspaceCounts=onCall(opts,service.submit);
exports.listHubPartnerCounts=onCall(opts,service.listHubPartnerCounts);
exports.correctHubPartnerCounts=onCall(opts,service.correctHubPartnerCounts);
const codeAuth=makeCompanyCodeAuth({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_COMPANY_CODE_AUTH_ENABLED==="enabled"
});
exports.issuePartnerCompanyCode=onCall(opts,codeAuth.issue);
exports.activatePartnerCompanyCode=onCall(opts,codeAuth.activate);
exports.loginPartnerCompanyCode=onCall(opts,codeAuth.login);
exports.logoutPartnerCompanyCode=onCall(opts,codeAuth.logout);
