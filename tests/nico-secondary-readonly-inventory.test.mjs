import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifySecondary,classifyActiveContextMismatch,classifyPrimaryMembershipMismatch,transferEligibility,publicInventorySummary,
 classifyLiveRules,hasRecentReadyBackup} from '../tools/production/audit-secondary-contexts-readonly.mjs';
const context={uid:'test_uid',kind:'partner_secondary',active:true,primaryCompanyId:'internal_company',
 partnerCompanyId:'partner_company',hubCompanyId:'internal_company'};
const user={uid:'test_uid',companyId:'internal_company',companyRole:'member',active:true,accessKind:'internal',
 memberType:'direct',canViewRevenue:false,canViewUnitPrice:false};
const oldMember={companyRole:'member',active:true,accessKind:'internal',memberType:'direct'};
const oldCompany={ownerUid:'some_other_owner',masterUid:'some_other_owner',companyKind:'internal',active:true};
const partnerMember={active:true,accessKind:'partner',memberType:'cooperator'};
const partnerCompany={active:true,companyKind:'partner'};
const sample=(override={})=>({context,user,oldMember,oldCompany,partnerMember,partnerCompany,...override});

test('even revenue=false old internal member has original money read path',()=>{
 assert.equal(classifySecondary(sample()),'internal_finance_read_path');
});
test('unknown active context with legacy internal member money path is never labeled safe',()=>{
 const changed=sample({context:{...context,kind:'legacy_unknown'}});
 assert.equal(classifySecondary(changed),'unrecognized_active_legacy_finance_read_path');
 assert.equal(classifySecondary({...changed,partnerCompany:null}),
  'unrecognized_active_legacy_finance_read_path');
 const missingPartner=sample({partnerMember:null});
 assert.equal(classifySecondary(missingPartner),
  'unrecognized_active_legacy_finance_read_path');
 assert.equal(classifySecondary(sample({context:{...context,kind:'legacy_unknown',active:false}})),
  'inactive_or_unrecognized');
 assert.equal(classifySecondary(sample({context:{...context,kind:'legacy_unknown'},
  user:{...user,accessKind:'partner'}})),'inactive_or_unrecognized');
 assert.equal(classifySecondary(sample({context:{...context,kind:'legacy_unknown'},
  oldMember:{...oldMember,active:false}})),'inactive_or_unrecognized');
 const report=publicInventorySummary({totalContexts:1,activeUnknownOldFinancePaths:1,
  activeUnknownSecondaryContexts:1});
 assert.equal(report.oldInternalFinancePathPresent,true);
 assert.equal(report.unrecognizedActiveOldFinanceReadPotential,true);
 assert.equal(report.safeToDeploy,false);
 const emitted=JSON.stringify(report);
 for(const secret of ['test_uid','internal_company','activeUnknownOldFinancePaths'])
  assert(!emitted.includes(secret));
});
test('same Firebase UID as internal company Owner is release blocker',()=>{
 assert.equal(classifySecondary(sample({oldCompany:{...oldCompany,ownerUid:'test_uid'}})),'owner_conflict');
 assert.equal(classifySecondary(sample({oldMember:{...oldMember,companyRole:'owner'}})),'owner_conflict');
});
test('missing, disabled and unknown dual contexts fail closed',()=>{
 assert.equal(classifySecondary(sample({context:{...context,active:false}})),'inactive_or_unrecognized');
 assert.equal(classifySecondary(sample({oldMember:null})),'broken');
 assert.equal(classifySecondary(sample({partnerCompany:{companyKind:'internal',active:true}})),'broken');
 assert.equal(classifySecondary(sample({user:{...user,companyId:'other_company'}})),'broken');
});
test('never equate partner owner flags with internal money privileges',()=>{
 assert.equal(classifySecondary(sample({oldCompany:{...oldCompany,ownerUid:'test_uid'},
  user:{...user,companyRole:'owner',canViewRevenue:true,canViewUnitPrice:true}})),'owner_conflict');
});

