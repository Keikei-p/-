import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const locked=readFileSync(new URL("../finance-locked.rules",import.meta.url),"utf8");
const prod=readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");
const generator=readFileSync(new URL("../../security/finance-phase2-read-boundary.mjs",import.meta.url),"utf8");
const protectedRoots=["products","records","recordCorrections","revenueGoals"];
function body(name){
 const marker="match /"+name+"/{";
 const start=locked.indexOf(marker);
 assert(start>=0&&locked.indexOf(marker,start+marker.length)<0,"unique "+name);
 const end=locked.indexOf("\n    match /",start+marker.length);
 return locked.slice(start,end<0?undefined:end);
}
test("staged rule rejects partner COMPANY and one-sided or unknown user/member designations",()=>{
 const start=locked.indexOf("function isPartnerAccount(companyId)");
 const end=locked.indexOf("\n    function ",start+1);
 assert(start>=0&&end>start);
 const helper=locked.slice(start,end);
 for(const term of [
  "get(companyPath(companyId)).data.get('companyKind', 'internal') != 'internal'",
  "get(userPath(request.auth.uid)).data.get('accessKind', 'internal') != 'internal'",
  "get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') != 'internal'"
 ])assert(helper.includes(term),term);
 assert.equal(helper.split("in ['internal', 'direct', 'member', 'managed']").length-1,2);
 assert(helper.includes("|| !exists(companyPath(companyId))"));
 assert(helper.includes("|| !exists(userPath(request.auth.uid))"));
 assert(helper.includes("|| !exists(memberPath(companyId, request.auth.uid))"));
});
test("all money-bearing collections require internal Owner/Master before returning raw documents",()=>{
 for(const collection of protectedRoots){
  const section=body(collection);
  const found=[...section.matchAll(/allow\s+read:\s*if\s*([\s\S]*?);/g)];
  assert.equal(found.length,1,collection+" unique read condition");
  const condition=found[0][1];
  assert(condition.includes("sameCompany(resource.data.companyId)"));
  assert(condition.includes("isCompanyOwner(resource.data.companyId)"));
  if(collection==="revenueGoals"){
   // Goal read is granted through canViewRevenue, which itself rejects partners.
   assert(condition.includes("canViewRevenue(resource.data.companyId)"));
  }else{
   assert(condition.includes("isCompanyMaster(resource.data.companyId)"));
  }
  assert(!section.includes("allow list:"),collection+" cannot grant additional list");
  if(collection!=="records")assert(!section.includes("allow get:"),collection+" cannot grant additional get");
 }
 assert.match(locked,/function isCompanyOwner\(companyId\)\s*\{\s*return verifiedUser\(\)\s*&& !isPartnerAccount\(companyId\)/);
 assert.match(locked,/function isCompanyMaster\(companyId\)\s*\{\s*return verifiedUser\(\)\s*&& !isPartnerAccount\(companyId\)/);
 assert.match(locked,/function canViewRevenue\(companyId\)\s*\{\s*return !isPartnerAccount\(companyId\)/);
});
test("financial corrections and raw records cannot be deleted; production Rules were not replaced",()=>{
 assert.match(body("records"),/allow delete: if false;/);
 assert.match(body("recordCorrections"),/allow update, delete: if false;/);
 assert.match(generator,/in \['internal', 'direct', 'member', 'managed'\]/);
 const firebase=JSON.parse(readFileSync(new URL("../../firebase.json",import.meta.url),"utf8"));
 assert.equal(firebase.firestore.rules,"firestore.rules");
 assert(!prod.includes("function isPartnerAccount(companyId)"));
});
