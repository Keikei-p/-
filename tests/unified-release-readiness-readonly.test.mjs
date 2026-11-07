import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 PROJECT,LABELS,extractReports,summarize,renderPublic
} from "../tools/production/unified-release-readiness-readonly.mjs";

const reports=()=>({
 rules:{
  project:PROJECT,mode:"LIVE_FIRESTORE_RULES_METADATA_GET_ONLY",
  liveRulesMatchReviewedAndTested:true,testedAgainstSyntheticEmulatorOnly:true,
  realPartnerGetListProven:false,userDataReads:0,productionWrites:0,deploys:0
 },
 partner:{
  project:PROJECT,mode:"CLOUD_FUNCTIONS_METADATA_GET_ONLY",
  countFunctionMetadataPresent:false,countFunctionsActive:false,
  countFunctionsConfiguredEnabled:false,functions:{
   getPartnerWorkspace:{deployed:false},
   submitPartnerWorkspaceCounts:{deployed:false},
   managePartnerWorkspace:{deployed:false},
   acceptPartnerWorkspaceInvite:{deployed:false}
  },realPartnerCountEntryVerified:false,originalSalesDataWrites:0
 },
 secondary:{
  project:PROJECT,mode:"READ_ONLY",productionWrites:0,
  oldInternalFinancePathPresent:true,ownerContextConflictPresent:false,
  unrecognizedContextPresent:false,recentReadyBackupWithin48h:true,
  realPartnerFinanceDenyVerified:false
 },
 billing:{
  project:PROJECT,mode:"PROJECT_BILLING_METADATA_GET_ONLY",
  billingEnabled:true,linkedBillingAccount:true,trialCreditBalanceVerified:false,
  noRecurringChargeGuaranteed:false,releaseCostGatePassed:false,
  productionWrites:0
 }
});
const from=val=>Object.fromEntries(Object.entries(val).map(([name,v])=>[
 name,"private diagnostic line not public\n"+LABELS[name]+JSON.stringify(v)+"\n"
]));

test("current risk: even Rules parity success cannot certify secondary finances or live counts",()=>{
 const r=summarize(reports());
 assert.equal(r.reviewedLiveRulesIdentical,true);
 assert.equal(r.secondaryFinanceAccessPathStillPresent,true);
 assert.equal(r.recentReadyBackupPresent,true);
 assert.equal(r.fourCountFunctionsDeployedActiveEnabled,false);
 assert.equal(r.firebaseBillingLinked,true);
 assert.equal(r.trialBalanceVerifiedByProjectBillingApi,false);
 assert.equal(r.safeForFinanceBoundaryCutover,false);
 assert.equal(r.safeForPartnerFullRelease,false);
 assert.equal(r.realPartnerTokenGetListTestCompleted,false);
 assert.equal(r.realPartnerCountSubmissionCompleted,false);
 assert.ok(r.blockingReasons.includes("SECONDARY_ACCOUNT_INTERNAL_FINANCE_PATH"));
 assert.ok(r.blockingReasons.includes("FOUR_NEW_COUNT_FUNCTIONS_NOT_READY"));
 assert.ok(r.blockingReasons.includes("REAL_PARTNER_TOKEN_DENIAL_NOT_PROVED"));
 assert.ok(r.blockingReasons.includes("TRIAL_AND_FUTURE_COST_LIMIT_NOT_PROVED_BY_API"));
 assert.equal(r.productionDocumentWrites,0);
 assert.equal(r.productionRulesWrites,0);
 assert.equal(r.productionFunctionsDeploys,0);
});

test("even all four Functions being ready never turns off required real-user proof",()=>{
 const input=reports();
 input.secondary.oldInternalFinancePathPresent=false;
 input.partner.countFunctionMetadataPresent=true;
 input.partner.countFunctionsActive=true;
 input.partner.countFunctionsConfiguredEnabled=true;
 input.billing.trialCreditBalanceVerified=true;
 input.billing.noRecurringChargeGuaranteed=true;
 const r=summarize(input);
 assert.equal(r.fourCountFunctionsDeployedActiveEnabled,true);
 assert.equal(r.secondaryFinanceAccessPathStillPresent,false);
 assert.equal(r.blockingReasons.includes("SECONDARY_ACCOUNT_INTERNAL_FINANCE_PATH"),false);
 assert.equal(r.safeForPartnerFullRelease,false);
 assert.ok(r.blockingReasons.includes("REAL_PARTNER_COUNT_SUBMISSION_NOT_PROVED"));
});

test("only exactly one trusted prefix per audit, same project and zero production writes",()=>{
 const input=reports();
 const got=extractReports(from(input));
 assert.deepEqual(got,input);
 assert.deepEqual(summarize(got),summarize(input));
 assert.throws(()=>extractReports(from({...input,rules:{...input.rules,project:"other"}})),
   /WRONG_PROJECT_OR_WRITES/);
 assert.throws(()=>extractReports(from({...input,billing:{...input.billing,productionWrites:1}})),
   /WRONG_PROJECT_OR_WRITES/);
 assert.throws(()=>extractReports({...from(input),partner:"no report"}),
   /MISSING_OR_DUPLICATE_REPORT/);
 const double=from(input);
 double.rules+=LABELS.rules+JSON.stringify(input.rules)+"\n";
 assert.throws(()=>extractReports(double),/MISSING_OR_DUPLICATE_REPORT/);
});

test("invalid audits fail closed and no auth/financial/user identifiers reach public summary",()=>{
 const input=reports();
 for(const [name,field,value] of [
  ["rules","liveRulesMatchReviewedAndTested",null],
  ["partner","countFunctionsActive","yes"],
  ["secondary","ownerContextConflictPresent",undefined],
  ["billing","billingEnabled",0]
 ]){
  assert.throws(()=>summarize({...input,[name]:{...input[name],[field]:value}}),
    /STOP_NICO_UNIFIED_READINESS_/);
 }
 const payload=renderPublic(summarize(input));
 assert.ok(payload.startsWith("NICO_RELEASE_READINESS "));
 for(const word of ["test-uid","person@example.test","totalRevenue",'"access_token"','¥47,159'])
  assert.equal(payload.includes(word),false);
 assert.throws(()=>renderPublic({...summarize(input),safeForPartnerFullRelease:true}),
   /PUBLIC_REPORT/);
});

test("new audit workflow is GET only, never auto-dispatches deployment or rewrites main Rules",()=>{
 const src=readFileSync(new URL("../.github/workflows/nico-unified-release-readiness-readonly.yml",import.meta.url),"utf8");
 assert.match(src,/READ ONLY/);
 assert.match(src,/FIREBASE_PROJECT_ID: sales-management-cc116/);
 assert.doesNotMatch(src,/firebase deploy|functions:deploy|firebase deploy|curl -X POST|gcloud functions deploy/);
 assert.match(src,/tools\/production\/inspect-live-partner-callables-readonly\.mjs/);
 assert.match(src,/tools\/production\/audit-secondary-contexts-readonly\.mjs/);
 assert.match(src,/tools\/production\/audit-live-firestore-rules-readonly\.mjs/);
 assert.match(src,/tools\/production\/inspect-project-billing-readonly\.mjs/);
});
