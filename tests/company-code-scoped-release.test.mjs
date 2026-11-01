import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectScopedCompanyCodeRelease,EXISTING_CANONICAL_BLOB}
 from "../scripts/check-company-code-scoped-release.mjs";
const file=x=>readFileSync(new URL("../"+x,import.meta.url),"utf8");
function reviewed(){
 return {
  canonicalBlob:EXISTING_CANONICAL_BLOB,
  canonical:file("index.html"),partnerPage:file("partner-workspace.html"),
  workspaceService:file("functions-partner-workspace/service.cjs"),
  codeAuth:file("functions-partner-workspace/company-code-auth.cjs"),
  entry:file("functions-partner-workspace/index.js"),
  config:JSON.parse(file("firebase.partner-workspace.json"))
 };
}
test("isolated company-code deployment can be reviewed without modifying the existing sales app",()=>{
 const result=inspectScopedCompanyCodeRelease(reviewed());
 assert.deepEqual(result.blocked,[]);
 assert.equal(result.scopedSourceCheckPassed,true);
 assert.equal(result.canonicalSalesAppUnchanged,true);
 // This static approval does NOT certify deployed Rules or owner revenue login.
 assert.equal(result.fullProductionFinanceRulesApproved,false);
 assert.equal(result.liveBackupAndRestoreStillRequired,true);
 assert.equal(result.ownerSalesAccessStillRequiresLiveVerification,true);
});
test("changed old sales app or codebase scope fails closed",()=>{
 const inputs=reviewed();
 assert.equal(inspectScopedCompanyCodeRelease({...inputs,canonicalBlob:"some-other-blob"}).scopedSourceCheckPassed,false);
 assert.equal(inspectScopedCompanyCodeRelease({...inputs,config:{functions:{source:"functions",codebase:"default"}}}).scopedSourceCheckPassed,false);
 assert.equal(inspectScopedCompanyCodeRelease({...inputs,config:{...inputs.config,firestore:{rules:"firestore.rules"}}}).scopedSourceCheckPassed,false);
});
test("backend cannot touch original sales, unit prices or hard-delete historical data",()=>{
 const inputs=reviewed();
 for(const leak of ['db.collection("records")','db.collection("products")',
  'db.collection("recordCorrections")','db.collection("revenueGoals")',
  'tx.delete(recordRef)','db.recursiveDelete(ref)']){
  const result=inspectScopedCompanyCodeRelease({...inputs,workspaceService:inputs.workspaceService+"\n"+leak});
  assert.equal(result.scopedSourceCheckPassed,false,leak);
  assert(result.blocked.includes("RAW_FINANCE_OR_DESTRUCTIVE_BACKEND_PATH"),leak);
 }
});
test("partner page cannot bypass server count-only APIs to raw Firestore",()=>{
 const inputs=reviewed();
 for(const leak of ['firebase-firestore.js','getFirestore(app)','collection(db,"records")']){
  const result=inspectScopedCompanyCodeRelease({...inputs,partnerPage:inputs.partnerPage+"\n"+leak});
  assert(result.blocked.includes("PARTNER_PAGE_BYPASSES_COUNT_ONLY_BACKEND"),leak);
 }
});
test("missing session credential check, no-finance grants or password validation stops release",()=>{
 const inputs=reviewed();
 for(const deletion of [
  ["workspaceService","partnerCodeSessions"],["workspaceService","canViewRevenue!==false"],
  ["workspaceService","countSharingApproved!==true"],["codeAuth","safeEqual"],
  ["codeAuth","canViewUnitPrice:false"],["codeAuth","getAuth().verifyIdToken"]
 ]){
  const [key,needle]=deletion;
  const result=inspectScopedCompanyCodeRelease({...inputs,[key]:inputs[key].replaceAll(needle,"BROKEN")});
  assert(result.blocked.includes("PARTNER_CODE_ACCESS_BOUNDARY_NOT_VERIFIED"),needle);
 }
});

test("company-code production workflow is strictly scoped and cannot silently release unsafe legacy finance Rules",()=>{
 const workflow=file(".github/workflows/nico-partner-company-code-release.yml");
 // The existing finance Rules remain blocked; their separate deployment gate
 // must never be treated as a green-light for this isolated code-only release.
 assert.match(workflow,/node --test tests\/finance-release-gate\.test\.mjs/);
 assert.match(workflow,/node scripts\/check-company-code-scoped-release\.mjs/);
 assert.match(workflow,/node --test tests\/internal-owner-finance-visibility\.test\.cjs/);
 assert.match(workflow,/node --test tests\/partner-company-code-auth\.test\.cjs/);
 const deploy=workflow.match(/- name: Deploy ONLY isolated partner workspace 8 API Functions[\s\S]*?(?=\n      - name:)/)?.[0];
 assert.ok(deploy,"exact partner Functions deployment step must exist");
 assert.match(deploy,/--config firebase\.partner-workspace\.json/);
 assert.match(deploy,/--only functions:partner-workspace:getPartnerWorkspace/);
 assert.match(deploy,/functions:partner-workspace:issuePartnerCompanyCode/);
 assert.match(deploy,/functions:partner-workspace:loginPartnerCompanyCode/);
 assert.doesNotMatch(workflow,/firebase deploy[^\n]*--only firestore/);
 assert.doesNotMatch(workflow,/firebase deploy[^\n]*--only hosting/);
 assert.match(workflow,/STOP_FIRESTORE_RULES_CHANGED/);
 assert.match(workflow,/functions-before\.json/);
 assert.match(workflow,/STOP_PREEXISTING_FUNCTION_REMOVED/);
 assert.match(workflow,/FIRESTORE_BACKUP_RESTORE_VERIFIED/);
 assert.match(workflow,/OWNER_REVENUE_PRICES_LOGIN_VERIFIED/);
 assert.match(workflow,/EXISTING_FUNCTIONS_COST_APPROVED/);
});