test('active inconsistent membership reasons distinguish context, primary and partner paths without IDs',()=>{
 const base=classifyActiveContextMismatch(sample());
 assert.deepEqual(base,{contextPair:false,primary:false,partner:false});
 const unknownId=classifyActiveContextMismatch(
  sample({context:{...context,partnerCompanyId:context.primaryCompanyId}}));
 assert.deepEqual(unknownId,{contextPair:true,primary:false,partner:false});
 const old=classifyActiveContextMismatch(sample({user:{...user,companyId:'different'}}));
 assert.deepEqual(old,{contextPair:false,primary:true,partner:false});
 const partner=classifyActiveContextMismatch(sample({
  partnerMember:{...partnerMember,memberType:'member'}}));
 assert.deepEqual(partner,{contextPair:false,primary:false,partner:true});
 const disabled=classifyActiveContextMismatch(sample({
  context:{...context,active:false},partnerMember:{...partnerMember,memberType:'member'}}));
 assert.deepEqual(disabled,{contextPair:false,primary:false,partner:false});
 const missing=classifyActiveContextMismatch(sample({partnerMember:null}));
 assert.deepEqual(missing,{contextPair:false,primary:false,partner:false});
 const report=publicInventorySummary({
  totalContexts:1,inconsistentContexts:1,activeInconsistentContexts:1,
  activeMismatchedContextDocuments:1,activePrimaryRecordMismatch:1,
  readyBackups:0
 });
 assert.equal(report.activeUnrecognizedContextPresent,true);
 assert.equal(report.activeContextPrimaryRecordMismatchPresent,true);
 assert.equal(report.activeContextPartnerRecordMismatchPresent,false);
 assert.equal(report.activeContextCompanyPairInvalidPresent,false);
 assert.equal(report.safeToDeploy,false);
 const serialized=JSON.stringify(report);
 for(const value of ['different','internal_company','partner_company','activePrimaryRecordMismatch'])
  assert(!serialized.includes(value));
});

test('exact primary mismatch group is diagnosed safely without exposing old membership fields',()=>{
 const none={link:false,inactive:false,access:false,type:false,companyKind:false};
 assert.deepEqual(classifyPrimaryMembershipMismatch(sample()),none);
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({context:{...context,active:false}})),none);
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({oldMember:null})),none);
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({user:{...user,companyId:'other'}})),{...none,link:true});
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({oldMember:{...oldMember,active:false}})),{...none,inactive:true});
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({user:{...user,accessKind:'partner'}})),{...none,access:true});
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({oldMember:{...oldMember,memberType:'cooperator'}})),{...none,type:true});
 assert.deepEqual(classifyPrimaryMembershipMismatch(
  sample({oldCompany:{...oldCompany,companyKind:'partner'}})),{...none,companyKind:true});
 const report=publicInventorySummary({
  activePrimaryRecordMismatch:1,activePrimaryAccessMarkerMismatch:1,
  activeInconsistentContexts:1,totalContexts:1
 });
 assert.equal(report.activeContextPrimaryRecordMismatchPresent,true);
 assert.equal(report.activePrimaryAccessMarkerMismatchPresent,true);
 assert.equal(report.activePrimaryIdentityLinkMismatchPresent,false);
 assert.equal(report.activePrimaryInactiveStatePresent,false);
 assert.equal(report.activePrimaryMemberTypeMismatchPresent,false);
 assert.equal(report.safeToDeploy,false);
 for(const forbidden of ['test_uid','cooperator','primaryCompanyId','memberType',
  'activePrimaryAccessMarkerMismatch']){
  assert(!JSON.stringify(report).includes(forbidden));
 }
});

test('non-owner verified partner secondary has a read-only eligible transition plan',()=>{
 const ready={...sample(),context:{...context,role:'member',teamId:'partner_team',emailLower:'person@example.test'},
  partnerCompany:{...partnerCompany,hubCompanyId:'internal_company'},
  partnerMember:{...partnerMember,uid:'test_uid',companyId:'partner_company',role:'member',
   name:'協力店スタッフ',companyRole:'member',teamId:'partner_team',canViewRevenue:false,canViewUnitPrice:false},
  relation:{hubCompanyId:'internal_company',partnerCompanyId:'partner_company',active:true,
   countSharingApproved:true},
  staff:{uid:'test_uid',companyId:'partner_company',kind:'account',
   role:'member',active:true,teamId:'partner_team'},
  team:{companyId:'partner_company',active:true},
  archived:false,auth:{email:'person@example.test',emailVerified:true,disabled:false}};
 assert.equal(transferEligibility(ready),true);
 assert.equal(transferEligibility({...ready,archived:true}),false);
 assert.equal(transferEligibility({...ready,auth:{...ready.auth,emailVerified:false}}),false);
 assert.equal(transferEligibility({...ready,oldCompany:{...oldCompany,ownerUid:'test_uid'}}),false);
 assert.equal(transferEligibility({...ready,staff:{...ready.staff,teamId:'foreign_team'}}),false);
 assert.equal(transferEligibility({...ready,partnerMember:{...ready.partnerMember,canViewRevenue:true}}),false);
 assert.equal(transferEligibility({...ready,partnerMember:{...ready.partnerMember,name:''}}),false);
 assert.equal(transferEligibility({...ready,partnerMember:{...ready.partnerMember,canCreateInvite:true}}),false);
 assert.equal(transferEligibility({...ready,staff:{...ready.staff,role:'leader'}}),false);
 assert.equal(transferEligibility({...ready,team:{companyId:'partner_company',active:false}}),false);
 assert.equal(transferEligibility({...ready,team:{companyId:'other',active:true}}),false);
 assert.equal(transferEligibility({...ready,user:{...ready.user,companyRole:'owner'}}),false);
 assert.equal(transferEligibility({...ready,user:{...ready.user,uid:'foreign_uid'}}),false);
 assert.equal(transferEligibility({...ready,oldMember:{...ready.oldMember,active:false}}),false);
});

