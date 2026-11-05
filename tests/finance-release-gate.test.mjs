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
 // A guard appended after an OR must never be accepted as protection.
 assert.throws(()=>checkFinanceRulesBeforeDeploy(create),/RAW_CREATE/);
 const update=stage2.replace(
  "allow update: if isInternalFinanceReader(resource.data.companyId)",
  "allow update: if true");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(update),/RAW_UPDATE/);
 const productOffset=stage2.indexOf("match /products/{productId} {");
 assert(productOffset>=0);
 const deletion=stage2.slice(0,productOffset)+
   stage2.slice(productOffset).replace("allow delete: if false;","allow delete: if true;");
 assert.notEqual(deletion,stage2,"test must change the product deletion rule");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(deletion),/RAW_DELETE/);
});
test("replacing another collection's read guard with sameCompany is not approved",()=>{
 const altered=stage2.replace("&& isInternalFinanceReader(resource.data.companyId)",
   "&& sameCompany(resource.data.companyId)");
 assert.throws(()=>checkFinanceRulesBeforeDeploy(altered),/RAW_READ/);
});

test("only the original internal Owner or Master may read raw finance on a staged ruleset",()=>{
 const owner="isCompanyOwner(resource.data.companyId)";
 for(const replacement of [
  owner+" || true",
  owner+" || isCompanyLeader(resource.data.companyId)",
  owner+" || canViewRevenue(resource.data.companyId)"
 ]){
  const mutated=stage2.replace(owner,replacement);
  assert.notEqual(mutated,stage2);
  assert.throws(()=>checkFinanceRulesBeforeDeploy(mutated),/RAW_READ_/);
 }
});
test("a partner-allowing OR inside the finance helper cannot pass string-only guard tests",()=>{
 for(const replacement of [
  "return companyId != null || true",
  "return companyId != null && (true || false)",
 ]){
  const mutant=stage2.replace("return companyId != null",replacement);
  assert.notEqual(mutant,stage2);
  assert.throws(()=>checkFinanceRulesBeforeDeploy(mutant),/MISSING_SERVER_PARTNER_GUARD/);
 }
 const marker="get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal') != 'cooperator'";
 const unsafe=stage2.replace(marker,"true");
 assert.notEqual(unsafe,stage2);
 assert.throws(()=>checkFinanceRulesBeforeDeploy(unsafe),/MISSING_SERVER_PARTNER_GUARD/);
});
test("get of existing financial records must not be enabled by additional OR",()=>{
 const marker="!exists(/databases/$(database)/documents/records/$(recordId))";
 assert(stage2.includes(marker));
 for(const unsafe of [
  stage2.replace(marker,marker+" || true"),
  stage2.replace(marker,"("+marker+" || true)")
 ]){
  assert.notEqual(unsafe,stage2);
  assert.throws(()=>checkFinanceRulesBeforeDeploy(unsafe),/ADDITIVE_GET_records/);
 }
});
