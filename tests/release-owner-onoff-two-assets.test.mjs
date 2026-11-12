import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 prepareOwnerOnOffTwoAssetRelease
} from "../tools/hosting/release-owner-onoff-two-assets.mjs";
import {
 ONOFF_ASSETS,hostingAssetHash
} from "../tools/hosting/owner-product-onoff-additive-guard.mjs";

const BASE="https://firebasehosting.googleapis.com/v1beta1";
const LATEST=BASE+"/sites/nico-factory/releases?pageSize=1";
const LIVE="sites/nico-factory/versions/current_verified";
const NEW="sites/nico-factory/versions/new_onoff_only";
const PUBLIC=Object.keys(ONOFF_ASSETS);
const MISSING=PUBLIC.slice(0,2);
const sources=Object.fromEntries(PUBLIC.map(path=>[
 path,readFileSync(new URL(".."+path,import.meta.url),"utf8")
]));
const initial=[
 {path:"/index.html",hash:"a".repeat(64)},
 {path:"/partner-workspace.html",hash:"b".repeat(64)},
 {path:"/owner-partner-admin.html",hash:"c".repeat(64)},
 ...PUBLIC.slice(2).map(path=>({path,hash:hostingAssetHash(sources[path])}))
];
const conf={headers:[{source:"**",headers:[{key:"X-Keep",value:"yes"}]}]};
const hashes=new Map(initial.map(x=>[x.path,x.hash]));
const target=new Map([...hashes,...MISSING.map(p=>[p,hostingAssetHash(sources[p])])]);
function fixture({files=initial,concurrent=false,required=true,badUpload=false,
  badFinal=false,badMeta=false,paginate=false,unknownHash=false,metaPending=0,
  omitEmptyUploadList=false,missingUploadContract=false,
  finalizedCountOmitted=false}={}){
 const calls=[];
 let live=LIVE,created=false,published=false,reads=0,uploaded=0,newMetaReads=0;
 const request=async(method,url,body=null,type="application/json")=>{
  calls.push({method,url,type,body});
  if(method==="GET"&&url===LATEST){
   reads++;
   if(concurrent&&created)live="sites/nico-factory/versions/concurrent";
   return {releases:[{version:{name:live}}]};
  }
  if(method==="GET"&&url===BASE+"/"+LIVE)
   return {name:LIVE,status:"FINALIZED",config:conf,fileCount:files.length};
  if(method==="GET"&&url===BASE+"/"+LIVE+"/files?pageSize=1000")
   return paginate?{files:files.slice(0,3),nextPageToken:"later"}:{files};
  if(method==="GET"&&url===BASE+"/"+LIVE+"/files?pageSize=1000&pageToken=later")
   return {files:files.slice(3)};
  if(method==="POST"&&url===BASE+"/sites/nico-factory/versions"){
   assert.deepEqual(body,{config:conf});
   created=true;return {name:NEW,status:"CREATED"};
  }
  if(method==="POST"&&url===BASE+"/"+NEW+":populateFiles"){
   assert.deepEqual(new Map(Object.entries(body.files)),target);
   if(missingUploadContract)return {};
   return {uploadUrl:badUpload?"https://evil.example/upload":
    "https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new_onoff_only/files",
    ...(!required&&omitEmptyUploadList?{}:{
     uploadRequiredHashes:unknownHash?["f".repeat(64)]:
      required?MISSING.map(p=>hostingAssetHash(sources[p])):[]
    })};
  }
  if(method==="POST"&&url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new_onoff_only/files/")){
   assert.equal(type,"application/octet-stream");
   assert(body instanceof Uint8Array);
   uploaded++;return {};
  }
  if(method==="PATCH"&&url===BASE+"/"+NEW+"?update_mask=status"){
   assert.deepEqual(body,{status:"FINALIZED"});
   assert(uploaded===MISSING.length||!required||badUpload);
   return {name:NEW,status:"FINALIZED",config:conf};
  }
  if(method==="GET"&&url===BASE+"/"+NEW+"/files?pageSize=1000")
   return {files:[...target].map(([path,hash])=>({
    path,hash:badFinal&&path===MISSING[0]?"f".repeat(64):hash
   }))};
  if(method==="GET"&&url===BASE+"/"+NEW){
   newMetaReads++;
   const pending=newMetaReads<=metaPending;
   return {name:NEW,status:pending?"CREATED":"FINALIZED",config:conf,
    ...(pending||finalizedCountOmitted?{}:
     {fileCount:target.size+(badMeta?1:0)})};
  }
  if(method==="POST"&&url===BASE+"/sites/nico-factory/releases?versionName="+encodeURIComponent(NEW)){
   assert.deepEqual(body,{});
   published=true;live=NEW;return {version:{name:NEW}};
  }
  throw Error("UNEXPECTED_REQUEST_"+method+"_"+url);
 };
 return {request,calls,get writes(){return calls.filter(x=>x.method!=="GET")},
  get created(){return created},get published(){return published}};
}
test("read-only preflight validates existing version and never writes a byte",async()=>{
 const f=fixture();
 const report=await prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources
 });
 assert.equal(report.released,false);
 assert.equal(report.originalFilesPreserved,initial.length);
 assert.equal(report.existingFilesReplaced,0);
 assert.deepEqual(report.newPaths,MISSING);
 assert.equal(report.firestoreWrites,0);
 assert.equal(report.functionsWrites,0);
 assert.equal(report.rulesWrites,0);
 assert.equal(f.writes.length,0);
 assert.equal(f.published,false);
});
test("FINALIZED response may omit fileCount after complete immutable manifest match",async()=>{
 const f=fixture({finalizedCountOmitted:true,required:false,omitEmptyUploadList:true});
 const messages=[];
 const result=await prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true,
  log:x=>messages.push(x),sleep:async()=>{}
 });
 assert.equal(result.released,true);
 assert.equal(f.published,true);
 assert(messages.some(x=>x.includes("FULL_MANIFEST_VERIFIED_COUNT_OMITTED")));
 assert(f.calls.some(x=>x.method==="GET"&&x.url===BASE+"/"+NEW+"/files?pageSize=1000"));
 assert.equal(f.writes.filter(x=>x.url.includes("/releases?versionName")).length,1);
});

