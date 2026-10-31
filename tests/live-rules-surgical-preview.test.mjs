import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewLiveRules} from "../tools/production/preview-live-finance-rules.mjs";

const reviewed=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const originalFunction=reviewed.match(/^[ \t]*function isCompanyMember\(companyId\) \{[\s\S]*?^[ \t]*\}/m)?.[0];
assert.ok(originalFunction);
const oldFunction=originalFunction.replace(
  /\n[ \t]*&& get\(companyPath\(companyId\)\)\.data\.get\('companyKind', 'internal'\) != 'partner'[\s\S]*?memberType', 'internal'\) != 'cooperator'/,
  ""
);
function liveFixture(){
  let v=reviewed.replace(originalFunction,oldFunction);
  for(const name of ["teams","products","records","goals","revenueGoals"]){
    // Only transform the strict, exact reviewed rule, simulating the old LIVE allow.
    const anchor=new RegExp("(match \\/"+name+"\\/\\{[A-Za-z]+\\} \\{[\\s\\S]*?)","m");
    const beginning=v.search(anchor);
    assert.ok(beginning>=0,name+" match exists");
    // Limit search to this collection by its closing brace rather than matching
    // another collection's 'allow delete'.
    const start=v.indexOf("match /"+name+"/{",beginning);
    const firstDelete=v.indexOf("allow delete: if false;",start);
    assert.ok(firstDelete>start,name+" has reviewed retention");
    const nextMatch=v.indexOf("\n    match /",start+7);
    assert.ok(nextMatch<0||firstDelete<nextMatch,name+" delete inside own match");
    v=v.slice(0,firstDelete)+
      "allow delete: if isCompanyOwner(resource.data.companyId);"+
      v.slice(firstDelete+"allow delete: if false;".length);
  }
  return v;
}
test("repair only membership and historical hard-delete grants, preserve every other live rule",()=>{
 const live=liveFixture(),out=previewLiveRules(live,reviewed);
 assert.deepEqual(out.changed,[
  "isCompanyMember",
  "deny-delete:teams",
  "deny-delete:products",
  "deny-delete:records",
  "deny-delete:goals",
  "deny-delete:revenueGoals"
 ]);
 assert.equal(out.matchesReviewed,true);
 assert.equal(out.candidate,reviewed);
 assert.notEqual(out.liveSha,out.candidateSha);
});
test("reviewed rules are already fixed and stay byte-identical",()=>{
 const out=previewLiveRules(reviewed,reviewed);
 assert.deepEqual(out.changed,[]);
 assert.equal(out.candidate,reviewed);
 assert.equal(out.liveSha,out.candidateSha);
});
test("second preview never introduces additional modifications",()=>{
 const first=previewLiveRules(liveFixture(),reviewed);
 const second=previewLiveRules(first.candidate,reviewed);
 assert.deepEqual(second.changed,[]);
 assert.equal(second.candidate,first.candidate);
});
test("unknown membership grant or missing delete grant halts without any output",()=>{
 const altered=liveFixture().replace("verifiedUser()\n        && companyId", "true\n        && companyId");
 assert.throws(()=>previewLiveRules(altered,reviewed),/UNEXPECTED_OLD_MEMBERSHIP_PREDICATE/);
 const missing=liveFixture().replace("allow delete: if isCompanyOwner(resource.data.companyId);",
   "allow update, delete: if true;");
 assert.throws(()=>previewLiveRules(missing,reviewed),/COMBINED_OR_WRITE_GRANT|EXPECTED_SINGLE_DELETE_RULE/);
});
test("never rewrites other financial rules and no production writes or rule deployments",()=>{
 const src=readFileSync(new URL("../tools/production/preview-live-finance-rules.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/firebase deploy|rulesets\.create|releases\.patch|releases\.create/);
 assert.doesNotMatch(src,/\b(?:setDoc|updateDoc|deleteDoc|addDoc|runTransaction)\s*\(/);
 const out=previewLiveRules(liveFixture(),reviewed);
 for(const text of ["function canViewRevenue(", "function canViewUnitPrice(",
   "match /users/{userId} {","match /invitations/{inviteId} {"]){
  assert.ok(out.candidate.includes(text));
 }
});
