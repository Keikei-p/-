import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {prepareCountPricingHotfix,gitBlob,BASE_COMMIT,LIVE_BLOB,CHANGED_FUNCTIONS,functionBody}
 from "../tools/hosting/prepare-count-pricing-hotfix.mjs";
const git=args=>execFileSync("git",args,{encoding:"utf8",maxBuffer:3000000});
const base=git(["show",BASE_COMMIT+":index.html"]),live=git(["cat-file","blob",LIVE_BLOB]);
const current=readFileSync(new URL("../index.html",import.meta.url),"utf8").replace(/\r\n/g,"\n");
// Test the component contract without freezing unrelated future dashboard UI.
// The real release CLI still validates the entire actual source and pinned asset.
let candidate=base;
for(const name of CHANGED_FUNCTIONS)
 candidate=candidate.replace(functionBody(base,name),functionBody(current,name));
test("candidate replaces exactly three pricing functions on actual live bytes and reverses to its pinned blob",()=>{
 const {asset,report}=prepareCountPricingHotfix({live,base,candidate});
 assert.equal(report.assetBlob,gitBlob(asset));assert.notEqual(report.assetBlob,LIVE_BLOB);
 assert.equal(report.candidateSourceBlob,gitBlob(candidate));
 assert.equal(report.productionReleaseApproved,false);assert.equal(report.deployed,false);
 assert.equal(report.dataWrites,0);
 let inverse=asset;
 for(const name of CHANGED_FUNCTIONS)
  inverse=inverse.replace(functionBody(candidate,name),functionBody(live,name));
 assert.equal(inverse,live);assert.equal(gitBlob(inverse),LIVE_BLOB);
 assert.equal(asset.includes("NICO_VERIFIED_INLINE_JOINT_CARDS_ENABLED"),live.includes("NICO_VERIFIED_INLINE_JOINT_CARDS_ENABLED"));
});
test("unknown live, baseline and unrelated candidate changes stop before any candidate is returned",()=>{
 assert.throws(()=>prepareCountPricingHotfix({live:live+"\n",base,candidate}),/LIVE_HTML_CHANGED/);
 assert.throws(()=>prepareCountPricingHotfix({live,base:base+"\n",candidate}),/MAIN_BASE_CHANGED/);
 assert.throws(()=>prepareCountPricingHotfix({live,base,candidate:candidate+"\nwindow.unreviewed=true;"}),/UNRELATED_INDEX_CHANGE/);
 assert.throws(()=>prepareCountPricingHotfix({live,base,candidate:base}),/EXPECTED_FIX_MISSING/);
});
