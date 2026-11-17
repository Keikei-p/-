import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SOURCES,uploadSha} from "../tools/hosting/owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS} from "../tools/hosting/owner-only-setup-replacement-guard.mjs";
import {LIVE_CURRENT_OWNER_JS,planOwnerEntryOneFile}
 from "../tools/hosting/owner-entry-one-file-guard.mjs";
import {historicalSources} from "./helpers/historical-builder-fixtures.mjs";

const orig=()=>historicalSources(SOURCES);
const candidate=()=>Object.fromEntries(Object.keys(OWNER_ONLY_REPLACEMENTS).map(file=>
 [file,readFileSync(new URL("../"+file,import.meta.url),"utf8")]));
function manifest(){
 const historical=orig(),fresh=candidate();
 const core=["/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/owner-partner-admin.html"].map((path,i)=>
  ({path,hash:String(i+1).repeat(64)}));
 const old=Object.keys(SOURCES).map(file=>({
  path:"/"+file,
  hash:uploadSha(LIVE_CURRENT_OWNER_JS.includes(file)?fresh[file]:historical[file])
 }));
 const others=Array.from({length:17},(_,i)=>({
  path:"/unrelated/keep"+i+".txt",hash:"a".repeat(64)
 }));
 return [...core,...old,...others];
}
test("published 3 current JS + 8 historic assets allow ONLY entry HTML replacement",()=>{
 const before=manifest(),proof=planOwnerEntryOneFile({
  liveFiles:before,historicalSources:orig(),candidateSources:candidate()
 });
 assert.deepEqual(proof.changedPaths,["/owner-partner-setup.html"]);
 assert.equal(proof.liveFileCount,33);
 assert.equal(proof.currentOwnerJsPublishedAndMatched,3);
 assert.equal(proof.historicalOwnerAssetsMatched,8);
 assert.equal(proof.existingFilesPreserved,32);
 assert.equal(proof.unrelatedAssetsUnmodified,true);
 assert.equal(proof.realOwnerAuthenticatedGetVerified,false);
 assert.equal(proof.liveHostingUpdated,false);
 assert.equal(proof.liveDocumentWrites,0);
 for(const [path,hash] of proof.originalManifest){
  assert.equal(proof.proposedManifest.get(path)===hash,path!=="/owner-partner-setup.html",path);
 }
 assert.equal(proof.originalManifest.size,proof.proposedManifest.size);
});
test("drift on any published reviewed source blocks release without replacement",()=>{
 for(const path of ["/owner-partner-setup.html",
  "/ranking/owner-partner-setup-mount.mjs",
  "/ranking/owner-product-visibility-panel.mjs",
  "/ranking/owner-reviewed-sku-mapping-panel.mjs",
  "/ranking/owner-ranking-consent-panel.mjs"]){
  const files=manifest();files.find(x=>x.path===path).hash="f".repeat(64);
  assert.throws(()=>planOwnerEntryOneFile({
   liveFiles:files,historicalSources:orig(),candidateSources:candidate()
  }),/STOP_OWNER_ENTRY_ONE_FILE_CURRENT_DEPLOYED_OWNER_ASSET_DRIFT/,path);
 }
});
test("a second release, missing current candidate or unknown asset count fail closed",()=>{
 const historical=orig(),fresh=candidate();
 const already=manifest();already.find(x=>x.path==="/owner-partner-setup.html").hash=
  uploadSha(fresh["owner-partner-setup.html"]);
 for(const x of [
  {liveFiles:already},
  {liveFiles:manifest().slice(1)},
  {liveFiles:[...manifest(),{path:"/extra",hash:"b".repeat(64)}]},
  {liveFiles:[...manifest().slice(1),manifest()[1]]},
  {liveFiles:manifest(),candidateSources:{...fresh,"owner-partner-setup.html":"tampered"}}
 ]){
  assert.throws(()=>planOwnerEntryOneFile({
   liveFiles:x.liveFiles,historicalSources,candidateSources:x.candidateSources??fresh
  }),/STOP_OWNER_ENTRY_ONE_FILE_/);
 }
});
test("never changes financial, rank or partner API and never grants real Owner identity",()=>{
 const src=readFileSync(new URL("../tools/hosting/owner-entry-one-file-guard.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/firebase deploy|\bsetDoc\(|\bwriteBatch\(|method:["'](?:POST|PATCH|DELETE)/);
 assert.match(src,/realOwnerAuthenticatedGetVerified:false/);
 assert.match(src,/existingFilesPreserved:32/);
 assert.match(src,/ownerSetupCompaniesOnly:true/);
});
