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
  "get(companyPath(companyId)).data.get('companyKind', 'internal') == 'internal'",
  "get(userPath(request.auth.uid)).data.get('accessKind', 'internal') == 'internal'",
  "get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') == 'internal'",
  "get(userPath(request.auth.uid)).data.get('memberType', 'internal') != 'partner'",
  "get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal') != 'partner'"
 ];
 for(const check of required)assert(candidate.includes(check),check);
});
test("stage-2 candidate rejects unknown and cooperator member type instead of relying on partner-only blacklist",()=>{
 const i=candidate.indexOf("function isInternalFinanceReader(companyId)");
 const next=candidate.indexOf("\n    function ",i+1);
 const helper=candidate.slice(i,next<0?undefined:next);
 assert(helper.includes("in ['internal', 'direct', 'member', 'managed']"));
 assert.equal(helper.split("in ['internal', 'direct', 'member', 'managed']").length-1,2);
 assert(helper.includes("get(companyPath(companyId)).data.get('companyKind', 'internal') == 'internal'"));
 assert(helper.includes("get(userPath(request.auth.uid)).data.get('accessKind', 'internal') == 'internal'"));
 assert(helper.includes("get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') == 'internal'"));
});

test("production Firebase rules remain unchanged and new rules must pass emulator first",()=>{
 const firebase=JSON.parse(readFileSync(new URL("../firebase.json",import.meta.url),"utf8"));
 assert.equal(firebase.firestore.rules,"firestore.rules");
 assert(!original.includes("function isInternalFinanceReader("));
 assert(candidate.includes("function isInternalFinanceReader("));
});
test("unexpected legacy permissions are refused instead of silently creating insecure candidate",()=>{
 const broken=original.replace(
   /(match \/products\/\{productId\} \{\s*allow read: if )resource\.data\.companyId != null\s*&& sameCompany\(resource\.data\.companyId\);/,
   "$1true;"
 );
 assert.notEqual(broken,original,"test must mutate the actual product Rules");
 assert.throws(()=>modelOwnerOnlyFinanceRules(broken),/Unexpected legacy/);
});
