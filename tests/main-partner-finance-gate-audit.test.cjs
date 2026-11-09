"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("main Firestore financial reads require verified internal company membership",()=>{
 const rules=read("firestore.rules");
 const member=rules.slice(rules.indexOf("function isCompanyMember("),rules.indexOf("function isCompanyLeader("));
 for(const check of [
  /company\.get\('companyKind', 'internal'\) == 'internal'/,
  /user\.get\('accessKind', 'internal'\) == 'internal'/,
  /member\.get\('accessKind', 'internal'\) == 'internal'/
 ])assert.match(member,check);
 const same=rules.slice(rules.indexOf("function sameCompany("),rules.indexOf("function ownerBootstrap("));
 assert.match(same,/isCompanyMember\(companyId\)/);
 for(const name of ["products","records","recordCorrections","goals","revenueGoals"]){
  const start=rules.indexOf("match /"+name+"/{");
  assert(start>=0,"missing "+name);
  const tail=rules.slice(start,start+950);
  assert.match(tail,/allow read: if resource\.data\.companyId != null\s*&& sameCompany\(resource\.data\.companyId\)/);
 }
});
test("ranking and product visibility callables are disabled by default",()=>{
 const code=read("functions-ranking-approvals/index.js");
 assert.match(code,/NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"/);
 assert.match(code,/NICO_OWNER_PRODUCT_VISIBILITY_ENABLED==="enabled"/);
 assert.match(code,/NICO_OWNER_SKU_MAPPING_ENABLED==="enabled"/);
 assert.match(code,/getVerifiedJointCountRanking=onRequest/);
});
test("owner product visibility never writes raw sales, counts or prices",()=>{
 const store=read("functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs");
 assert.match(store,/enabled&&product\.active!==true/);
 assert.match(store,/countSharingApproved!==true/);
 assert.match(store,/rankingProductVisibilityAudit/);
 assert.doesNotMatch(store,/tx\.(?:update|set|create|delete)\((?:products\(|records\(|counts\()/);
});
