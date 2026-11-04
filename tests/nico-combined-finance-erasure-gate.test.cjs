"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const ui=read("index.html");
const rules=read("firestore.rules");
const workspace=read("functions-partner-workspace/service.cjs");
const erasure=read("functions-account-erasure/service.cjs");
const eraseEntry=read("functions-account-erasure/index.js");

test("same production app keeps both secondary partner migration and strict manager-only account removal",()=>{
 assert.match(ui,/transferPartnerSecondaryMembership/);
 assert.match(ui,/function renderPartnerSelfTransferAction\(/);
 assert.match(ui,/async function eraseManagedAccount\(/);
 assert.match(ui,/function attachPendingAccountErasureControl\(/);
 assert.match(ui,/previewManagedAccountErasure/);
 assert.match(ui,/confirmManagedAccountErasure/);
 assert.match(ui,/listManagedAccountErasurePending/);
 assert.match(ui,/pInlinePeople/);
 assert.match(ui,/pInlineCountFields/);
 assert.match(ui,/reauthenticateWithCredential\(operator,cred\)/);
 assert.match(ui,/confirmation:"DELETE_ACCOUNT_ONLY",confirmName:targetName/);
 assert.match(ui,/confirmation:"I_ACCEPT_PARTNER_ONLY_ACCESS"/);
});

test("raw finance source Firestore paths are denied for all UID contexts including inactive tombstones",()=>{
 assert.match(rules,/function noSecondaryPartnerWorkspace\(\)/);
 const fn=rules.slice(rules.indexOf("function noSecondaryPartnerWorkspace()"),rules.indexOf("function isCompanyMember("));
 assert.match(fn,/!exists\(\/databases\/\$\(database\)\/documents\/partnerWorkspaceContexts\/\$\(request\.auth\.uid\)\)/);
 for(const c of ["products","records","recordCorrections","revenueGoals"]){
  const first=rules.indexOf("match /"+c+"/{");
  assert.ok(first>0,"missing financial collection "+c);
  const segment=rules.slice(first,first+220);
  assert.match(segment,/allow read: if noSecondaryPartnerWorkspace\(\)/,c+" read");
 }
});

test("self-transfer archives original membership and account deletion rejects any secondary or transferred UID",()=>{
 assert.match(workspace,/async function transferSecondary\(/);
 assert.match(workspace,/partnerHistoricalTransfers/);
 assert.match(workspace,/transferredToPrimary:true/);
 assert.match(erasure,/get\(ref\("partnerWorkspaceContexts",targetUid\)\)/);
 assert.match(erasure,/get\(ref\("partnerHistoricalTransfers",targetUid\)\)/);
 assert.match(erasure,/if\(secondary\.exists\|\|oldTransfer\.exists\)fail\(\)/);
 assert.match(erasure,/targetAuthMarker/);
 assert.match(erasure,/nicoErasureProofV1/);
});

test("account erasure remains disabled unless explicitly enabled; no direct raw business-original writes",()=>{
 assert.match(eraseEntry,/NICO_ACCOUNT_ERASURE_ENABLED==="enabled"/);
 const config=JSON.parse(read("firebase.account-erasure.json"));
 assert.deepEqual(Object.keys(config),["functions"]);
 assert.equal(config.functions.codebase,"account-erasure");
 assert.equal(config.functions.source,"functions-account-erasure");
 for(const c of ["records","products","recordCorrections","revenueGoals","goals",
  "partnerWorkEntries","partnerWorkCountDays"]){
  assert.doesNotMatch(erasure,new RegExp('collection\\("'+c+'"\\)'),
   "account deletion must not open original ledger "+c);
 }
 assert.match(erasure,/getAuth\(\)\.deleteUser\(d\.targetUid\)/);
 assert.match(erasure,/tx\.delete\(x\.ur\)/);
 assert.match(erasure,/tx\.delete\(x\.mr\)/);
 assert.match(erasure,/historicalBusinessRecordsPreserved:true/);
});

test("historical sales, CB and ranking result functions are preserved alongside Auth removal UI",()=>{
 assert.match(ui,/function renderSelectedTeamMemberDetail\(/);
 assert.match(ui,/function renderIndividualRanking\(/);
 assert.match(ui,/function renderProductMemberRanking\(/);
 assert.match(ui,/function renderDailySummary\(/);
 assert.match(ui,/teamIdSnapshot/);
 assert.match(ui,/memberNameSnapshot/);
 assert.match(ui,/revenuePerUnit/);
 assert.match(ui,/renderPartnerPrivateProductCatalog\(/);
 assert.match(ui,/renderPartnerCountOnlyExtras\(/);
 assert.match(workspace,/partnerWorkEntries/);
 assert.match(workspace,/cbCounts/);
 assert.match(erasure,/kind:"retired"/);
});