test("finalized Hosting metadata may appear after exact file-hash verification, then publish once",async()=>{
 const f=fixture({metaPending:2});
 const report=await prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true,
  sleep:async()=>{}
 });
 assert.equal(report.released,true);
 assert.equal(f.published,true);
 assert.equal(f.calls.filter(x=>x.method==="GET"&&x.url===BASE+"/"+NEW).length,3);
 assert.equal(f.writes.filter(x=>x.url===BASE+"/sites/nico-factory/versions").length,1);
 assert.equal(f.writes.filter(x=>x.url.includes("/releases?versionName")).length,1);
});

test("a mock-approved release publishes ONLY two new assets and byte-preserves originals",async()=>{
 const f=fixture();
 const report=await prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true
 });
 assert.equal(report.released,true);
 assert.equal(report.createdVersion,NEW);
 assert.equal(report.hostingFilesAdded,2);
 assert.equal(report.originalFilesPreserved,initial.length);
 assert.equal(f.published,true);
 const uploaded=f.writes.filter(x=>x.url.includes("upload-firebasehosting"));
 assert.equal(uploaded.length,2);
 assert.equal(f.writes.filter(x=>x.url.endsWith("/versions")).length,1);
 assert.equal(f.writes.filter(x=>x.url.includes(":populateFiles")).length,1);
 assert.equal(f.writes.filter(x=>x.url.includes("/releases?versionName")).length,1);
 assert(f.calls.every(x=>!x.url.includes("firestore.googleapis.com")&&
  !x.url.includes("cloudfunctions.net")));
});
test("no actual writes are performed without independently supplied approval",async()=>{
 const f=fixture();
 await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true
 }),/INDEPENDENT_APPROVAL_MISSING/);
 assert.equal(f.calls.length,0);
});
test("existing identical five assets stop before a new upload or release",async()=>{
 const files=[...initial,...MISSING.map(p=>({
  path:p,hash:hostingAssetHash(sources[p])
 }))];
 const f=fixture({files});
 await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true
 }),/NOT_EXACT_TWO_NEW_FILES/);
 assert.equal(f.writes.length,0);
});
test("malformed current manifest or unknown colliding path fails without changing old version",async()=>{
 for(const files of [
  initial.filter(x=>x.path!=="/ranking/owner-product-visibility-panel.css"),
  [...initial,{path:MISSING[0],hash:"f".repeat(64)}],
  [...initial,initial[0]]
 ]){
  const f=fixture({files});
  await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
   request:f.request,sources,release:true,releaseAuthorized:true
  }),/STOP_OWNER_ONOFF_/);
  assert.equal(f.writes.length,0);
 }
});
test("pagination and identical asset inventory succeed without any writes",async()=>{
 const f=fixture({paginate:true});
 const report=await prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources
 });
 assert.deepEqual(report.newPaths,MISSING);
 assert(f.calls.some(x=>x.url.includes("pageToken=later")));
 assert.equal(f.writes.length,0);
});
test("changed published Hosting version halts before publishing any release",async()=>{
 const f=fixture({concurrent:true});
 await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true
 }),/RACE_BEFORE_PUBLISH|RACE_BEFORE_CREATE/);
 assert.equal(f.published,false);
});
test("cached static assets with omitted empty protobuf hash list still get full manifest verification",async()=>{
 const f=fixture({required:false,omitEmptyUploadList:true});
 const report=await prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true,sleep:async()=>{}
 });
 assert.equal(report.released,true);
 assert.equal(report.hostingFilesAdded,2);
 assert.equal(f.published,true);
 assert.equal(f.writes.filter(x=>x.url.includes("upload-firebasehosting")).length,0);
 assert.equal(f.writes.filter(x=>x.url.includes("/releases?versionName")).length,1);
 assert(f.calls.some(x=>x.method==="GET"&&x.url===BASE+"/"+NEW+"/files?pageSize=1000"));
});
test("unrecognized empty populate response is not silently treated as uploaded",async()=>{
 const f=fixture({missingUploadContract:true});
 await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
  request:f.request,sources,release:true,releaseAuthorized:true,sleep:async()=>{}
 }),/UPLOAD_INVENTORY_UNKNOWN/);
 assert.equal(f.published,false);
});

test("an unexpected upload digest or unsafe upload endpoint cannot publish",async()=>{
 for(const options of [{unknownHash:true},{badUpload:true}]){
  const f=fixture(options);
  await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
   request:f.request,sources,release:true,releaseAuthorized:true,
   sleep:async()=>{}
  }),/STOP_OWNER_ONOFF_TWO_ASSET_RELEASE_/);
  assert.equal(f.published,false);
 }
});
test("manifest mismatch or altered finalized count blocks release even after staging",async()=>{
 for(const options of [{badFinal:true},{badMeta:true}]){
  const f=fixture(options);
  await assert.rejects(prepareOwnerOnOffTwoAssetRelease({
   request:f.request,sources,release:true,releaseAuthorized:true
  }),/STOP_OWNER_ONOFF_TWO_ASSET_RELEASE_/);
  assert.equal(f.published,false);
 }
});
