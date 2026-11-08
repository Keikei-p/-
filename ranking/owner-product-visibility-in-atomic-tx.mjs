/**
 * STAGING ONLY / NO DEPLOY.
 * Connect the real, server-owned rankingProductVisibility document and
 * product catalog to the existing atomic count loader's SAME transaction.
 * No HTTP route, production Function or financial collection is touched.
 */
import {createOwnerProductVisibilityStore}
 from "./owner-product-visibility-firestore.mjs";

export function createAtomicOwnerPublicationReader({db,FieldValue}={}){
 const store=createOwnerProductVisibilityStore({db,FieldValue});
 return async ({tx,context}={})=>store.readForRankingInTransaction({
  tx,context,mappingsReviewed:true,requireReadTime:true
 });
}
