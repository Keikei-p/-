"use strict";
/**
 * STAGING ONLY — NO DEPLOY. Both Functions disabled unless EXPLICIT flags.
 * No production index import, existing Firebase Functions remain unchanged.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makeExplicitHubOwnerVerifier}=
 require("../owner-delegation-v1/verified-hub-owner.cjs");
const {makeOwnerLoginRecovery}=require("./service.cjs");
initializeApp();
const readEnabled=()=>process.env.OWNER_LOGIN_RECOVERY_READ_ENABLED==="enabled";
const writeEnabled=()=>readEnabled()&&
 process.env.OWNER_LOGIN_RECOVERY_WRITE_ENABLED==="enabled";
const db=getFirestore();
const verifyHubOwner=makeExplicitHubOwnerVerifier({
 db,getAuth,HttpsError,enabled:readEnabled
});
const service=makeOwnerLoginRecovery({
 db,getAuth,FieldValue,HttpsError,verifyHubOwner,
 enabledRead:readEnabled,enabledWrite:writeEnabled
});
const options=Object.freeze({
 region:"asia-northeast1",minInstances:0,maxInstances:2,
 cors:["https://nico-factory.web.app"]
});
exports.listOwnerLoginRecovery=onCall(options,service.list);
exports.reactivateOwnerLoginMember=onCall(options,service.reactivate);
