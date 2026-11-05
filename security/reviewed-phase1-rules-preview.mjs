/**
 * Offline-only exact source review for the NICO phase-1 partner finance
 * boundary. Does NOT touch the existing production release mechanism.
 *
 * This is intentionally distinct from the future owner-only stage-2 gateway
 * release. It prepares the exact reviewed Rules bytes for offline emulator
 * verification, NEVER authorizes or performs a cloud operation.
 *
 * Main baseline / approved PR #358 are pinned as byte-exact Git blob IDs.
 * An unexpected live Rules version or a different candidate fails closed.
 */
import {createHash} from 'node:crypto';

export const EXISTING_RULES_BLOB='d9f4df6a2ac0f8b5720534a2461ec66b94379190';
export const PHASE1_RULES_BLOB='6d6ac7fd3544b0326823e419a3acd7e1d060b714';
const STOP=code=>{throw Error('PHASE1_REVIEW_BLOCK_'+code);};
const blobId=source=>{
 if(typeof source!=='string'||source.length<1000)STOP('MISSING_RULES');
 return createHash('sha1')
  .update('blob '+Buffer.byteLength(source,'utf8')+'\0')
  .update(source,'utf8')
  .digest('hex');
};

/**
 * Inputs must originate from independently fetched, reviewed sources.
 * There are deliberately NO credentials, Firebase SDK or deployment APIs.
 */
export function previewReviewedPhase1Rules({currentLive,reviewedBaseline,reviewedCandidate}={}){
 const baselineBlob=blobId(reviewedBaseline);
 const candidateBlob=blobId(reviewedCandidate);
 const liveBlob=blobId(currentLive);
 if(baselineBlob!==EXISTING_RULES_BLOB)STOP('MAIN_BASELINE_CHANGED');
 if(candidateBlob!==PHASE1_RULES_BLOB)STOP('REVIEWED_CANDIDATE_CHANGED');
 if(liveBlob!==EXISTING_RULES_BLOB&&liveBlob!==PHASE1_RULES_BLOB)
   STOP('LIVE_RULES_CHANGED');
 // Redundant, human-readable expectations on top of the exact-content pin.
 // An unrelated byte change still fails SHA verification above.
 if(!reviewedCandidate.includes('function noSecondaryPartnerWorkspace()')||
    !reviewedCandidate.includes('!exists(/databases/$(database)/documents/partnerWorkspaceContexts/$(request.auth.uid))')||
    reviewedCandidate.includes('function isInternalFinanceReader('))STOP('PHASE1_CONTRACT');
 for(const collection of ['products','records','recordCorrections',
                           'revenueGoals','teams','linePairingCodes']){
  const start=reviewedCandidate.indexOf('match /'+collection+'/{');
  const end=reviewedCandidate.indexOf('\n    match /',start+7);
  const body=reviewedCandidate.slice(start,end<0?undefined:end);
  const verb=collection==='linePairingCodes'?'get':'read';
  if(start<0||!new RegExp('allow\\s+'+verb+'\\s*:\\s*if\\s+noSecondaryPartnerWorkspace\\(\\)').test(body))
    STOP('RAW_READ_BOUNDARY_'+collection);
 }
 for(const name of ['teams','products','records','goals','revenueGoals']){
  const start=reviewedCandidate.indexOf('match /'+name+'/{');
  const end=reviewedCandidate.indexOf('\n    match /',start+7);
  const body=reviewedCandidate.slice(start,end<0?undefined:end);
  if(!/allow\s+delete\s*:\s*if\s+false\s*;/.test(body))STOP('HISTORY_RETENTION_'+name);
 }
 return Object.freeze({
  candidate:reviewedCandidate, // offline emulator input only, never persisted
  baselineBlob,candidateBlob,liveBlob,
  candidateAlreadyLive:liveBlob===PHASE1_RULES_BLOB,
  eligibleForOfflineEmulator:true,
  productionReleaseApproved:false,
  realOwnerAndPartnerUidVerified:false,
  independentlyRestoredLiveBackup:false,
  releaseMaintainerSignedOff:false
 });
}
