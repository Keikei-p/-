"use strict";
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeWorkspace}=require("./service.cjs");
const {makeCompanyCodeAuth}=require("./company-code-auth.cjs");
const {makeInternalMemberExit}=require("./internal-member-exit.cjs");
const {makeInternalSelfAccountExit}=require("./internal-self-account-exit.cjs");
initializeApp();
const service=makeWorkspace({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_WORKSPACE_ENABLED==="enabled",
 // Must be explicitly enabled only after approved SKU mapping and finance proof.
 sharedRankingEnabled:()=>process.env.NICO_PARTNER_SHARED_RANKING_ENABLED==="enabled",
 // Separate hard OFF: existing count save/correction behavior is unchanged
 // until owner SKU publication, finance denial and restore are verified.
 submissionPublicationEnabled:()=>process.env.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"
});
const opts={region:"asia-northeast1",maxInstances:3,
 cors:["https://nico-factory.web.app"]};
exports.getPartnerWorkspace=onCall(opts,service.view);
exports.managePartnerWorkspace=onCall(opts,service.manage);
exports.acceptPartnerWorkspaceInvite=onCall(opts,service.accept);
exports.submitPartnerWorkspaceCounts=onCall(opts,service.submit);
const codeAuth=makeCompanyCodeAuth({
 db:getFirestore(),getAuth,FieldValue,Timestamp,HttpsError,
 enabled:()=>process.env.PARTNER_COMPANY_CODE_AUTH_ENABLED==="enabled"
});
exports.issuePartnerCompanyCode=onCall(opts,codeAuth.issue);
exports.activatePartnerCompanyCode=onCall(opts,codeAuth.activate);
exports.loginPartnerCompanyCode=onCall(opts,codeAuth.login);
exports.logoutPartnerCompanyCode=onCall(opts,codeAuth.logout);

// Separate default-OFF internal exit; never cascade-delete Auth or records.
const internalMemberExit=makeInternalMemberExit({
 db:getFirestore(),getAuth,FieldValue,HttpsError,
 enabled:()=>process.env.SAFE_INTERNAL_MEMBER_REMOVAL_ENABLED==="enabled"
});
exports.removeInternalCompanyMember=onCall(opts,internalMemberExit.remove);

// Default OFF. Requires a separate signed release review before enabling.
const selfAccountExit=makeInternalSelfAccountExit({
 db:getFirestore(),getAuth,FieldValue,HttpsError,
 enabled:()=>process.env.SAFE_INTERNAL_SELF_ACCOUNT_DELETE_ENABLED==="enabled"
});
exports.deleteOwnInternalAccountSafely=onCall(opts,selfAccountExit.remove);
