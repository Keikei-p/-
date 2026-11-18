import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {
  REVIEWED_BEFORE,REVIEWED_AFTER,REVIEWED_PUBLIC_VERSION,
  REVIEWED_PUBLIC_SHA256,parseReviewedIndexHunks,applyHunks
} from "../tools/hosting/release-owner-archive-transplant.mjs";
import {verifyScopedArchiveRules,compareOwnerArchiveRulePhase,readDeployedOwnerArchiveRules}
 from "../tools/production/audit-owner-archive-rules-release.mjs";

const git=(...args)=>execFileSync("git",args,{encoding:"utf8",maxBuffer:5000000});
const oldIndex=git("show",REVIEWED_BEFORE+":index.html");
const index=git("show",REVIEWED_AFTER+":index.html");
const patch=git("diff","--unified=3",REVIEWED_BEFORE,REVIEWED_AFTER,"--","index.html");
const oldRules=git("show",REVIEWED_BEFORE+":firestore.rules");
const newRules=git("show",REVIEWED_AFTER+":firestore.rules");

test("reversible archive source matches exactly the reviewed main Git blobs",()=>{
 assert.equal(git("hash-object","index.html").trim(),git("rev-parse",REVIEWED_AFTER+":index.html").trim());
 assert.equal(git("hash-object","firestore.rules").trim(),git("rev-parse",REVIEWED_AFTER+":firestore.rules").trim());
 assert.match(index,/changeOwnerProductArchiveState/);
 assert.match(index,/productArchivePendingIds/);
 assert.match(index,/validateArchivedProductCountChange/);
});
test("hunk-only candidate is identical to approved index and reverses to original",()=>{
 const hunks=parseReviewedIndexHunks(patch);
 assert.ok(hunks.length>=5);
 assert.equal(applyHunks(oldIndex,hunks),index);
 assert.equal(applyHunks(index,hunks,true),oldIndex);
});
test("independently modified login FX remains unmodified after overlay and inverse",()=>{
 const hunks=parseReviewedIndexHunks(patch);
 const insert="/* approved deployment-specific login effect; never remove */";
 const live=oldIndex.replace("</head>",insert+"</head>");
 assert.notEqual(live,oldIndex);
 const overlay=applyHunks(live,hunks);
 assert.ok(overlay.includes(insert));
 assert.equal(overlay.replace(insert,""),index);
 assert.equal(applyHunks(overlay,hunks,true),live);
});
test("modified edit controls or missing context stop rather than guessing patches",()=>{
 const hunks=parseReviewedIndexHunks(patch);
 const live=oldIndex.replace("商材カードを長押しして、そのまま好きな位置へ動かすと並べ替えできます。",
  "これは異なる本番画面の文字です");
 assert.throws(()=>applyHunks(live,hunks),/STOP_OWNER_ARCHIVE_HOST_MISSING_OR_AMBIGUOUS_LIVE_HUNK/);
});
test("non-Owner-archive diffs and missing reviews reject",()=>{
 assert.throws(()=>parseReviewedIndexHunks(patch.replace("productArchivePendingIds","unrelatedPending")),/STOP_OWNER_ARCHIVE_HOST_ARCHIVE_PATCH_INCOMPLETE/);
 assert.equal(REVIEWED_PUBLIC_VERSION,"sites/nico-factory/versions/5b51a39e4318e1c1");
 assert.match(REVIEWED_PUBLIC_SHA256,/^[0-9a-f]{64}$/);
});
test("Firestore Rule change is limited to product active/updateAt and physical deletes remain forbidden",()=>{
 assert.equal(verifyScopedArchiveRules(oldRules,newRules),true);
 assert.ok(oldRules.includes("allow delete: if false"));
 assert.ok(newRules.includes("allow delete: if false"));
 assert.deepEqual(compareOwnerArchiveRulePhase({phase:"--before",live:oldRules,base:oldRules,reviewed:newRules}),
  {project:"sales-management-cc116",phase:"--before",deployedRulesVerified:true,
   nonProductRulesIdentical:true,physicalProductDeleteStillDenied:true,productionDocumentWrites:0});
 assert.deepEqual(compareOwnerArchiveRulePhase({phase:"--after",live:newRules,base:oldRules,reviewed:newRules}).phase,"--after");
});
test("Rule preimage drift stops before any production release",()=>{
 assert.throws(()=>compareOwnerArchiveRulePhase({phase:"--before",live:oldRules+"\n",base:oldRules,reviewed:newRules}),
  /STOP_OWNER_ARCHIVE_RULES_LIVE_PREIMAGE_CHANGED/);
 assert.throws(()=>compareOwnerArchiveRulePhase({phase:"--after",live:oldRules,base:oldRules,reviewed:newRules}),
  /STOP_OWNER_ARCHIVE_RULES_POSTDEPLOY_RULES_UNVERIFIED/);
 assert.throws(()=>verifyScopedArchiveRules(oldRules,newRules.replace("allow delete: if false","allow delete: if true")),
  /STOP_OWNER_ARCHIVE_RULES_UNREVIEWED_PRODUCT_RULES/);
});
test("Rule management API is GET-only and accepts reviewed Firebase source",async()=>{
 const ns="projects/sales-management-cc116/";
 const name=ns+"rulesets/test_fictitious";
 const got=[];
 const get=async url=>{
  got.push(url);
  if(url.endsWith("/releases/cloud.firestore"))
   return {status:200,json:async()=>({name:ns+"releases/cloud.firestore",rulesetName:name})};
  return {status:200,json:async()=>({name,source:{files:[{content:oldRules}]}})};
 };
 const x=await readDeployedOwnerArchiveRules({get});
 assert.equal(x,oldRules);
 assert.equal(got.length,2);
 assert.ok(got.every(s=>s.startsWith("https://firebaserules.googleapis.com/v1/")));
});
test("production release cannot be triggered from the PR, and alters only reviewed scoped files",()=>{
 const wf=readFileSync(new URL("../.github/workflows/nico-owner-product-archive-live-release.yml",import.meta.url),"utf8");
 assert.match(wf,/startsWith\(github\.event\.head_commit\.message/);
 assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
 assert.match(wf,/needs\.offline\.result == 'success'/);
 assert.doesNotMatch(wf,/delete\s*Doc|firestore:delete|firebase deploy --only hosting/);
});
