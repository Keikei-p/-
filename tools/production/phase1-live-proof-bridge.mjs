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
import {createAffectedSecondaryIdentityVerifier} from './phase1-bound-identity-readonly.mjs';
import {
  createLiveFirestoreOwnerPreflight,
  createLiveFirestoreRoleVerifier,
  createLiveFirestoreSessionPreflight,
  createLivePartnerCountViewVerifier
} from './verify-live-firestore-roles.mjs';

const stop=code=>{throw Error('STOP_PHASE1_LIVE_BRIDGE_'+code);};
const allowRelease=new Set([
  'request','snapshot','restore','backup',
  'reviewedBaseline','reviewedCandidate','now','log'
]);
const allowIdentity=new Set(['credential','partnerCompanyId','fetchImpl','now']);
const allowAccounts=new Set([
  'ownerIdToken','partnerIdToken','expectedOwnerUid',
  'expectedPartnerUid','internalCompanyId','productId',
  'recordId','fetchImpl','now'
]);

export async function phase1WithLiveAccountGate({
  release,accounts,identity,approval=false,
  candidateEmulatorVerified=false,backupReviewed=false
}={}){
  // Do not allow flags or arbitrary callback injection inside the release
  // dependencies to override this bridge's forced real-account checks.
  if(approval!==true||candidateEmulatorVerified!==true||
     backupReviewed!==true)stop('INDEPENDENT_APPROVAL_REQUIRED');
  if(!release||typeof release!=='object'||Array.isArray(release)||
     Object.keys(release).some(key=>!allowRelease.has(key))||
     !accounts||typeof accounts!=='object'||Array.isArray(accounts)||
     Object.keys(accounts).some(key=>!allowAccounts.has(key))||
     !identity||typeof identity!=='object'||Array.isArray(identity)||
     Object.keys(identity).some(key=>!allowIdentity.has(key)))
    stop('UNREVIEWED_INPUT_KEYS');
  if(typeof release.request!=='function'||typeof release.snapshot!=='function'||
     typeof release.restore!=='function'||typeof release.backup!=='function'||
     typeof release.reviewedBaseline!=='string'||
     typeof release.reviewedCandidate!=='string')
    stop('INCOMPLETE_RELEASE_DEPENDENCIES');

  // A generic partner UID getting 403 could fake a successful financial
  // boundary test. Bind the exact affected dual-membership identity to the
  // internal company and partner membership with independently trusted reads.
  const identityArgs={
    credential:identity.credential,
    partnerCompanyId:identity.partnerCompanyId,
    expectedOwnerUid:accounts.expectedOwnerUid,
    expectedPartnerUid:accounts.expectedPartnerUid,
    internalCompanyId:accounts.internalCompanyId,
    ...(identity.fetchImpl===undefined?{}:{fetchImpl:identity.fetchImpl}),
    ...(identity.now===undefined?{}:{now:identity.now})
  };
  const identityProof=await createAffectedSecondaryIdentityVerifier(identityArgs)();
  if(identityProof?.checkedAgainst!=='production-admin-readonly'||
     identityProof?.ownerInternalBound!==true||
     identityProof?.affectedSecondaryBound!==true||
     identityProof?.productionDocumentWrites!==0)
    stop('TRUSTED_AFFECTED_IDENTITY_REQUIRED');

  const before=createLiveFirestoreOwnerPreflight(accounts);
  const after=createLiveFirestoreRoleVerifier(accounts);
  const countViewArgs={
    partnerIdToken:accounts.partnerIdToken,
    expectedPartnerUid:accounts.expectedPartnerUid,
    partnerCompanyId:identity.partnerCompanyId,
    ...(accounts.fetchImpl===undefined?{}:{fetchImpl:accounts.fetchImpl}),
    ...(accounts.now===undefined?{}:{now:accounts.now})
  };
  // Distinct one-use probes: verify count-entry workspace reads before and
  // after the Rules switch, without writing any daily entry or count history.
  const beforeCountView=createLivePartnerCountViewVerifier(countViewArgs);
  const afterCountView=createLivePartnerCountViewVerifier(countViewArgs);
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
    // Full production inventory + local restore can outlive the tokens used
    // for the first Owner preflight. The switch engine calls this gate AFTER
    // its last pre-PATCH inventory fingerprint and BEFORE changing the active
    // Rules release. This prevents an avoidable input outage and rollback.
    preApplyCheck:async()=>{
      const freshIdentity=await createAffectedSecondaryIdentityVerifier(identityArgs)();
      if(freshIdentity?.checkedAgainst!=='production-admin-readonly'||
         freshIdentity?.ownerInternalBound!==true||
         freshIdentity?.affectedSecondaryBound!==true||
         freshIdentity?.productionDocumentWrites!==0)
        stop('PRE_SWITCH_AFFECTED_IDENTITY_UNVERIFIED');
      const session=createLiveFirestoreSessionPreflight(accounts)();
      if(session?.ownerSessionFresh!==true||
         session?.partnerSessionFresh!==true||
         session?.checkedAgainst!=='local-claims-only')
        stop('PRE_SWITCH_SESSIONS_UNVERIFIED');
      // A local JWT parse is not proof of Firebase Auth. The original
      // Owner must STILL read actual live money through Firestore Security
      // Rules immediately before the switch, with the real user ID token.
      const owner=await createLiveFirestoreOwnerPreflight(accounts)();
      if(owner?.checkedAgainst!=='production-live'||
         owner?.ownerFinanceAllowed!==true)
        stop('PRE_SWITCH_OWNER_FINANCE_UNVERIFIED');
      // A valid partner 403 is not enough; the authenticated partner must
      // still open their OWN count-entry workspace against real Functions.
      // This onCall path performs read-only GETs, no entry submission.
      const beforeCounts=await beforeCountView();
      if(beforeCounts?.checkedAgainst!=='production-live'||
         beforeCounts?.partnerCountViewAllowed!==true||
         beforeCounts?.productionDocumentWrites!==0)
        stop('PRE_SWITCH_COUNT_VIEW_UNVERIFIED');
      // The token freshness check also runs after network reads, ensuring
      // it did not expire during the pre-switch Owner probe.
      createLiveFirestoreSessionPreflight(accounts)();
      return Object.freeze({
        checkedAgainst:'production-live',
        ownerFinanceAllowed:true,
        affectedSecondaryBound:true,
        partnerSessionFresh:true,
        partnerCountViewAllowed:true
      });
    },
    // Recheck the affected secondary membership immediately AFTER the Rules
    // switch, before calling the real UID GET/LIST denial probe. Never claim
    // success for a stale identity snapshot or a different partner UID.
    verifyLiveRoles:async proofArgs=>{
      const fresh=await createAffectedSecondaryIdentityVerifier(identityArgs)();
      if(fresh?.checkedAgainst!=='production-admin-readonly'||
         fresh?.ownerInternalBound!==true||
         fresh?.affectedSecondaryBound!==true)
        stop('POST_SWITCH_IDENTITY_UNVERIFIED');
      const finances=await after(proofArgs);
      const countView=await afterCountView();
      if(countView?.checkedAgainst!=='production-live'||
         countView?.partnerCountViewAllowed!==true||
         countView?.productionDocumentWrites!==0)
        stop('POST_SWITCH_COUNT_VIEW_UNVERIFIED');
      // Both real user sessions must still be fresh after the final read.
      createLiveFirestoreSessionPreflight({
        ...accounts,minimumRemainingSeconds:120
      })();
      return {...finances,partnerCountViewAllowed:true};
    }
  });
}
