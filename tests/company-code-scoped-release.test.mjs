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
