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
import {createPartnerPublishedTabPolicyReader}
 from "./published-partner-tab-server.mjs";
import {createRequire} from "node:module";
const {makeWorkspaceIdentity}=createRequire(import.meta.url)(
 "../functions-partner-workspace/workspace-identity.cjs"
);

export function createCanonicalOwnerCountSnapshot({
 db,FieldValue,clock,verifyCountViewer,zeroSetupLink=false,
 enforcePartnerTabPublication=false
}={}){
 if(!db||!FieldValue||
    typeof db.collection!=="function"||
    typeof db.runTransaction!=="function"||
    typeof FieldValue.serverTimestamp!=="function")
  throw Error("CANONICAL_OWNER_COUNT_DEPENDENCY_MISSING");
 // Once the partner tab publication fence is enabled, auto SKU name matching
 // must ALSO obey the Owner's existing product ON/OFF selection. Both policy
 // and counts are read in the very same read-only transaction.
 const enforceOwnerSelection=zeroSetupLink===true&&
  enforcePartnerTabPublication===true;
 return createStagedAtomicOwnerCountLoader({
  db,
  loadCountsInTransaction:createCanonicalCountTransactionReader({db,clock,zeroSetupLink,includeHistoricalGroups:enforceOwnerSelection}),
  loadPublicationInTransaction:zeroSetupLink===true&&!enforceOwnerSelection?
   createZeroSetupCountPublicationReader({db,verifyCountViewer}):
   createAtomicOwnerPublicationReader({db,FieldValue,verifyCountViewer,includeHistoricalGroups:enforceOwnerSelection}),
  // Auto name mapping stays enabled for counts, but there is no unfiltered
  // zero-settings publication shortcut for a partner-facing release.
  zeroSetupLink:zeroSetupLink&&!enforceOwnerSelection,
  enforcePartnerTabPublication,
  ...(enforcePartnerTabPublication===true?{
   loadPartnerTabPolicyInTransaction:createPartnerPublishedTabPolicyReader({db})
  }:{})
 });
}

/**
 * Feature-enabled only after external release gate. Do NOT register this
 * as a route until the live finance, backing store and rollback proofs pass.
 */
export function createCanonicalOwnerCountHandler({
 enabled=false,auth,db,FieldValue,clock=()=>new Date(),zeroSetupLink=false,
 enforcePartnerTabPublication=false
}={}){
 if(enabled!==true)return createStagedOwnerVisibleCountHandler({
  enabled:false
 });
 if(!auth||typeof auth.verifyIdToken!=="function"||
    typeof auth.getUser!=="function")
  throw Error("CANONICAL_OWNER_COUNT_AUTH_MISSING");
 // Validate every dependency before constructing any request authorizer.
 createCanonicalOwnerCountSnapshot({
  db,FieldValue,clock,zeroSetupLink,enforcePartnerTabPublication,
  // Construction-only dependency check, before Firebase Auth is initialized.
  // This callback can NEVER authorize a request. The real in-transaction
  // workspace identity gate is installed below for every actual invocation.
  ...(zeroSetupLink===true?{verifyCountViewer:async()=>{
   throw Error("COUNT_SESSION_NOT_AUTHORIZED");
  }}:{})
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
   enforcePartnerTabPublication,
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
  zeroSetupLink,enforcePartnerTabPublication
 });
}
