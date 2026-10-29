import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {modelOwnerOnlyFinanceRules} from "../security/finance-phase2-read-boundary.mjs";
const original=readFileSync(new URL("../security/firestore.phase1.rules",import.meta.url),"utf8");
const candidate=modelOwnerOnlyFinanceRules(original);
const section=name=>{
 const i=candidate.indexOf("match /"+name+"/{");
 assert(i>=0);
 const n=candidate.indexOf("\n    match /",i+10);
 return candidate.slice(i,n<0?undefined:n);
};
test("staged-only rules deny finance reads and raw writes for partner owner/master",()=>{
 for(const name of ["products","records","recordCorrections","revenueGoals"]){
   const s=section(name);
   assert.match(s,/allow read: if[\s\S]*?isInternalFinanceReader\(resource\.data\.companyId\)/);
   assert.match(s,/allow create: if isInternalFinanceReader\(request\.resource\.data\.companyId\)/);
   if(name!=="recordCorrections")
    assert.match(s,/allow update: if isInternalFinanceReader\(resource\.data\.companyId\)/);
   if(name!=="recordCorrections")
    assert.match(s,/allow delete: if false;/);
 }
});
test("guard checks independent partner company, account and member flags",()=>{
 const required=[
  "get(companyPath(companyId)).data.get('companyKind', 'internal') != 'partner'",
  "get(userPath(request.auth.uid)).data.get('accessKind', 'internal') != 'partner'",
  "get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') != 'partner'",
  "get(userPath(request.auth.uid)).data.get('memberType', 'internal') != 'partner'",
  "get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal') != 'partner'"
 ];
 for(const check of required)assert(candidate.includes(check),check);
});
test("production Firebase rules remain unchanged and new rules must pass emulator first",()=>{
 const firebase=JSON.parse(readFileSync(new URL("../firebase.json",import.meta.url),"utf8"));
 assert.equal(firebase.firestore.rules,"firestore.rules");
 assert(!original.includes("function isInternalFinanceReader("));
 assert(candidate.includes("function isInternalFinanceReader("));
});
test("unexpected legacy permissions are refused instead of silently creating insecure candidate",()=>{
 assert.throws(()=>modelOwnerOnlyFinanceRules(
  original.replace("allow read: if resource.data.companyId != null\n        && sameCompany(resource.data.companyId);",
   "allow read: if true;")
 ),/Unexpected legacy/);
});
