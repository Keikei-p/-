import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {
 previewReviewedPhase1Rules,EXISTING_RULES_BLOB,PHASE1_RULES_BLOB
} from '../security/reviewed-phase1-rules-preview.mjs';

const candidate=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const baseline=execFileSync('git',['show','origin/main:firestore.rules'],{
 encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024
});

test('exact reviewed phase-1 candidate is reproducible from approved main baseline',()=>{
 const out=previewReviewedPhase1Rules({
  currentLive:baseline,reviewedBaseline:baseline,reviewedCandidate:candidate
 });
 assert.equal(out.baselineBlob,EXISTING_RULES_BLOB);
 assert.equal(out.candidateBlob,PHASE1_RULES_BLOB);
 assert.equal(out.liveBlob,EXISTING_RULES_BLOB);
 assert.equal(out.candidate,candidate);
 assert.equal(out.candidateAlreadyLive,false);
 assert.equal(out.eligibleForOfflineEmulator,true);
 for(const key of ['productionReleaseApproved','realOwnerAndPartnerUidVerified',
  'independentlyRestoredLiveBackup','releaseMaintainerSignedOff']){
  assert.equal(out[key],false,key+' is not implied by synthetic validation');
 }
});

test('idempotent already-installed candidate is still NOT a release approval',()=>{
 const out=previewReviewedPhase1Rules({
  currentLive:candidate,reviewedBaseline:baseline,reviewedCandidate:candidate
 });
 assert.equal(out.candidateAlreadyLive,true);
 assert.equal(out.productionReleaseApproved,false);
});

test('unreviewed source bytes, baseline changes and unknown live Rules stop',()=>{
 for(const [which,value,code] of [
  ['reviewedBaseline',baseline+'\n// drift','MAIN_BASELINE_CHANGED'],
  ['reviewedCandidate',candidate+'\n// drift','REVIEWED_CANDIDATE_CHANGED'],
  ['currentLive',baseline+'\n// unknown live','LIVE_RULES_CHANGED']
 ]){
  const inputs={
   currentLive:baseline,reviewedBaseline:baseline,reviewedCandidate:candidate
  };
  inputs[which]=value;
  assert.throws(()=>previewReviewedPhase1Rules(inputs),new RegExp('PHASE1_REVIEW_BLOCK_'+code));
 }
});

test('missing live source, source verification or candidate fails closed',()=>{
 for(const key of ['currentLive','reviewedBaseline','reviewedCandidate']){
  const inputs={
   currentLive:baseline,reviewedBaseline:baseline,reviewedCandidate:candidate
  };
  delete inputs[key];
  assert.throws(()=>previewReviewedPhase1Rules(inputs),/PHASE1_REVIEW_BLOCK_MISSING_RULES/);
 }
});

test('phase-1 preview has no cloud credentials, data writes, or deploy capability',()=>{
 const src=readFileSync(new URL('../security/reviewed-phase1-rules-preview.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,
  /\b(?:setDoc|updateDoc|deleteDoc|writeFileSync|execFileSync|spawn|fetch|firebase\s+deploy|wrangler\s+deploy|initializeApp|applicationDefault)\s*\(/);
 assert.doesNotMatch(src,/FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS|access_token/);
 assert.match(src,/productionReleaseApproved:false/);
});
