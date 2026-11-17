import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SOURCES,uploadSha}
 from "../tools/hosting/owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS,planOwnerOnlySetupReplacement}
 from "../tools/hosting/owner-only-setup-replacement-guard.mjs";
import {historicalSources} from "./helpers/historical-builder-fixtures.mjs";
const old=()=>historicalSources(SOURCES);
const candidate=()=>Object.fromEntries(
 Object.keys(OWNER_ONLY_REPLACEMENTS).map(path=>
  [path,readFileSync(new URL("../"+path,import.meta.url),"utf8")]));
const files=()=>[
 ...["/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/owner-partner-admin.html"].map((path,i)=>({
   path,hash:String(i+1).repeat(64)
  })),
 ...Object.entries(old()).map(([name,code])=>({
  path:"/"+name,hash:uploadSha(code)
 }))
];
test("owner-only setup replaces precisely four existing assets and all other hashes survive",()=>{
 const a=files(),v=planOwnerOnlySetupReplacement({
  liveFiles:a,historicalSources:old(),candidateSources:candidate()
 });
 assert.equal(v.replacementAssetCount,4);
 assert.equal(v.changedPaths.length,4);
 assert.equal(v.unchangedAssetCount,a.length-4);
 assert.equal(v.originalManifest.size,v.proposedManifest.size);
 for(const [path,hash] of v.originalManifest){
  assert.equal(v.proposedManifest.get(path)===hash,!v.changedPaths.includes(path),path);
 }
 assert.equal(v.backendOwnerOnlyGetVerified,false);
 assert.equal(v.realOwnerAccountVerified,false);
 assert.equal(v.releaseApproved,false);
 assert.equal(v.safeToPublish,false);
 assert.equal(v.productionWrites,0);
});
test("stale live Owner URL, unknown extra source or missing current hash always stops",()=>{
 const source=old(),now=candidate(),manifest=files();
 const path="/ranking/owner-partner-setup-mount.mjs";
 assert.throws(()=>planOwnerOnlySetupReplacement({
  liveFiles:manifest.map(row=>row.path===path?{...row,hash:"f".repeat(64)}:row),
  historicalSources:source,candidateSources:now
 }),/STOP_OWNER_ONLY_SETUP_REPLACEMENT_LIVE_OWNER_SOURCE_DRIFT/);
 assert.throws(()=>planOwnerOnlySetupReplacement({
  liveFiles:manifest,historicalSources:source,
  candidateSources:{...now,"index.html":"not allowed"}
 }),/STOP_OWNER_ONLY_SETUP_REPLACEMENT_INPUT/);
 assert.throws(()=>planOwnerOnlySetupReplacement({
  liveFiles:manifest,historicalSources:source,
  candidateSources:{...now,[Object.keys(now)[0]]:"// tampered"}
 }),/STOP_OWNER_ONLY_SETUP_REPLACEMENT_CURRENT_SOURCE_UNREVIEWED/);
 assert.throws(()=>planOwnerOnlySetupReplacement({
  liveFiles:manifest.filter(row=>row.path!==path),
  historicalSources:source,candidateSources:now
 }),/STOP_OWNER_ONLY_SETUP_REPLACEMENT_(?:INPUT|LIVE_OWNER_SOURCE_DRIFT|REPLACEMENT_PATH_ABSENT)/);
});
test("no source-only proof may promote an older deployed workspace into verified Owner mode",()=>{
 const check=planOwnerOnlySetupReplacement({
  liveFiles:files(),historicalSources:old(),candidateSources:candidate()
 });
 assert.equal(check.safeToPublish,false);
 assert.equal(check.backendOwnerOnlyGetVerified,false);
 assert.equal(check.releaseApproved,false);
 const source=readFileSync(new URL("../tools/hosting/owner-only-setup-replacement-guard.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/firebase deploy|method:"(?:POST|PATCH|DELETE)"|runTransaction\(/);
 assert.match(source,/ownerSetupCompaniesOnly:true/);
 assert.match(source,/safeToPublish:false/);
});
