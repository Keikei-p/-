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
 enabled:()=>process.env.PARTNER_WORKSPACE_ENABLED==="enabled"
});
const opts={region:"asia-northeast1",maxInstances:3,
 cors:["https://nico-factory.web.app"]};
exports.getPartnerWorkspace=onCall(opts,service.view);
// Explicit opt-in: bounded monthly COUNT-ONLY projection, never deploy by CI.
exports.getPartnerMonthlySharedCounts=onCall(opts,service.viewMonthly);
exports.managePartnerWorkspace=onCall(opts,service.manage);
exports.acceptPartnerWorkspaceInvite=onCall(opts,service.accept);
exports.submitPartnerWorkspaceCounts=onCall(opts,service.submit);
// New isolated catalog callables: do not redeploy legacy functions without a reviewed release.
exports.getPartnerCatalog=onCall(opts,service.viewCatalog);
exports.setPartnerCatalogPublication=onCall(opts,service.setCatalogPublication);
exports.getPartnerRankingGroups=onCall(opts,service.getPartnerRankingGroups);
exports.setPartnerRankingGroups=onCall(opts,service.setPartnerRankingGroups);
exports.getPartnerCountLinks=onCall(opts,service.getPartnerCountLinks);
exports.setPartnerCountLink=onCall(opts,service.setPartnerCountLink);
// Isolated ledger: never writes original nine categories, original sales or price metadata.
exports.getPartnerAdditionalCounts=onCall(opts,service.viewAdditionalCounts);
exports.submitPartnerAdditionalCounts=onCall(opts,service.submitAdditionalCounts);
const codeAuth=makeCompanyCodeAuth({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_COMPANY_CODE_AUTH_ENABLED==="enabled"
});
exports.issuePartnerCompanyCode=onCall(opts,codeAuth.issue);
exports.activatePartnerCompanyCode=onCall(opts,codeAuth.activate);
exports.loginPartnerCompanyCode=onCall(opts,codeAuth.login);
exports.logoutPartnerCompanyCode=onCall(opts,codeAuth.logout);
