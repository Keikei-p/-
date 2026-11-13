import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 ONOFF_ASSETS,sourceGitBlob,hostingAssetHash,planOwnerOnOffAssets
} from "../tools/hosting/owner-product-onoff-additive-guard.mjs";

const sources=Object.fromEntries(Object.keys(ONOFF_ASSETS).map(path=>[
 path,readFileSync(new URL(".."+path,import.meta.url),"utf8")
]));
const existing=()=>[
 {path:"/index.html",hash:"a".repeat(64)},
 {path:"/partner-workspace.html",hash:"b".repeat(64)},
 {path:"/owner-partner-admin.html",hash:"c".repeat(64)},
 {path:"/reports.txt",hash:"d".repeat(64)}
];

test("all five Owner ON/OFF page assets are exact reviewed Git blobs",()=>{
 assert.equal(Object.keys(ONOFF_ASSETS).length,5);
 for(const [path,expected] of Object.entries(ONOFF_ASSETS))
  assert.equal(sourceGitBlob(sources[path]),expected,path);
});

test("add-only offline Hosting plan includes the complete five-asset module/CSS closure",()=>{
 const original=existing();
 const plan=planOwnerOnOffAssets({liveFiles:original,sources});
 assert.equal(plan.status,"REVIEWED_OFFLINE_ADD_ONLY");
 assert.equal(plan.hostingReleaseApproved,false);
 assert.equal(plan.firestoreWrites,0);
 assert.equal(plan.remoteRequests,0);
 assert.equal(plan.rulesOrFunctionsChanged,false);
 assert.deepEqual(plan.newAssetPaths,Object.keys(ONOFF_ASSETS));
 assert.equal(plan.originalManifest.size,original.length);
 assert.equal(plan.proposedManifest.size,original.length+5);
 for(const row of original)
  assert.equal(plan.proposedManifest.get(row.path),row.hash);
 for(const path of Object.keys(ONOFF_ASSETS))
  assert.equal(plan.proposedManifest.get(path),hostingAssetHash(sources[path]));
});

test("already published byte-identical assets are preserved rather than rewritten",()=>{
 const paths=Object.keys(ONOFF_ASSETS);
 const all=[...existing(),...paths.map(path=>({
  path,hash:hostingAssetHash(sources[path])
 }))];
 const plan=planOwnerOnOffAssets({liveFiles:all,sources});
 assert.equal(plan.status,"ALREADY_IDENTICAL");
 assert.equal(plan.newAssetPaths.length,0);
 assert.equal(plan.proposedManifest.size,all.length);
});

test("a partial existing asset bundle adds only missing exact files",()=>{
 const path=Object.keys(ONOFF_ASSETS)[1];
 const all=[...existing(),{path,hash:hostingAssetHash(sources[path])}];
 const plan=planOwnerOnOffAssets({liveFiles:all,sources});
 assert.equal(plan.newAssetPaths.length,4);
 assert.equal(plan.proposedManifest.get(path),all.at(-1).hash);
});

test("unknown existing asset collisions fail closed instead of replacing a live file",()=>{
 const path=Object.keys(ONOFF_ASSETS)[0];
 assert.throws(()=>planOwnerOnOffAssets({
  liveFiles:[...existing(),{path,hash:"f".repeat(64)}],sources
 }),/STOP_OWNER_ONOFF_ASSETS_LIVE_ASSET_COLLISION/);
});

test("unreviewed source changes, missing CSS/JS assets and unknown file injection fail",()=>{
 const path=Object.keys(ONOFF_ASSETS)[0];
 for(const altered of [
  {...sources,[path]:sources[path]+"\n<!-- malicious drift -->"},
  Object.fromEntries(Object.entries(sources).filter(([p])=>p!==path)),
  {...sources,"/unexpected-private-page.html":"no"},
  {...sources,[path]:sources[path].replace("owner-product-visibility-panel.css","other.css")}
 ])assert.throws(()=>planOwnerOnOffAssets({
  liveFiles:existing(),sources:altered
 }),/STOP_OWNER_ONOFF_ASSETS_/);
});

test("duplicate/missing/invalid live manifest is rejected, without ever calling any cloud API",()=>{
 const original=existing();
 for(const mutated of [
  [...original,original[0]],
  original.filter(x=>x.path!=="/index.html"),
  [{path:"/index.html",hash:"bad"},...original.slice(1)],
  [{path:"/../override",hash:"1".repeat(64)},...original]
 ]) assert.throws(()=>planOwnerOnOffAssets({
  liveFiles:mutated,sources
 }),/STOP_OWNER_ONOFF_ASSETS_/);
});
