import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperatorIntent} from '../tools/production/phase1-reviewed-operator.mjs';

const baseline='d9f4df6a2ac0f8b5720534a2461ec66b94379190';
const candidate='6d6ac7fd3544b0326823e419a3acd7e1d060b714';
const main='17681e69d3ebd7271cc9a58e138fd0e202db7294';
const review='INDEPENDENT_REVIEW_OF_PHASE1_RULES_AND_LIVE_IDENTITIES_COMPLETE';
const basic={
 FIREBASE_PROJECT_ID:'sales-management-cc116',
 NICO_USAGE_APPROVAL:'EXISTING_FUNCTIONS_AND_FULL_INVENTORY_APPROVED',
 FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'
};
const approved={
 ...basic,NICO_PHASE1_INDEPENDENT_SIGNOFF:review,
 NICO_PHASE1_REVIEWED_MAIN_SHA:main,
 NICO_PHASE1_REVIEWED_BASELINE_BLOB:baseline,
 NICO_PHASE1_REVIEWED_CANDIDATE_BLOB:candidate
};
const proof={
 ownerIdToken:'owner-proof-secret',partnerIdToken:'partner-proof-secret',
 expectedOwnerUid:'owner_real',expectedPartnerUid:'partner_real',
 internalCompanyId:'company_hub',partnerCompanyId:'company_partner',
 productId:'product1',recordId:'record1'
};

test('manual reviewed runner defaults to safe verification without any apply permission',()=>{
 assert.deepEqual(validateOperatorIntent({mode:'verify',env:basic,proof:null}),{apply:false});
 assert.deepEqual(validateOperatorIntent({mode:'verify',env:approved,proof}),{apply:false});
});

test('no secret, approval or misleading project can run an apply request',()=>{
 for(const env of [
  basic,
  {...approved,NICO_PHASE1_INDEPENDENT_SIGNOFF:''},
  {...approved,NICO_PHASE1_REVIEWED_MAIN_SHA:'wrong'},
  {...approved,NICO_PHASE1_REVIEWED_BASELINE_BLOB:'wrong'},
  {...approved,NICO_PHASE1_REVIEWED_CANDIDATE_BLOB:'wrong'},
  {...approved,FIREBASE_PROJECT_ID:'demo-sales-support'},
  {...approved,FIRESTORE_EMULATOR_HOST:'attacker.example:8080'},
  {...approved,FIRESTORE_EMULATOR_HOST:'127.0.0.1:65536'},
  {...approved,FIRESTORE_EMULATOR_HOST:'127.0.0.1:0'},
  {...approved,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080/evil'},
  {...approved,NICO_USAGE_APPROVAL:'BAD'}
 ]){
  assert.throws(()=>validateOperatorIntent({mode:'apply',env,proof}),
    /STOP_PHASE1_OPERATOR_/);
 }
});

test('apply cannot be validated with altered identity, extra fields, or reused UID',()=>{
 for(const changed of [
  null,
  {},
  {...proof,role:'owner'},
  {...proof,internalCompanyId:'../escapes'},
  {...proof,expectedPartnerUid:proof.expectedOwnerUid},
  {...proof,partnerCompanyId:proof.internalCompanyId},
  {...proof,ownerIdToken:proof.partnerIdToken},
  {...proof,partnerIdToken:''},
  {...proof,recordId:''}
 ]){
  assert.throws(()=>validateOperatorIntent({mode:'apply',env:approved,proof:changed}),
    /STOP_PHASE1_OPERATOR_/);
 }
});

test('unknown mode and missing local-only environment fail without touching cloud',()=>{
 for(const mode of ['publish','run','apply-now','',null]){
  assert.throws(()=>validateOperatorIntent({mode,env:approved,proof}),
    /STOP_PHASE1_OPERATOR_/);
 }
 assert.throws(()=>validateOperatorIntent({mode:'verify',env:{
  ...basic,FIRESTORE_EMULATOR_HOST:'0.0.0.0:8080'
 },proof:null}),/STOP_PHASE1_OPERATOR_OFFLINE_PREFLIGHT/);
});
