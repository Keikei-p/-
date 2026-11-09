"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const rules=fs.readFileSync(path.join(__dirname,"..","firestore.rules"),"utf8");
function matchBlock(prefix){
 const start=rules.indexOf(prefix);
 assert(start>=0,"missing "+prefix);
 const open=rules.indexOf("{",start+prefix.length-1);
 let depth=0;
 for(let i=open;i<rules.length;i++){
  if(rules[i]==="{")depth++;
  if(rules[i]==="}"&&!--depth)return rules.slice(open+1,i);
 }
 throw Error("unterminated rule "+prefix);
}
test("money-bearing product and record reads require internal company membership",()=>{
 const company=rules.slice(rules.indexOf("function isCompanyMember("),rules.indexOf("function isCompanyLeader("));
 assert.match(company,/company\.get\('companyKind', 'internal'\) == 'internal'/);
 assert.match(company,/user\.get\('accessKind', 'internal'\) == 'internal'/);
 assert.match(company,/member\.get\('accessKind', 'internal'\) == 'internal'/);
 const same=rules.slice(rules.indexOf("function sameCompany("),rules.indexOf("function ownerBootstrap("));
 assert.match(same,/isCompanyMember\(companyId\)/);
 for(const name of ["match /products/{productId}","match /records/{recordId}"]){
  const block=matchBlock(name);
  assert.match(block,/allow read: if resource\.data\.companyId != null\s*&& sameCompany\(resource\.data\.companyId\)/);
 }
});
