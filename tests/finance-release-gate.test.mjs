import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkFinanceRulesBeforeDeploy} from "../scripts/check-finance-read-boundary-before-deploy.mjs";
import {modelOwnerOnlyFinanceRules} from "../security/finance-phase2-read-boundary.mjs";
const current=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const staged=readFileSync(new URL("../security/firestore.phase1.rules",import.meta.url),"utf8");
const stage2=modelOwnerOnlyFinanceRules(staged);
test("current production candidate stays BLOCKED until finance raw reads are closed",()=>{
 assert.throws(()=>checkFinanceRulesBeforeDeploy(current),/FINANCE_RELEASE_BLOCK_/);
});
test("future staged owner-only finance candidate passes static contract but not deployment approval",()=>{
 const x=checkFinanceRulesBeforeDeploy(stage2);
 assert.equal(x.staticShapeValid,true);
 assert.equal(x.productionDeploymentApproved,false);
 assert.equal(x.emulatorVerificationRequired,true);
 assert.equal(x.liveBackupRestorationRequired,true);
});
test("missing internal-partner guard always blocks",()=>{
 assert.throws(()=>checkFinanceRulesBeforeDeploy(stage2.replace(
   "function isInternalFinanceReader(companyId)",
   "function isInternalFinanceReaderOld(companyId)"
 )),/MISSING_SERVER_PARTNER_GUARD/);
});
test("additive allow get/list may not bypass the finance closure",()=>{
 const changed=stage2.replace("match /products/{productId} {",
  "match /products/{productId} {\n      allow get: if true;");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(changed),/ADDITIVE_GET/);
 const list=stage2.replace("match /products/{productId} {",
  "match /products/{productId} {\n      allow list: if true;");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(list),/ADDITIVE_LIST/);
});
test("partner raw finance write, update, and delete bypasses are rejected",()=>{
 const create=stage2.replace(
  "allow create: if isInternalFinanceReader(request.resource.data.companyId)",
  "allow create: if true || isInternalFinanceReader(request.resource.data.companyId)"
 );
 // The static guard is necessary, NOT semantic proof of the entire boolean
 // expression. The Firebase emulator and a second review must catch OR bypasses.
 assert.equal(checkFinanceRulesBeforeDeploy(create).productionDeploymentApproved,false);
 const update=stage2.replace(
  "allow update: if isInternalFinanceReader(resource.data.companyId)",
  "allow update: if true");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(update),/RAW_UPDATE/);
 const deletion=stage2.replace("allow delete: if false;","allow delete: if true;");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(deletion),/RAW_DELETE/);
});
test("replacing another collection's read guard with sameCompany is not approved",()=>{
 const altered=stage2.replace("&& isInternalFinanceReader(resource.data.companyId)",
   "&& sameCompany(resource.data.companyId)");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(altered),/RAW_READ/);
});
