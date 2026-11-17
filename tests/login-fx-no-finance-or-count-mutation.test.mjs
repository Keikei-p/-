import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {applyLoginOnly} from '../tools/hosting/audit-live-login-fx-transplant.mjs';
import {classifyLegacySalesEntrypoint} from '../legacy-finance-entry-guard.mjs';

// Never infer a safe deploy from hiding a price element alone. Confirm that
// the exact UI-only release leaves the original finance, counts and server
// permission sources byte-identical, and that the partner entry stays count-only.
const oldHead='1fb08a776c4e8c520425151bb4834a5a38d9abfc';
const fromOld=file=>execFileSync('git',['show',oldHead+':'+file],{encoding:'utf8',maxBuffer:6e6});
const get=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('login FX changes only the four visual slots; the full count and finance app is byte-identical',()=>{
  const oldIndex=fromOld('index.html');
  const candidateIndex=get('index.html');
  const patch=applyLoginOnly({base:oldIndex,proposed:candidateIndex,live:oldIndex});
  assert.equal(patch.candidate,candidateIndex,
    'index candidate differs outside the four reviewed login FX regions');
  assert.equal(patch.changed,true,'a real visual improvement must exist');
  assert.deepEqual(Object.keys(patch.evidence),
    ['ios-input','fx-style','reduced-motion','fx-controller']);
  for(const fn of ['canCurrentUserViewRevenue','canCurrentUserViewUnitPrice',
    'currentCatalogRevenuePerUnit','getDisplayRecordResults']){
    assert.match(candidateIndex,new RegExp('function '+fn+'\\s*\\('),fn+' must remain');
  }
});
test('partner page stays count-only, with no revenue or unit-price fields',()=>{
  const html=get('partner-workspace.html');
  assert.match(html,/submitPartnerWorkspaceCounts/);
  assert.match(html,/getPartnerWorkspace/);
  assert.doesNotMatch(html,/revenuePerUnit|unitPrice|totalRevenue|firebase-firestore\.js|getFirestore\s*\(/i,
    'partner workspace must never import raw financial data');
});
test('partner marker vetoes Owner to the internal finance entry; internal Owner is retained',()=>{
  const internal={
    uid:'person',authEmailVerified:true,
    user:{uid:'person',companyId:'sales',companyRole:'owner',active:true},
    member:{uid:'person',companyId:'sales',companyRole:'owner',active:true},
    company:{companyKind:'internal',active:true,ownerUid:'person'}
  };
  assert.equal(classifyLegacySalesEntrypoint(internal).mode,'internal');
  const partner=structuredClone(internal);
  partner.company.companyKind='partner';
  assert.equal(classifyLegacySalesEntrypoint(partner).mode,'partner');
  partner.company.companyKind='internal';
  partner.member.accessKind='partner';
  assert.equal(classifyLegacySalesEntrypoint(partner).mode,'partner');
});
test('all production records, partner count, Rules and function sources retain exactly their prior bytes',()=>{
  for(const file of ['firestore.rules','firebase.json','.firebaserc',
    'functions/index.js','partner-workspace.html','partner-counts.html',
    'partner-invite.html','legacy-finance-entry-guard.mjs']){
    assert.equal(get(file),fromOld(file),file+' changed during FX-only release');
  }
});
test('reviewed release script is Hosting-only, without count mutations or Firebase deploy commands',()=>{
  const release=get('tools/hosting/release-live-login-fx-transplant.mjs');
  const visual=get('tools/hosting/audit-live-login-fx-transplant.mjs');
  assert.match(release,/uploadSingleExistingIndex/);
  assert.match(release,/REVIEWED_OLD_SHA/);
  assert.match(release,/REVIEWED_NEXT_SHA/);
  assert.match(visual,/STOP_LIVE_VISUAL_SLOT_DRIFT/);
  assert.doesNotMatch(release,/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|firebase\s+deploy|firebase-admin\/firestore|httpsCallable)\s*\(/,
    'release runner must not write counts, records or permissions');
});
