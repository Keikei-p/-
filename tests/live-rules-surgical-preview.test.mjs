import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewLiveRules,summarizeReviewedRulesMismatch} from "../tools/production/preview-live-finance-rules.mjs";

const reviewed=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const originalFunction=reviewed.match(/^[ \t]*function isCompanyMember\(companyId\) \{[\s\S]*?^[ \t]*\}/m)?.[0];
assert.ok(originalFunction);
const oldFunction=originalFunction.replace(
  /\n[ \t]*&& company\.get\('companyKind', 'internal'\)[\s\S]*?\n[ \t]*&& member\.get\('memberType', 'internal'\)[^\n]*;/,
  ";"
);
assert.notEqual(oldFunction,originalFunction,"fixture must model the actual old live member predicate");
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
  "review:revenueGoals",
  "review:records",
  "deny-delete:teams",
  "deny-delete:products",
  "deny-delete:goals"
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

function substituteFn(source,name,replacement){
 const found=new RegExp("^[ \\t]*function "+name+"\\(companyId\\) \\{[\\s\\S]*?^[ \\t]*\\}","m");
 assert.match(source,found);
 return source.replace(found,replacement);
}
test("legacy owner/master OR grant is closed without changing the existing internal catalog or access grant schema",()=>{
 let legacy=liveFixture();
 legacy=substituteFn(legacy,"isCompanyOwner",
  "    function isCompanyOwner(companyId) {\n"+
  "      return verifiedUser() && companyId != null && exists(companyPath(companyId)) &&\n"+
  "        get(userPath(request.auth.uid)).data.companyRole == 'owner';\n"+
  "    }");
 legacy=substituteFn(legacy,"isCompanyMaster",
  "    function isCompanyMaster(companyId) {\n"+
  "      return verifiedUser() && companyId != null && effectiveMasterUid(companyId) == request.auth.uid;\n"+
  "    }");
 legacy=substituteFn(legacy,"sameCompany",
  "    function sameCompany(companyId) {\n"+
  "      return companyId != null && (isCompanyMember(companyId) || isCompanyOwner(companyId));\n"+
  "    }");
 const out=previewLiveRules(legacy,reviewed);
 assert.equal(out.matchesReviewed,true);
 assert.equal(out.candidate,reviewed);
 assert(out.changed.includes("isCompanyOwner"));
 assert(out.changed.includes("isCompanyMaster"));
 assert(out.changed.includes("sameCompany"));
});
test("previous revenue goal access expression is recompiled from reviewed optimized grants",()=>{
 let legacy=reviewed.replace(
   "        && revenueGrantedAfterMembership(request.resource.data.companyId)",
   "        && canViewRevenue(request.resource.data.companyId)"
 );
 if(legacy===reviewed){
   // Historical Rules used older repeated leader grant logic.
   const pos=reviewed.indexOf("match /revenueGoals/{goalId} {");
   assert(pos>0);
   const tail=reviewed.slice(pos);
   legacy=reviewed.slice(0,pos)+tail.replace(
    "revenueGrantedAfterMembership(resource.data.companyId)",
    "canViewRevenue(resource.data.companyId)");
 }
 assert.notEqual(legacy,reviewed);
 const out=previewLiveRules(legacy,reviewed);
 assert(out.changed.includes("review:revenueGoals"));
 assert.equal(out.candidate,reviewed);
});

test("actual-live canWriteDailyRecord repeated owner grant is replaced by reviewed optimized helper",()=>{
 const original=reviewed.match(/^[ \t]*function canWriteDailyRecord\(companyId, targetUid, teamId\) \{[\s\S]*?^[ \t]*\}/m)?.[0];
 assert.ok(original);
 const expensive=original.replace(
  "(actor.companyRole == 'owner'\n          && get(userPath(request.auth.uid)).data.companyRole == 'owner')",
  "(actor.companyRole == 'owner' && isCompanyOwner(companyId))");
 assert.notEqual(expensive,original);
 const live=liveFixture().replace(original,expensive);
 const preview=previewLiveRules(live,reviewed);
 assert.equal(preview.candidate,reviewed);
 assert.ok(preview.changed.includes("canWriteDailyRecord"));
 assert.equal(preview.matchesReviewed,true);
});

test("unexpected extra finance get permission never passes exact-source live preview gate",()=>{
 const live=liveFixture();
 const anchor="allow read: if resource.data.companyId != null\\n        && sameCompany(resource.data.companyId);".replace("\\n","\n");
 assert.ok(live.includes(anchor));
 const altered=live.replace(anchor,anchor+"\n      allow get: if true;");
 const result=previewLiveRules(altered,reviewed);
 assert.equal(result.matchesReviewed,false,"additive finance get grant must reject live release");
 assert.notEqual(result.candidateSha,result.reviewedSha);
 const script=readFileSync(new URL("../tools/production/preview-live-finance-rules.mjs",import.meta.url),"utf8");
 assert.ok(script.includes('writeFileSync(process.env.RUNNER_TEMP+"/nico-live-reviewed-parity.status"'));
 const workflow=readFileSync(new URL("../.github/workflows/nico-live-rules-hotfix-preview.yml",import.meta.url),"utf8");
 assert.ok(workflow.includes("BLOCK any unreviewed live patch"));
 assert.ok(workflow.includes("STOP_UNREVIEWED_LIVE_FINANCE_RULES"));
 // The workflow contains these strings only as a grep STOP-check, not an operation.
 assert.ok(workflow.includes("if grep -E"));
 assert.ok(workflow.includes("tools/production/preview-live-finance-rules.mjs; then"));
});
test("partner-safe reviewed rules retain internal owner and explicitly approved leader finance paths",()=>{
 const out=previewLiveRules(liveFixture(),reviewed);
 assert.equal(out.matchesReviewed,true);
 for(const token of [
  "company.get('companyKind', 'internal') == 'internal'",
  "user.get('accessKind', 'internal') == 'internal'",
  "member.get('accessKind', 'internal') == 'internal'",
  "user.get('memberType', 'internal') in ['internal', 'direct', 'member', 'managed']",
  "member.get('memberType', 'internal') in ['internal', 'direct', 'member', 'managed']",
  "function canViewRevenue(", "function canViewUnitPrice("
 ])assert.ok(out.candidate.includes(token),token);
});

test("finance Rules mismatch diagnostic outputs only collection names and line counts, never rule contents",()=>{
 const productStart=reviewed.indexOf("match /products/{productId} {");
 assert.ok(productStart>0);
 const candidate=reviewed.slice(0,productStart)+
  reviewed.slice(productStart).replace(
   "allow read: if resource.data.companyId != null",
   "allow read: if true || resource.data.companyId != null"
  );
 assert.notEqual(candidate,reviewed);
 const summary=summarizeReviewedRulesMismatch(candidate,reviewed);
 assert.ok(summary.firstDifferenceLine>0);
 assert.ok(summary.differentCollections.includes("products"));
 const serialized=JSON.stringify(summary);
 assert.doesNotMatch(serialized,/allow read:|resource\.data|isCompanyMember\(/);
 assert.equal(serialized.includes("sales-management-cc116"),false);
});