test('public actions summary excludes single-user inventory details and never authorizes deploy',()=>{
 const raw={totalContexts:1,activeSecondaryContexts:1,ownerConflicts:0,nonOwnerOldFinancePaths:1,
  internalOwnerContexts:0,inactiveOrUnknownContexts:0,inconsistentContexts:0,transferNeedsReview:0,
  transferEligibleCandidates:1,historicalTransfersPresent:0,readyBackups:7,
  latestBackupExists:true,rulesFingerprintMatchesLastReviewed:true,
  recentReadyBackupWithin48h:true,exactReviewedPhase1RulesActive:false,
  liveRulesSourceUnrecognized:false,
  uid:'synthetic-secret-uid',emailLower:'nobody@example.test',accountName:'sample',
  sensitiveRevenue:12345678};
 const report=publicInventorySummary(raw);
 assert.equal(report.secondaryContextsPresent,true);
 assert.equal(report.oldInternalFinancePathPresent,true);
 assert.equal(report.readyBackupPresent,true);
 assert.equal(report.recentReadyBackupWithin48h,true);
 assert.equal(report.exactReviewedPhase1RulesActive,false);
 assert.equal(report.authenticatedBoundaryProofStillRequired,true);
 assert.equal(report.safeToDeploy,false);
 assert.equal(report.realPartnerFinanceDenyVerified,false);
 const shown=JSON.stringify(report);
 for(const secret of ['synthetic-secret-uid','nobody@example.test','sample','12345678',
   'activeSecondaryContexts','nonOwnerOldFinancePaths','readyBackups','totalContexts'])
  assert.equal(shown.includes(secret),false,secret);
 assert.deepEqual(publicInventorySummary({...raw,totalContexts:0,nonOwnerOldFinancePaths:0,readyBackups:0}),
   {...report,secondaryContextsPresent:false,oldInternalFinancePathPresent:false,readyBackupPresent:false});
});

test('EXACT current main Rules are recognized, but not mistaken for reviewed Phase-1 closure',()=>{
 const original=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
 const observed=classifyLiveRules(original);
 assert.equal(observed.exactOriginalMainRules,true);
 // Current production Rules were changed via reviewed Owner product Rules release.
 // Keep the old legacy content fingerprint historical; do not assert that
 // current main has the bytes of the prior legacy release.
 assert.equal(observed.matchesReviewedLegacyLive,false);
 assert.equal(observed.exactReviewedPhase1Boundary,false);
 assert.equal(observed.actualAuthenticatedBoundaryVerified,false);
 // A single-byte change must NEVER be certified as a known source.
 const modified=classifyLiveRules(original.replace('rules_version', 'rules_version '));
 assert.equal(modified.exactOriginalMainRules,false);
 assert.equal(modified.exactReviewedPhase1Boundary,false);
 assert.equal(modified.actualAuthenticatedBoundaryVerified,false);
 assert.throws(()=>classifyLiveRules(''),/STOP_SECONDARY_INVENTORY_UNVERIFIED_RULES_SOURCE/);
});
test('READY backup must be no more than 48 hours old and never in the future',()=>{
 const now=Date.parse('2026-11-07T00:00:00.000Z');
 const withAge=(ms,readyBackups=1)=>({
  readyBackups,latestReadySnapshot:new Date(now-ms).toISOString()
 });
 assert.equal(hasRecentReadyBackup(withAge(0),now),true);
 assert.equal(hasRecentReadyBackup(withAge(48*60*60*1000),now),true);
 assert.equal(hasRecentReadyBackup(withAge(48*60*60*1000+1),now),false);
 assert.equal(hasRecentReadyBackup(withAge(-1),now),false);
 assert.equal(hasRecentReadyBackup(withAge(3600*1000,0),now),false);
 assert.equal(hasRecentReadyBackup({readyBackups:1,latestReadySnapshot:'not-date'},now),false);
 assert.equal(hasRecentReadyBackup(null,now),false);
});
test('public report is boolean-only and NEVER says security is already proven',()=>{
 const report=publicInventorySummary({
  totalContexts:2,nonOwnerOldFinancePaths:1,ownerConflicts:0,
  internalOwnerContexts:0,inactiveOrUnknownContexts:0,inconsistentContexts:0,
  transferNeedsReview:0,transferEligibleCandidates:0,historicalTransfersPresent:0,
  readyBackups:1,latestBackupExists:true,
  recentReadyBackupWithin48h:false,exactReviewedPhase1RulesActive:true,
  liveRulesSourceUnrecognized:false
 });
 assert.equal(report.exactReviewedPhase1RulesActive,true);
 assert.equal(report.recentReadyBackupWithin48h,false);
 assert.equal(report.realPartnerFinanceDenyVerified,false);
 assert.equal(report.safeToDeploy,false);
 assert.equal(report.authenticatedBoundaryProofStillRequired,true);
 assert.equal(JSON.stringify(report).includes('totalRevenue'),false);
});

