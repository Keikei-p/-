import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TARGETS,NAMES,ensureExactOnly,inspectSource,
 compareBeforeAfter} from '../tools/production/partner-four-function-release-scope.mjs';

const index=readFileSync(new URL('../functions-partner-workspace/index.js',import.meta.url),'utf8');
const config=readFileSync(new URL('../firebase.partner-workspace.json',import.meta.url),'utf8');
const list=ids=>({result:ids.map(id=>({id}))});
test('exact approved four functions only; no company code, LINE, finance, Hosting or Rules',()=>{
 assert.equal(TARGETS.length,4);
 assert.equal(NAMES.length,4);
 assert.ok(ensureExactOnly(TARGETS.join(',')));
 assert.equal(inspectSource(index,config),true);
 for(const name of ['issuePartnerCompanyCode','activatePartnerCompanyCode',
 'loginPartnerCompanyCode','logoutPartnerCompanyCode','sendMissingReportReminders'])
  assert.equal(TARGETS.join(',').includes(name),false,name);
 assert.throws(()=>ensureExactOnly('functions:partner-workspace'),/STOP_FOUR_COUNT_RELEASE_EXTRA_FUNCTION_TARGET/);
 assert.throws(()=>ensureExactOnly(TARGETS.join(',')+',functions:partner-workspace:issuePartnerCompanyCode'),
  /STOP_FOUR_COUNT_RELEASE_EXTRA_FUNCTION_TARGET/);
 assert.throws(()=>ensureExactOnly(TARGETS.slice(0,3).join(',')),/STOP_FOUR_COUNT_RELEASE_EXTRA_FUNCTION_TARGET/);
 assert.throws(()=>ensureExactOnly([TARGETS[0],TARGETS[0],TARGETS[2],TARGETS[3]].join(',')),
  /STOP_FOUR_COUNT_RELEASE_EXTRA_FUNCTION_TARGET/);
});
test('source drift and accidental codebase changes require independent review',()=>{
 assert.throws(()=>inspectSource(index,JSON.stringify({functions:{source:'functions',codebase:'default'}})),
  /STOP_FOUR_COUNT_RELEASE_WRONG_CODEBASE/);
 assert.throws(()=>inspectSource(index.replace('PARTNER_WORKSPACE_ENABLED','DANGEROUS_OVERRIDE'),config),
  /STOP_FOUR_COUNT_RELEASE_UNREVIEWED_FLAGS/);
 assert.throws(()=>inspectSource(index.replace('exports.submitPartnerWorkspaceCounts','exports.deleteSalesRecords'),config),
  /STOP_FOUR_COUNT_RELEASE_FUNCTION_EXPORT_MISMATCH/);
});
test('all preexisting function identities preserved after exactly four approved creations',()=>{
 const before=['sendMissingReportReminders','createPartnerCompanyInvitation',
  'getPartnerQuickCounts','submitPartnerQuickCounts','otherSafeFunction'];
 const proof=compareBeforeAfter(list(before),list([...before,...NAMES]));
 assert.equal(proof.originalFunctionIdsPreserved,true);
 assert.equal(proof.requiredFourPresentInInventory,true);
 assert.equal(proof.onlyApprovedFunctionNamesAdded,true);
 assert.equal(proof.actualEndUserCountEntryProved,false);
 assert.equal(proof.safeToCutOverRules,false);
});
test('stop before claiming success if even one old function disappears',()=>{
 const before=['sendMissingReportReminders','getPartnerQuickCounts','submitPartnerQuickCounts'];
 const after=['getPartnerQuickCounts','submitPartnerQuickCounts',...NAMES];
 assert.throws(()=>compareBeforeAfter(list(before),list(after)),
  /STOP_FOUR_COUNT_RELEASE_ORIGINAL_FUNCTION_DISAPPEARED/);
});
test('stop if unexpected function, partial deployment, malformed list or duplicated IDs',()=>{
 const original=['getPartnerQuickCounts','submitPartnerQuickCounts'];
 assert.throws(()=>compareBeforeAfter(list(original),list([...original,...NAMES,'issuePartnerCompanyCode'])),
  /STOP_FOUR_COUNT_RELEASE_UNAPPROVED_NEW_FUNCTION/);
 assert.throws(()=>compareBeforeAfter(list(original),list([...original,...NAMES.slice(0,3)])),
  /STOP_FOUR_COUNT_RELEASE_EXPECTED_COUNT_FUNCTION_MISSING/);
 assert.throws(()=>compareBeforeAfter({result:null},list([...NAMES])),
  /STOP_FOUR_COUNT_RELEASE_FUNCTION_INVENTORY_UNAVAILABLE/);
 assert.throws(()=>compareBeforeAfter(list(original),list([...original,...NAMES,NAMES[0]])),
  /STOP_FOUR_COUNT_RELEASE_FUNCTION_INVENTORY_INVALID/);
});
test('module only validates a selected deployment and contains no production writes',()=>{
 const s=readFileSync(new URL('../tools/production/partner-four-function-release-scope.mjs',import.meta.url),'utf8');
 assert.match(s,/safeToCutOverRules:false/);
 assert.doesNotMatch(s,/firebase deploy|firebase functions:delete|setDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(/);
});
