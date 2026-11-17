/**
 * Canonical count-only backend; the registered HTTP Function stays OFF until release.
 * The first complete count-only wiring for the reviewed owner publication:
 * Existing verified workspace identity -> active count-sharing -> canonical internal and
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
import {createAtomicOwnerPublicationReader,createZeroSetupCountPublicationReader}
 from "./owner-product-visibility-in-atomic-tx.mjs";
import {createFreshCombinedRankingContext} from "./trusted-combined-ranking-context.mjs";
import {createRequire} from "node:module";
const {makeWorkspaceIdentity}=createRequire(import.meta.url)(
 "../functions-partner-workspace/workspace-identity.cjs"
);

export function createCanonicalOwnerCountSnapshot({
 db,FieldValue,clock,verifyCountViewer,zeroSetupLink=false
}={}){
 if(!db||!FieldValue||
    typeof db.collection!=="function"||
    typeof db.runTransaction!=="function"||
    typeof FieldValue.serverTimestamp!=="function")
  throw Error("CANONICAL_OWNER_COUNT_DEPENDENCY_MISSING");
 return createStagedAtomicOwnerCountLoader({
  db,
  loadCountsInTransaction:createCanonicalCountTransactionReader({db,clock,zeroSetupLink}),
  loadPublicationInTransaction:zeroSetupLink===true?
   createZeroSetupCountPublicationReader({db,verifyCountViewer}):
   createAtomicOwnerPublicationReader({db,FieldValue,verifyCountViewer}),
  zeroSetupLink
 });
}

/**
 * Feature-enabled only after external release gate. Do NOT register this
 * as a route until the live finance, backing store and rollback proofs pass.
 */
export function createCanonicalOwnerCountHandler({
 enabled=false,auth,db,FieldValue,clock=()=>new Date(),zeroSetupLink=false
}={}){
 if(enabled!==true)return createStagedOwnerVisibleCountHandler({
  enabled:false
 });
 if(!auth||typeof auth.verifyIdToken!=="function"||
    typeof auth.getUser!=="function")
  throw Error("CANONICAL_OWNER_COUNT_AUTH_MISSING");
 // Validate every dependency before constructing any request authorizer.
 createCanonicalOwnerCountSnapshot({
  db,FieldValue,clock,zeroSetupLink
 });
 class CountIdentityError extends Error{}
 const {readCountViewer}=makeWorkspaceIdentity({
  db,getAuth:()=>auth,HttpsError:CountIdentityError,enabled:()=>true,
  now:()=>clock().getTime()
 });
 const loadVerifiedCountContext=({token,workspaceCompanyId})=>
  createFreshCombinedRankingContext({db,
   loadCountViewer:tx=>readCountViewer({token,workspaceCompanyId,tx})
  })({});
 const loadAtomicVerifiedCountSnapshot=({token,workspaceCompanyId,...args})=>
  createCanonicalOwnerCountSnapshot({db,FieldValue,clock,zeroSetupLink,
   verifyCountViewer:async({tx,context})=>{
    // Re-authorize the exact selected membership/session IN the same
    // transaction as counts and publication; never trust an earlier flag.
    const s=await readCountViewer({token,workspaceCompanyId,tx});
    if(s.uid!==context.viewerUid||s.cid!==context.viewerCompanyId||
       (s.kind==="partner"?s.hubId:s.cid)!==context.hubCompanyId||
       (s.kind==="partner"?"partner_owner":"hub_owner")!==context.role)
     throw Error("CANONICAL_COUNT_VIEWER_CHANGED");
   }
  })(args);
 return createStagedOwnerVisibleCountHandler({
  enabled:true,auth,db,FieldValue,loadAtomicVerifiedCountSnapshot,loadVerifiedCountContext,
  zeroSetupLink
 });
}
