"use strict";
/**
 * Dedicated STAGING codebase. No modification to the original ranking,
 * workspace or financial Functions. NO DEPLOY from GitHub push.
 *
 * Feature flag is default OFF, and must remain OFF until backend data
 * projection / Owner settings UI / Emulator finance + membership gates are
 * verified. This module alone does not publish any partner tab to production.
 */
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {makePartnerTabPublicationCallables}=require("./controller.cjs");
initializeApp();
const options={region:"asia-northeast1",maxInstances:2,concurrency:10,
 cors:["https://nico-factory.web.app"]};
const service=makePartnerTabPublicationCallables({
 db:getFirestore(),FieldValue,getAuth,HttpsError,
 enabled:()=>process.env.NICO_PARTNER_TAB_PUBLICATION_ENABLED==="enabled",
 // New isolated report/daily/history/goal server route remains separately OFF.
 optionalDataEnabled:()=>process.env.NICO_PARTNER_OPTIONAL_TAB_DATA_VERIFIED==="enabled"
});
exports.getOwnerPartnerTabPublication=onCall(options,service.loadOwner);
exports.setOwnerPartnerTabPublication=onCall(options,service.saveOwner);
exports.getPartnerPublishedTabs=onCall(options,service.loadPartner);

// Partner tab content is available ONLY after both independent release gates
// and current Owner policy/membership verification in one read-only transaction.
exports.getPartnerPublishedOptionalTab=onCall(options,service.loadOptional);
