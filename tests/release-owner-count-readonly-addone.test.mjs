import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 NEW_PATH,BASE_VERSION,planOwnerCountAddOne,hostingHash,gitBlob,NEW_SOURCE_SHA
} from "../tools/hosting/owner-count-readonly-addone-guard.mjs";
import {publishOwnerCountAddOne} from "../tools/hosting/release-owner-count-readonly-addone.mjs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const oldSources={
 "/owner-partner-admin.html":read("staging/owner-workspace-errors-v1/owner-partner-admin.html"),
 "/owner-partner-admin-assets/mobile-bootstrap.mjs":read("staging/owner-workspace-errors-v1/mobile-bootstrap.mjs"),
 "/owner-partner-admin-assets/owner-client.mjs":read("staging/owner-workspace-errors-v1/owner-client.mjs"),
 "/owner-partner-admin-assets/owner-ui.mjs":read("staging/owner-workspace-errors-v1/owner-ui.mjs")
};
const candidate=read("staging/owner-count-readonly-v1/owner-partner-counts-readonly.html");
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const CREATED="sites/nico-factory/versions/new_version";
const NEW_LIVE="sites/nico-factory/versions/other_current_release";
const C={headers:[{source:"**",headers:[{key:"X-Test",value:"keep"}]}]};
const paths=[
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/finance-boundary-check.html",
 ...Array.from({length:8},(_,i)=>"/old-asset-"+i+".js")
];
function fixture({collision=false,drift=false,concurrent=false,unknownUpload=false,configChanged=false,
  newerSameContents=false,newerDifferentContents=false,newerDifferentConfig=false,
  newerOwnerDifferent=false,newerMissingPath=false}={}){
 const old=[
  ...paths.map((path,i)=>({path,hash:String(i%9+1).repeat(64)})),
  ...Object.entries(oldSources).map(([path,source])=>({path,hash:hostingHash(source)}))
 ];
 if(collision){old[0]={path:NEW_PATH,hash:old[0].hash}};
 if(drift){const row=old.find(x=>x.path==="/owner-partner-admin.html");row.hash="f".repeat(64)}
 const currentOld=old.map(x=>({...x}));
 if(newerDifferentContents)currentOld[0].hash="f".repeat(64);
 if(newerOwnerDifferent)currentOld.find(x=>
  x.path==="/owner-partner-admin.html").hash="e".repeat(64);
 if(newerMissingPath)currentOld[0].path="/unexpected-replacement-page";
 const amended=newerDifferentContents||newerOwnerDifferent||newerMissingPath;
 const approved=new Map([...(amended?currentOld:old).map(x=>[x.path,x.hash]),
  [NEW_PATH,hostingHash(candidate)]]);
 const logs=[];
 let live=newerSameContents||newerDifferentContents||newerDifferentConfig||
   newerOwnerDifferent||newerMissingPath?NEW_LIVE:BASE_VERSION,
  created=false,finalized=false,uploaded=false,postCount=0;
 const request=async(method,url,body=null,type="application/json")=>{
  logs.push({method,url,body:type==="application/octet-stream"?"binary":body});
  if(url===BASE+"/sites/nico-factory/releases?pageSize=1"&&method==="GET"){
   if(concurrent&&created&&!finalized)live="sites/nico-factory/versions/concurrent";
   return {releases:[{version:{name:live}}]};
  }
  if(url===BASE+"/"+BASE_VERSION&&method==="GET")
   return {name:BASE_VERSION,status:"FINALIZED",config:C,fileCount:old.length};
  if(url===BASE+"/"+NEW_LIVE&&method==="GET")
   return {name:NEW_LIVE,status:"FINALIZED",config:newerDifferentConfig?{rewrites:[]}:C,fileCount:old.length};
  if(url===BASE+"/"+BASE_VERSION+"/files?pageSize=1000"&&method==="GET")
   return {files:old};
  if(url===BASE+"/"+NEW_LIVE+"/files?pageSize=1000"&&method==="GET")
   return {files:currentOld};
  if(url===BASE+"/sites/nico-factory/versions"&&method==="POST"){
   created=true;return {name:CREATED,status:"CREATED"};
  }
  if(url===BASE+"/"+CREATED+":populateFiles"&&method==="POST"){
   assert.deepEqual(Object.entries(body.files),[...approved.entries()]);
   return {uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new_version/files",
    uploadRequiredHashes:unknownUpload?["f".repeat(64)]:[hostingHash(candidate)]};
  }
  if(url==="https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new_version/files/"+hostingHash(candidate)&&method==="POST"){
   assert.equal(type,"application/octet-stream");uploaded=true;return {};
  }
  if(url===BASE+"/"+CREATED+"?update_mask=status"&&method==="PATCH"){
   assert(uploaded);finalized=true;
   return {name:CREATED,status:"FINALIZED",config:configChanged?{rewrites:[]}:C};
  }
  if(url===BASE+"/"+CREATED+"/files?pageSize=1000"&&method==="GET")
   return {files:[...approved].map(([path,hash])=>({path,hash}))};
  if(url===BASE+"/"+CREATED&&method==="GET")
   return {name:CREATED,status:finalized?"FINALIZED":"CREATED",config:C};
  if(url===BASE+"/sites/nico-factory/releases?versionName="+encodeURIComponent(CREATED)&&method==="POST"){
   assert(finalized);live=CREATED;postCount++;return {version:{name:CREATED}};
  }
  throw Error("UNEXPECTED_URL_"+url);
 };
 return {request,logs,get writes(){return logs.filter(x=>x.method!=="GET")},
  get posted(){return postCount},old,approved};
}
test("candidate exact reviewed Git blob and strict 17-to-18 verified manifest",()=>{
 assert.equal(gitBlob(candidate),NEW_SOURCE_SHA);
 const f=fixture();
 const p=planOwnerCountAddOne({version:BASE_VERSION,liveFiles:f.old,oldSources,candidate});
 assert.equal(p.status,"REVIEWED_ADD_ONE_ONLY");
 assert.equal(p.previousCount,17);
 assert.equal(p.nextCount,18);
 assert.equal(p.originalManifest.size,17);
 assert.equal(p.proposedManifest.size,18);
 assert.equal(p.newPath,NEW_PATH);
 for(const [path,hash] of p.originalManifest)
  assert.equal(p.proposedManifest.get(path),hash,path);
});
test("live original version drift, added path collision, mutated source and financial HTML edits stop",()=>{
 const f=fixture();
 assert.throws(()=>planOwnerCountAddOne({version:"sites/nico-factory/versions/unknown",liveFiles:f.old,oldSources,candidate}),/STOP_OWNER_COUNT_ADDONE_BASE_VERSION_CHANGED/);
 for(const altered of [fixture({collision:true}).old,fixture({drift:true}).old,
   [...f.old,f.old[0]]])
  assert.throws(()=>planOwnerCountAddOne({version:BASE_VERSION,liveFiles:altered,oldSources,candidate}),/STOP_OWNER_COUNT_ADDONE_/);
 assert.throws(()=>planOwnerCountAddOne({version:BASE_VERSION,liveFiles:f.old,oldSources,candidate:candidate+"<script>setDoc()</script>"}),/STOP_OWNER_COUNT_ADDONE_/);
 assert.throws(()=>planOwnerCountAddOne({version:BASE_VERSION,liveFiles:f.old,oldSources:{...oldSources,"/owner-partner-admin.html":"modified"},candidate}),/STOP_OWNER_COUNT_ADDONE_/);
});
test("preflight only GETs live version and does not mutate or deploy",async()=>{
 const f=fixture(),result=await publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:false});
 assert.equal(result.released,false);
 assert.equal(result.originalAssetsUnmodified,17);
 assert.equal(result.newAssets,1);
 assert.equal(f.writes.length,0);
});
test("one-shot release adds exactly the new reviewed page, preserves every original hash and config",async()=>{
 const f=fixture();
 const result=await publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:true});
 assert.equal(result.released,true);
 assert.equal(result.newPage,NEW_PATH);
 assert.equal(result.oldFilesPreserved,17);
 assert.equal(result.firestoreWrites,0);
 assert.equal(f.posted,1);
 assert.equal(f.writes.filter(x=>x.url.includes(":populateFiles")).length,1);
 assert.equal(f.writes.filter(x=>x.url.includes("upload-firebasehosting")).length,1);
 assert(f.logs.every(x=>!x.url.includes("firestore")&&!x.url.includes("cloudfunctions.net")));
});
test("newer live version with identical 17 assets AND Hosting config is safe to add one",async()=>{
 const f=fixture({newerSameContents:true});
 const dry=await publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:false});
 assert.equal(dry.released,false);
 assert.equal(dry.baseVersion,NEW_LIVE);
 const report=await publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:true});
 assert.equal(report.released,true);
 assert.equal(f.posted,1);
});
test("newer live app files are copied byte-identically, never reverted",async()=>{
 const f=fixture({newerDifferentContents:true});
 const r=await publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:true});
 assert.equal(r.released,true);
 assert.equal(f.posted,1);
 const upload=f.writes.find(x=>x.url.includes(":populateFiles"));
 assert.equal(upload.body.files["/index.html"],"f".repeat(64));
});
test("updated Owner management assets are also preserved byte-identically, never reverted",async()=>{
 const f=fixture({newerOwnerDifferent:true});
 const result=await publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:true});
 assert.equal(result.released,true);
 const upload=f.writes.find(x=>x.url.includes(":populateFiles"));
 assert.equal(upload.body.files["/owner-partner-admin.html"],"e".repeat(64));
 assert.equal(f.posted,1);
});
test("an existing asset path removal or Hosting configuration change still fails before CREATE",async()=>{
 for(const opts of [{newerMissingPath:true},{newerDifferentConfig:true}]){
  const f=fixture(opts);
  await assert.rejects(publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:true}),
   /STOP_OWNER_(COUNT_ONE_RELEASE|COUNT_ADDONE)_/);
  assert.equal(f.writes.length,0);
 }
});
test("release blocks on unexpected upload hashes and modified config without activation",async()=>{
 for(const opts of [{unknownUpload:true},{configChanged:true},{drift:true}]){
  const f=fixture(opts);
  await assert.rejects(publishOwnerCountAddOne({request:f.request,oldSources,candidate,release:true}),
   /STOP_OWNER_(COUNT_ADDONE|COUNT_ONE_RELEASE)_/);
  assert.equal(f.posted,0);
 }
});
test("no broad firebase deploy or production business data mutation code",()=>{
 const js=read("tools/hosting/release-owner-count-readonly-addone.mjs");
 assert.doesNotMatch(js,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|\bDELETE\b|runTransaction\(|createUser\(/);
 assert.match(js,/NO|oldFilesPreserved|existingAuthFunctionsRulesUnchanged/);
});
