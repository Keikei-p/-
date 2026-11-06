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
 // OFF unless specifically authorized after independent production proofs.
 legacyGateActivationEnabled:()=>process.env.NICO_LEGACY_COUNT_GATE_ACTIVATION==="approved"
});
const opts={region:"asia-northeast1",maxInstances:3,
 cors:["https://nico-factory.web.app"]};
exports.getPartnerWorkspace=onCall(opts,service.view);
// Separate read-only monthly saved-count totals; NOT published in this Draft PR.
exports.getPartnerSavedMonthlyCounts=onCall(opts,service.viewSavedMonth);
// Joint provisional saved-count ranking: never return internal sales/prices.
exports.getPartnerCombinedMonthlyCounts=onCall(opts,service.viewCombinedMonth);
exports.getPartnerPublishedCatalog=onCall(opts,service.getPublishedCatalog);
exports.setPartnerPublishedProduct=onCall(opts,service.setPublishedProduct);
exports.getPartnerLegacyCountGate=onCall(opts,service.getLegacyGate);
exports.activatePartnerLegacyCountGate=onCall(opts,service.activateLegacyCountGate);
exports.getPartnerAdditionalCounts=onCall(opts,service.viewAdditionalCounts);
exports.submitPartnerAdditionalCounts=onCall(opts,service.submitAdditionalCounts);
exports.managePartnerWorkspace=onCall(opts,service.manage);
exports.acceptPartnerWorkspaceInvite=onCall(opts,service.accept);
exports.submitPartnerWorkspaceCounts=onCall(opts,service.submit);
// Non-destructive SB光 / SoftBank Air classification; old count ledger untouched.
exports.getPartnerInternetSplitDay=onCall(opts,service.viewInternetSplitDay);
exports.getPartnerInternetSplitMonth=onCall(opts,service.viewInternetSplitMonth);
exports.submitPartnerInternetSplit=onCall(opts,service.submitInternetSplit);
const codeAuth=makeCompanyCodeAuth({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_COMPANY_CODE_AUTH_ENABLED==="enabled"
});
exports.issuePartnerCompanyCode=onCall(opts,codeAuth.issue);
exports.activatePartnerCompanyCode=onCall(opts,codeAuth.activate);
exports.loginPartnerCompanyCode=onCall(opts,codeAuth.login);
exports.logoutPartnerCompanyCode=onCall(opts,codeAuth.logout);
