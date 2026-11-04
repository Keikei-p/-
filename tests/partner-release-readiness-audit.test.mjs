import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectPartnerReleaseReadiness} from '../tools/production/check-partner-release-readiness.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fixture=()=>({
 rules:read('firestore.rules'),
 manualRelease:read('tools/production/release-partner-boundary.mjs'),
 financeGate:read('scripts/check-finance-read-boundary-before-deploy.mjs'),
 financeWorkflow:read('.github/workflows/firebase-production-deploy.yml'),
 hostingWorkflow:read('.github/workflows/nico-factory-sync.yml'),
 browser:read('index.html')
});

test('real shared-ranking candidate detects all three actual release blockers',()=>{
 const result=inspectPartnerReleaseReadiness(fixture());
 assert.equal(result.staticReleasePathCompatible,false);
 assert.deepEqual(result.blockers,[
  'MANUAL_RELEASE_RULES_SHA_PIN_MISMATCH',
  'CURRENT_FINANCE_GATE_REQUIRES_DIFFERENT_RULES_CONTRACT',
  'LEGACY_BROWSER_STILL_USES_RAW_SALES_COLLECTIONS'
 ]);
 assert.equal(result.productionApproved,false);
 assert.equal(result.realOwnerAndPartnerUidVerified,false);
 assert.equal(result.productionBackupRestoredAndVerified,false);
 assert.match(result.candidateRulesSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(result.candidateRulesSha256,result.manualReleasePinnedSha256);
});

test('missing or weakened secondary guard cannot pass diagnostic',()=>{
 const f=fixture();
 f.rules=f.rules.replace(
  'function noSecondaryPartnerWorkspace()',
  'function noSecondaryPartnerWorkspaceOld()'
 );
 const result=inspectPartnerReleaseReadiness(f);
 assert(result.blockers.includes('PARTNER_SECONDARY_UID_GUARD_MISSING'));
 assert.equal(result.productionApproved,false);
});

test('each former-internal finance and team read source is independently checked',()=>{
 for(const path of ['products','records','recordCorrections','revenueGoals','teams','linePairingCodes']){
  const f=fixture();
  const beginning=f.rules.indexOf('match /'+path+'/{');
  assert(beginning>=0,path+' must be an existing rule block');
  const after=f.rules.indexOf('allow ',beginning);
  const next=f.rules.indexOf('noSecondaryPartnerWorkspace()',after);
  assert(after>beginning && next>after,path+' must currently have a guard');
  f.rules=f.rules.slice(0,next)+'true'+f.rules.slice(next+'noSecondaryPartnerWorkspace()'.length);
  const codes=inspectPartnerReleaseReadiness(f).blockers;
  assert(codes.includes('PARTNER_RAW_READ_GUARD_MISSING_'+path),path);
 }
});

test('manual Rules workflow or production finance preflight cannot silently disappear',()=>{
 const f=fixture();
 f.financeWorkflow=f.financeWorkflow.replace(
  'node scripts/check-finance-read-boundary-before-deploy.mjs','echo skipped'
 );
 assert(inspectPartnerReleaseReadiness(f).blockers.includes('FINANCE_RELEASE_GATE_UNRECOGNIZED'));
 const g=fixture();
 g.financeWorkflow=g.financeWorkflow.replace('workflow_dispatch:', 'push:');
 assert(inspectPartnerReleaseReadiness(g).blockers.includes('MANUAL_MAIN_RELEASE_GUARD_MISSING'));
 const h=fixture();
 h.hostingWorkflow=h.hostingWorkflow.replace(
  'node scripts/nico-production-cutover-preflight.mjs','echo skipped'
 );
 assert(inspectPartnerReleaseReadiness(h).blockers.includes('HOSTING_SAFETY_PREFLIGHT_MISSING'));
});

test('all four browser financial source types are detected, including scoped queries',()=>{
 const collections=['records','products','recordCorrections','revenueGoals'];
 for(const collection of collections){
  for(const invocation of [
   'companyCollectionQuery("'+collection+'")',
   'collection(db, "'+collection+'")'
  ]){
   const f=fixture();
   f.browser='<html> '+invocation+' </html>';
   const result=inspectPartnerReleaseReadiness(f);
   assert(result.blockers.includes('LEGACY_BROWSER_STILL_USES_RAW_SALES_COLLECTIONS'),
    invocation+' must not be missed');
  }
 }
});

test('unrecognized input is rejected and never interpreted as ready',()=>{
 const f=fixture();
 f.rules='';
 assert.throws(()=>inspectPartnerReleaseReadiness(f),/RELEASE_INPUT_MISSING_rules/);
 const g=fixture();
 delete g.browser;
 assert.throws(()=>inspectPartnerReleaseReadiness(g),/RELEASE_INPUT_MISSING_browser/);
});

test('even a synthetic static compatibility result is never production approval',()=>{
 const f=fixture();
 f.rules=f.rules.replace('service cloud.firestore {',
  'service cloud.firestore {\n    function isInternalFinanceReader(companyId) { return false; }');
 // A synthetic gateway-only browser replaces every legacy raw collection path.
 f.browser='<html>signInWithEmailAndPassword service-worker.js /v1/public-counts</html>';
 const sha=inspectPartnerReleaseReadiness(f).candidateRulesSha256;
 const originalPin=f.manualRelease.match(/export const CANDIDATE='([a-f0-9]{64})'/)[1];
 f.manualRelease=f.manualRelease.replace(originalPin,sha);
 const result=inspectPartnerReleaseReadiness(f);
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.staticReleasePathCompatible,true);
 assert.equal(result.productionApproved,false);
 assert.equal(result.realOwnerAndPartnerUidVerified,false);
 assert.equal(result.productionBackupRestoredAndVerified,false);
});

test('release readiness auditor is side-effect free and cannot deploy or touch customers',()=>{
 const s=read('tools/production/check-partner-release-readiness.mjs');
 assert.doesNotMatch(s,/\b(?:setDoc|updateDoc|deleteDoc|writeFileSync|execFileSync|spawnSync|fetch|https\.request|firebase\s+deploy|wrangler\s+deploy)\s*\(/);
 assert.doesNotMatch(s,/FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS|initializeApp|access_token/);
 assert.match(s,/productionApproved:false/);
 assert.match(s,/process\.exitCode=2/);
});