test('inactive historical secondary context is not an active unknown-finance risk',()=>{
 const inactive={totalContexts:1,inactiveOrUnknownContexts:1,inactiveSecondaryContexts:1,
  activeUnknownSecondaryContexts:0,inconsistentContexts:0};
 const safe=publicInventorySummary(inactive);
 assert.equal(safe.unrecognizedContextPresent,true);
 assert.equal(safe.inactiveContextPresent,true);
 assert.equal(safe.activeUnrecognizedContextPresent,false);
 assert.equal(safe.safeToDeploy,false);
 const active=publicInventorySummary({...inactive,activeUnknownSecondaryContexts:1,
  inactiveSecondaryContexts:0});
 assert.equal(active.activeUnrecognizedContextPresent,true);
 assert.equal(active.inactiveContextPresent,false);
 // An inactive historical record can be malformed without creating a
 // CURRENT active member. It still stays in inventory and cannot grant deploy.
 const malformedHistorical=publicInventorySummary({
  ...inactive,inconsistentContexts:1,inactiveSecondaryContexts:1,
  activeInconsistentContexts:0
 });
 assert.equal(malformedHistorical.unrecognizedContextPresent,true);
 assert.equal(malformedHistorical.activeUnrecognizedContextPresent,false);
 assert.equal(malformedHistorical.inactiveContextPresent,true);
 assert.equal(malformedHistorical.safeToDeploy,false);
 // An active malformed membership remains an explicit security blocker.
 const malformedActive=publicInventorySummary({
  ...inactive,inconsistentContexts:1,activeInconsistentContexts:1,
  activeMissingContextDocuments:1
 });
 assert.equal(malformedActive.activeUnrecognizedContextPresent,true);
 assert.equal(malformedActive.activeContextDocumentsMissingPresent,true);
 assert.equal(malformedActive.activeContextMembershipMismatchPresent,false);
 const malformedMember=publicInventorySummary({
  ...inactive,inconsistentContexts:1,activeInconsistentContexts:1,
  activeMismatchedContextDocuments:1
 });
 assert.equal(malformedMember.activeContextMembershipMismatchPresent,true);
 const unknownKind=publicInventorySummary({
  ...inactive,activeUnknownSecondaryContexts:1,activeUnsupportedContextKinds:1
 });
 assert.equal(unknownKind.activeUnrecognizedContextPresent,true);
 assert.equal(unknownKind.activeContextUnsupportedKindPresent,true);
 const financePotential=publicInventorySummary({
  ...inactive,activeUnknownOldFinancePaths:1
 });
 assert.equal(financePotential.oldInternalFinancePathPresent,true);
 assert.equal(financePotential.activeUnrecognizedContextPresent,true);
 const published=JSON.stringify(safe);
 for(const k of ['emailLower','uid','inactiveSecondaryContexts','activeUnknownSecondaryContexts',
  'activeInconsistentContexts','activeMissingContextDocuments',
  'activeMismatchedContextDocuments','activeUnsupportedContextKinds'])
  assert(!published.includes(k));
});
