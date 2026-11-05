/**
 * Phase-1 LIVE user account proof bridge for the exact-source Rules engine.
 *
 * Library only. There is no executable CLI, service account reader, token
 * collection endpoint, deploy workflow, or automatic production publication.
 *
 * 1. Require independent change approval, candidate emulator proof and
 *    reviewed backup before making ANY production account request.
 * 2. Prove that a genuine current internal Owner can still read original
 *    amount-bearing records against legacy production Rules.
 * 3. Hand the exact-source release engine a real account callback. It runs
 *    AFTER a candidate release and must prove that the affected Partner
 *    account is denied get + list while Owner finance is still allowed.
 * 4. The release engine rolls back a failed verification unless another
 *    operator independently changed the release.
 *
 * Any fake fetchImpl is synthetic-only: the bridge blocks BEFORE Rules API.
 * The only application of real proof is a native user-token fetch to
 * Firestore REST where Google validates the ID token and Security Rules.
 */
import {phase1Boundary} from './phase1-partner-finance-release.mjs';
import {
  createLiveFirestoreOwnerPreflight,
  createLiveFirestoreRoleVerifier
} from './verify-live-firestore-roles.mjs';

const stop=code=>{throw Error('STOP_PHASE1_LIVE_BRIDGE_'+code);};
const allowRelease=new Set([
  'request','snapshot','restore','backup',
  'reviewedBaseline','reviewedCandidate','now','log'
]);
const allowAccounts=new Set([
  'ownerIdToken','partnerIdToken','expectedOwnerUid',
  'expectedPartnerUid','internalCompanyId','productId',
  'recordId','fetchImpl','now'
]);

export async function phase1WithLiveAccountGate({
  release,accounts,approval=false,
  candidateEmulatorVerified=false,backupReviewed=false
}={}){
  // Do not allow flags or arbitrary callback injection inside the release
  // dependencies to override this bridge's forced real-account checks.
  if(approval!==true||candidateEmulatorVerified!==true||
     backupReviewed!==true)stop('INDEPENDENT_APPROVAL_REQUIRED');
  if(!release||typeof release!=='object'||Array.isArray(release)||
     Object.keys(release).some(key=>!allowRelease.has(key))||
     !accounts||typeof accounts!=='object'||Array.isArray(accounts)||
     Object.keys(accounts).some(key=>!allowAccounts.has(key)))
    stop('UNREVIEWED_INPUT_KEYS');
  if(typeof release.request!=='function'||typeof release.snapshot!=='function'||
     typeof release.restore!=='function'||typeof release.backup!=='function'||
     typeof release.reviewedBaseline!=='string'||
     typeof release.reviewedCandidate!=='string')
    stop('INCOMPLETE_RELEASE_DEPENDENCIES');

  const before=createLiveFirestoreOwnerPreflight(accounts);
  const after=createLiveFirestoreRoleVerifier(accounts);
  const ownerProof=await before();

  // A fake injected transport can test the flow, but can NEVER be promoted
  // into a successful live switch regardless of its simulated HTTP statuses.
  if(ownerProof?.checkedAgainst!=='production-live'||
     ownerProof?.ownerFinanceAllowed!==true)
    stop('REAL_OWNER_PREFLIGHT_REQUIRED');

  return phase1Boundary({
    ...release,
    apply:true,approval:true,candidateEmulatorVerified:true,
    backupReviewed:true,realOwnerBeforeVerified:true,
    verifyLiveRoles:after
  });
}
