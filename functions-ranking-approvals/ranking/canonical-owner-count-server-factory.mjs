/**
 * STAGING ONLY / NOT REGISTERED AS HTTP ROUTE OR CLOUD FUNCTION.
 * The first complete count-only wiring for the reviewed owner publication:
 * Firebase Auth -> fresh mutual owner consents -> canonical internal and
 * partner monthly ledgers + SKU mapping + owner ON/OFF in the same read-only
 * transaction -> count-only public ranking.
 *
 * SAFE DEFAULT OFF. No Firestore writes, financial document projection,
 * mutable browser role flags, Hosting change, function registration or deploy.
 * Requires owner-authenticated mapping creation + real account finance deny
 * before the outer deployment gate may enable this module in production.
 */
import {createStagedOwnerVisibleCountHandler}
 from "./owner-visible-count-server-handler.mjs";
import {createStagedAtomicOwnerCountLoader}
 from "./owner-visible-count-atomic-loader.mjs";
import {createCanonicalCountTransactionReader}
 from "./canonical-joint-count-sku-reader.mjs";
import {createAtomicOwnerPublicationReader}
 from "./owner-product-visibility-in-atomic-tx.mjs";

export function createCanonicalOwnerCountSnapshot({
 db,FieldValue,clock
}={}){
 if(!db||!FieldValue||
    typeof db.collection!=="function"||
    typeof db.runTransaction!=="function"||
    typeof FieldValue.serverTimestamp!=="function")
  throw Error("CANONICAL_OWNER_COUNT_DEPENDENCY_MISSING");
 return createStagedAtomicOwnerCountLoader({
  db,
  loadCountsInTransaction:createCanonicalCountTransactionReader({db,clock}),
  loadPublicationInTransaction:createAtomicOwnerPublicationReader({
   db,FieldValue
  })
 });
}

/**
 * Feature-enabled only after external release gate. Do NOT register this
 * as a route until the live finance, backing store and rollback proofs pass.
 */
export function createCanonicalOwnerCountHandler({
 enabled=false,auth,db,FieldValue,clock
}={}){
 if(enabled!==true)return createStagedOwnerVisibleCountHandler({
  enabled:false
 });
 if(!auth||typeof auth.verifyIdToken!=="function"||
    typeof auth.getUser!=="function")
  throw Error("CANONICAL_OWNER_COUNT_AUTH_MISSING");
 const loadAtomicVerifiedCountSnapshot=createCanonicalOwnerCountSnapshot({
  db,FieldValue,clock
 });
 return createStagedOwnerVisibleCountHandler({
  enabled:true,auth,db,FieldValue,loadAtomicVerifiedCountSnapshot
 });
}
