"use strict";
/**
 * STAGING ONLY — NO DEPLOY.
 * Isolated Firebase Functions v2 codebase candidate for explicitly approved
 * secondary Owner grants. Importing this file does not update any Cloud
 * Functions, Firestore Rules, financial records or user/owner affiliations.
 * Production release requires a separate owner-approved, reviewed package.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeExplicitHubOwnerVerifier}=require("./verified-hub-owner.cjs");
const {makeOwnerDelegateApproval}=require("./owner-approval-service.cjs");

initializeApp();
// LIST and CHANGE are separate release gates: an early read-only rollout
// must never implicitly activate the transaction that writes Owner grants.
const listEnabled=()=>process.env.HUB_OWNER_DELEGATE_LIST_ENABLED==="enabled";
const changeEnabled=()=>listEnabled()&&
 process.env.HUB_OWNER_DELEGATE_CHANGE_ENABLED==="enabled";
const db=getFirestore();
const makeService=enabled=>{
 const verifyHubOwner=makeExplicitHubOwnerVerifier({
  db,getAuth,HttpsError,enabled
 });
 return makeOwnerDelegateApproval({
  db,getAuth,FieldValue,HttpsError,verifyHubOwner,enabled
 });
};
const readService=makeService(listEnabled);
const writeService=makeService(changeEnabled);
const options=Object.freeze({
 region:"asia-northeast1",
 minInstances:0,
 maxInstances:2,
 cors:["https://nico-factory.web.app"]
});
exports.listHubOwnerDelegates=onCall(options,readService.list);
exports.changeHubOwnerDelegate=onCall(options,writeService.change);
