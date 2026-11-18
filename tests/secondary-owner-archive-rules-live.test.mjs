import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {
  scopeReviewedSecondaryOwnerRules,
  checkDeployedSecondaryOwnerRules
} from "../tools/production/audit-secondary-owner-archive-rules-release.mjs";
import {readDeployedOwnerArchiveRules}
 from "../tools/production/audit-owner-archive-rules-release.mjs";

const git=(...args)=>execFileSync("git",args,{encoding:"utf8",maxBuffer:300000});
const before=git("show","85ba8d0f86c693b79fc669ddb87c541c1f58d0bf:firestore.rules");
const after=git("show","6f20244475ba62fc15178a49b9ce6c8d4095cd60:firestore.rules");

test("Reviewed secondary Owner archive rule changes only active-update block",()=>{
 const a=scopeReviewedSecondaryOwnerRules(before,after);
 assert.equal(a.nonProductRulesIdentical,true);
 assert.equal(a.otherProductRulesIdentical,true);
 assert.equal(a.physicalDeleteForbidden,true);
 assert.equal(a.ownerUpdateOnlyActiveAndUpdatedAt,true);
});

test("Live-before and live-after must match exact original and repaired Rules",()=>{
 assert.equal(checkDeployedSecondaryOwnerRules({phase:"--before",live:before,previous:before,next:after}).liveRulesVerified,true);
 assert.equal(checkDeployedSecondaryOwnerRules({phase:"--after",live:after,previous:before,next:after}).liveRulesVerified,true);
 assert.throws(()=>checkDeployedSecondaryOwnerRules({phase:"--before",live:after,previous:before,next:after}),
  /STOP_NONMASTER_OWNER_ARCHIVE_LIVE_RULES_PREIMAGE_DRIFT/);
 assert.throws(()=>checkDeployedSecondaryOwnerRules({phase:"--after",live:before,previous:before,next:after}),
  /STOP_NONMASTER_OWNER_ARCHIVE_POST_RULES_NOT_DEPLOYED_EXACT/);
});

test("Cannot alter finance rules, product delete protection, or other product rules",()=>{
 assert.throws(()=>scopeReviewedSecondaryOwnerRules(before,after.replace("allow delete: if false;","allow delete: if true;")),
  /STOP_|FIRESTORE_/);
 assert.throws(()=>scopeReviewedSecondaryOwnerRules(before,after.replace("match /records/{recordId} {","match /records/{legacyRecordId} {")),
  /STOP_|FIRESTORE_/);
 assert.throws(()=>scopeReviewedSecondaryOwnerRules(before,after.replace("canManageProducts(resource.data.companyId)","true")),
  /STOP_NONMASTER_OWNER_ARCHIVE_CHANGED_OUTSIDE_REVIEWED_OWNER_ACTIVE_UPDATE/);
});

test("Official rules API GET reads only release and ruleset, with no mutations",async()=>{
 const prefix="projects/sales-management-cc116/";
 const id=prefix+"rulesets/test_readonly";
 const urls=[];
 const get=async url=>{
   urls.push(url);
   if(url.endsWith("releases/cloud.firestore"))
     return {status:200,json:async()=>({name:prefix+"releases/cloud.firestore",rulesetName:id})};
   return {status:200,json:async()=>({name:id,source:{files:[{content:before}]}})};
 };
 const result=await readDeployedOwnerArchiveRules({get});
 assert.equal(result,before);
 assert.equal(urls.length,2);
 assert.ok(urls.every(x=>x.startsWith("https://firebaserules.googleapis.com/v1/projects/sales-management-cc116/")));
});
