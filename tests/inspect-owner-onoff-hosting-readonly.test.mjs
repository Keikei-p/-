import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 inspectLiveOwnerOnOffHosting,OWNER_ONOFF_HOSTING_BASE
} from "../tools/hosting/inspect-owner-onoff-hosting-readonly.mjs";
import {ONOFF_ASSETS,hostingAssetHash}
 from "../tools/hosting/owner-product-onoff-additive-guard.mjs";

const SITE="nico-factory";
const VERSION="sites/nico-factory/versions/current_unrelated_release";
const BASE=OWNER_ONOFF_HOSTING_BASE;
const RELEASES=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const sources=Object.fromEntries(Object.keys(ONOFF_ASSETS).map(path=>[
 path,readFileSync(new URL(".."+path,import.meta.url),"utf8")
]));
const missing=[
 "/owner-product-publication.html",
 "/ranking/owner-product-visibility-dashboard-mount.mjs"
];
const liveBase=[
 {path:"/index.html",hash:"a".repeat(64)},
 {path:"/partner-workspace.html",hash:"b".repeat(64)},
 {path:"/owner-partner-admin.html",hash:"c".repeat(64)},
 ...Object.keys(ONOFF_ASSETS).filter(x=>!missing.includes(x))
  .map(path=>({path,hash:hostingAssetHash(sources[path])}))
];
function fixture({files=liveBase,metaChange={},secondRelease=null,extraPage=false}={}){
 const calls=[];
 let releaseCalls=0;
 const readOnlyGet=async url=>{
  calls.push(url);
  assert(url.startsWith(BASE+"/"));
  if(url===RELEASES){
   releaseCalls++;
   return {releases:[{version:{name:releaseCalls>1&&secondRelease?
    secondRelease:VERSION}}]};
  }
  if(url===BASE+"/"+VERSION)
   return {name:VERSION,status:"FINALIZED",config:{headers:[]},
    fileCount:files.length,...metaChange};
  if(url===BASE+"/"+VERSION+"/files?pageSize=1000")
   return extraPage?{files:files.slice(0,4),nextPageToken:"next"}:
    {files};
  if(url===BASE+"/"+VERSION+"/files?pageSize=1000&pageToken=next")
   return {files:files.slice(4)};
  throw Error("UNKNOWN_READ_ONLY_API_"+url);
 };
 return {readOnlyGet,calls};
}
test("GET-only release inventory confirms EXACT two missing assets and preserves all live hashes",async()=>{
 const f=fixture();
 const result=await inspectLiveOwnerOnOffHosting({
  readOnlyGet:f.readOnlyGet,sources
 });
 assert.equal(result.scope,"OWNER_PRODUCT_ONOFF_GET_ONLY");
 assert.equal(result.version,VERSION);
 assert.deepEqual(result.newAssetPaths,missing);
 assert.equal(result.matchingPublishedDependencies,3);
 assert.equal(result.preservedExistingAssetCount,liveBase.length);
 assert.equal(result.hostingWrites,0);
 assert.equal(result.firestoreWrites,0);
 assert.equal(result.releaseReady,false);
 assert.equal(result.approvedToActivateCallables,false);
 assert(f.calls.every(url=>url.startsWith(BASE+"/")));
 assert.equal(f.calls.filter(url=>url===RELEASES).length,2);
});
test("unchanged live version and all five identical assets are idempotent, not an overwrite",async()=>{
 const files=[...liveBase,...missing.map(path=>({
  path,hash:hostingAssetHash(sources[path])
 }))];
 const f=fixture({files});
 const result=await inspectLiveOwnerOnOffHosting({
  readOnlyGet:f.readOnlyGet,sources
 });
 assert.deepEqual(result.newAssetPaths,[]);
 assert.equal(result.matchingPublishedDependencies,5);
 assert.equal(result.releaseReady,false);
});
test("real Hosting paginated manifest is compared before deriving two-file missing plan",async()=>{
 const f=fixture({extraPage:true});
 const result=await inspectLiveOwnerOnOffHosting({
  readOnlyGet:f.readOnlyGet,sources
 });
 assert.deepEqual(result.newAssetPaths,missing);
 assert.equal(f.calls.length,4);
});
test("unknown live collision, partial dependencies and third missing asset are denied",async()=>{
 const cases=[
  [...liveBase,{path:missing[0],hash:"f".repeat(64)}],
  liveBase.filter(x=>x.path!=="/ranking/owner-product-visibility-panel.css"),
  liveBase.filter(x=>x.path!=="/index.html")
 ];
 for(const files of cases){
  const f=fixture({files});
  await assert.rejects(inspectLiveOwnerOnOffHosting({
   readOnlyGet:f.readOnlyGet,sources
  }),/STOP_OWNER_ONOFF_/);
 }
});
test("release change while scanning aborts, never approves an obsolete manifest",async()=>{
 const f=fixture({secondRelease:"sites/nico-factory/versions/moved"});
 await assert.rejects(inspectLiveOwnerOnOffHosting({
  readOnlyGet:f.readOnlyGet,sources
 }),/CONCURRENT_HOSTING_RELEASE/);
});
test("malformed Hosting response, stale fileCount or invalid schema rejects",async()=>{
 const cases=[
  fixture({metaChange:{status:"CREATED"}}),
  fixture({metaChange:{fileCount:liveBase.length+1}}),
  fixture({metaChange:{config:null}}),
  fixture({files:[...liveBase,liveBase[0]]}),
  fixture({files:[{path:"/evil/../index.html",hash:"a".repeat(64)},...liveBase.slice(1)]})
 ];
 for(const f of cases)await assert.rejects(
  inspectLiveOwnerOnOffHosting({readOnlyGet:f.readOnlyGet,sources}),
  /STOP_OWNER_ONOFF_/
 );
});
