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
