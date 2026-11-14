import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {
 exportedNames,inspectOwnerCorrectionRelease
} from "../tools/production/inspect-owner-correction-function-inventory.mjs";

const mk=()=>{
 const root=mkdtempSync(join(tmpdir(),"nico-offline-inventory-"));
 const put=(file,content)=>{
  const p=join(root,file);mkdirSync(dirname(p),{recursive:true});
  writeFileSync(p,content,"utf8");
 };
 put("firebase.partner-workspace.json",JSON.stringify({
  functions:{source:"functions-partner-workspace",codebase:"partner-workspace"}}));
 put("firebase.ranking-approvals.json",JSON.stringify({
  functions:{source:"functions-ranking-approvals",codebase:"ranking-owner-approvals"}}));
 put("functions-partner-workspace/index.js",[
  'exports.getPartnerWorkspace = null;',
  'exports.managePartnerWorkspace = null;',
  'exports.acceptPartnerWorkspaceInvite = null;',
  'exports.submitPartnerWorkspaceCounts = null;',
  'exports.listHubPartnerCounts = null;',
  'exports.correctHubPartnerCounts = null;',
  'const a=NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED==="enabled";',
  'const b=NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED==="enabled";'
 ].join("\n"));
 put("functions-ranking-approvals/index.js",
  'exports.getVerifiedJointCountRanking = null;');
 put("functions-partner-workspace/service.cjs",[
  "const a=ownerCorrectionReadEnabled=()=>false;",
  "const b=ownerCorrectionWriteEnabled=()=>false;"
 ].join("\n"));
 put("index.html",
  'const NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED=false;');
 put("firestore.rules","rules_version = '2';");
 put(".github/workflows/nico-partner-private-coordinated-release.yml",[
  "workflow_dispatch:",
  "FIRESTORE_BACKUP_RESTORE_VERIFIED",
  "OWNER_REVENUE_PRICES_LOGIN_VERIFIED",
  "EXISTING_FUNCTIONS_COST_APPROVED",
  "scripts/check-finance-read-boundary-before-deploy.mjs",
  "scripts/nico-production-cutover-preflight.mjs",
  "firebase deploy --config firebase.partner-workspace.json",
  "--only functions:partner-workspace:getPartnerWorkspace,functions:partner-workspace:managePartnerWorkspace,functions:partner-workspace:acceptPartnerWorkspaceInvite,functions:partner-workspace:submitPartnerWorkspaceCounts"
 ].join("\n"));
 return {root,put,close:()=>rmSync(root,{recursive:true,force:true})};
};
test("actual PR branch has unique owner endpoints, separate default OFF gates, and no approved deploy",()=>{
 const result=inspectOwnerCorrectionRelease();
 assert.equal(result.sourceInventoryPassed,true,
  "new codebase exports must never collide or widen reviewed 4 function release");
 assert.equal(result.productionReleaseApproved,false);
 assert.equal(result.ownerEndpoints.defaultEnabled,false);
 assert.equal(result.historicManualRelease.ownerEndpointsCovered,false);
 assert(result.functionsCodebases.some(x=>x.codebase==="partner-workspace"));
 assert(result.ownerEndpoints.names.includes("correctHubPartnerCounts"));
 assert(result.requiredBeforeProduction.length>=5);
});
test("counts only runtime export syntax, never evaluating Functions or SDK imports",()=>{
 assert.deepEqual(exportedNames(
  'exports.getPartnerWorkspace = x;\nexports.correctHubPartnerCounts=fn;'),
  ["getPartnerWorkspace","correctHubPartnerCounts"]);
 assert.throws(()=>exportedNames('exports.one=1;exports.one=2;'),
  /DUPLICATE_EXPORT_IN_FILE/);
});
test("a scoped and frozen four-functions baseline passes static inventory but never authorizes prod",()=>{
 const f=mk();try{
  const x=inspectOwnerCorrectionRelease(f.root);
  assert.equal(x.sourceInventoryPassed,true);
  assert.equal(x.productionReleaseApproved,false);
  assert.equal(x.staticFinanceCutover.passed,false,
   "dummy Rules cannot become a finance approval");
 }finally{f.close()}
});
test("duplicate function names across isolated codebases fail closed",()=>{
 const f=mk();try{
  f.put("firebase.rogue.json",JSON.stringify({
   functions:{source:"functions-rogue",codebase:"unknown"}}));
  f.put("functions-rogue/index.js",
   "exports.correctHubPartnerCounts = shouldNeverExist;");
  const x=inspectOwnerCorrectionRelease(f.root);
  assert.equal(x.sourceInventoryPassed,false);
  assert(x.violations.some(s=>s.includes("DUPLICATE_FUNCTION_NAME_correctHubPartnerCounts")));
  assert(x.violations.some(s=>s.includes("OWNER_ENDPOINT_COLLISION_correctHubPartnerCounts")));
 }finally{f.close()}
});
test("unapproved widening of old manual deploy is denied rather than relabeled reviewed",()=>{
 const f=mk();try{
  const file=".github/workflows/nico-partner-private-coordinated-release.yml";
  const original=readFileSync(join(f.root,file),"utf8");
  f.put(file,original+"\nfunctions:partner-workspace:correctHubPartnerCounts\n");
  const x=inspectOwnerCorrectionRelease(f.root);
  assert(x.violations.includes("FROZEN_RELEASE_SCOPE_CHANGED"));
  assert.equal(x.productionReleaseApproved,false);
 }finally{f.close()}
});
test("new Owner flags must remain server and browser default OFF",()=>{
 const f=mk();try{
  f.put("functions-partner-workspace/service.cjs","ownerCorrectionWriteEnabled=()=>true");
  const x=inspectOwnerCorrectionRelease(f.root);
  assert(x.violations.includes("OWNER_DEFAULT_OFF_GUARDS_MISSING"));
 }finally{f.close()}
});
test("missing firebase functions source never causes live discover or release",()=>{
 const f=mk();try{
  f.put("firebase.rogue.json",JSON.stringify({
   functions:{source:"functions-no-such",codebase:"bad"}}));
  assert.throws(()=>inspectOwnerCorrectionRelease(f.root),
   /OWNER_CORRECTION_INVENTORY_MISSING_ENTRY/);
 }finally{f.close()}
});
