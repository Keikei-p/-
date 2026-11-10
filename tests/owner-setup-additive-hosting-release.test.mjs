import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SOURCES,prepareOwnerSetupAdditive,uploadSha}
 from "../tools/hosting/owner-setup-additive-guard.mjs";
import {releaseOwnerSetupAdditive}
 from "../tools/hosting/release-owner-setup-additive.mjs";
const sources=()=>Object.fromEntries(Object.keys(SOURCES).map(name=>[
 name,readFileSync(new URL("../"+name,import.meta.url),"utf8")
]));
const oldFiles=()=>[
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/owner-partner-admin.html"
].map((path,i)=>({path,hash:String(i+1).repeat(64)}));
test("all eleven real Owner assets match pinned immutable source, have no finance SDK reads",()=>{
 const src=sources(),plan=prepareOwnerSetupAdditive({oldFiles:oldFiles(),sources:src});
 assert.equal(plan.sourceFiles,5);
 assert.equal(plan.additions,11);
 assert.equal(plan.payloads.size,11);
 assert.equal(plan.proposedManifest.size,16);
 assert.equal(plan.existingAssetsPreserved,true);
 for(const [p,hash] of plan.originalManifest)
  assert.equal(plan.proposedManifest.get(p),hash);
 for(const name of Object.keys(SOURCES))
  assert.equal(plan.proposedManifest.get("/"+name),uploadSha(src[name]));
 assert(plan.addedPaths.every(p=>p==="/owner-partner-setup.html"||
  p.startsWith("/ranking/")));
});
test("unsafe mixed sources, collisions, previous files mutation, direct financial reads fail closed",()=>{
 const f=oldFiles(),src=sources();
 assert.throws(()=>prepareOwnerSetupAdditive({oldFiles:[...f,{
  path:"/owner-partner-setup.html",hash:"a".repeat(64)}],sources:src}),
  /STOP_OWNER_SETUP_HOSTING_ADDITIVE_PATH_ALREADY_EXISTS/);
 assert.throws(()=>prepareOwnerSetupAdditive({oldFiles:f.slice(1),sources:src}),
  /STOP_OWNER_SETUP_HOSTING_(?:EXISTING_CANONICAL_MISSING|LIVE_MANIFEST_SIZE)/);
 assert.throws(()=>prepareOwnerSetupAdditive({oldFiles:[...f,{...f[0]}],sources:src}),
  /STOP_OWNER_SETUP_HOSTING_LIVE_MANIFEST_INVALID/);
 assert.throws(()=>prepareOwnerSetupAdditive({oldFiles:f,sources:{
  ...src,["ranking/owner-product-visibility-panel.mjs"]:"import {getFirestore} from 'firebase-firestore';"
 }}),/STOP_OWNER_SETUP_HOSTING_SOURCE_REVIEW_PIN_MISMATCH/);
 assert.throws(()=>prepareOwnerSetupAdditive({oldFiles:f,sources:{
  ...src,unapproved:"secret"
 }}),/STOP_OWNER_SETUP_HOSTING_SOURCE_SET_MISMATCH/);
});
function mock(){
 const beforeVersion="sites/nico-factory/versions/LIVE",nextVersion="sites/nico-factory/versions/NEW_123";
 let current=beforeVersion,created=false,finalized=false;
 let additions=null,uploads=0,putCalls=0;
 const log=[];
 const request=async(method,url,body,type)=>{
  log.push({method,url});
  if(url==="https://firebasehosting.googleapis.com/v1beta1/sites/nico-factory/releases?pageSize=1"&&method==="GET")
   return {releases:[{version:{name:current}}]};
  if(url==="https://firebasehosting.googleapis.com/v1beta1/"+beforeVersion&&method==="GET")
   return {name:beforeVersion,status:"FINALIZED",fileCount:5,config:{headers:[{source:"**",headers:[{key:"X-NICO",value:"keep"}]}]}};
  if(url==="https://firebasehosting.googleapis.com/v1beta1/"+nextVersion&&method==="GET")
   return {name:nextVersion,status:finalized?"FINALIZED":"CREATED",config:{headers:[{source:"**",headers:[{key:"X-NICO",value:"keep"}]}]}};
  if(url.includes(beforeVersion+"/files?")&&method==="GET")return {files:oldFiles()};
  if(url.includes(nextVersion+"/files?")&&method==="GET"){
   assert(additions);
   return {files:[...additions].map(([path,hash])=>({path,hash}))};
  }
  if(url==="https://firebasehosting.googleapis.com/v1beta1/sites/nico-factory/versions"&&method==="POST"){
   assert(!created);created=true;
   assert.deepEqual(body,{config:{headers:[{source:"**",headers:[{key:"X-NICO",value:"keep"}]}]}});
   return {name:nextVersion,status:"CREATED"};
  }
  if(url==="https://firebasehosting.googleapis.com/v1beta1/"+nextVersion+":populateFiles"&&method==="POST"){
   assert.equal(putCalls++,0);
   additions=new Map(Object.entries(body.files));
   assert.equal(additions.size,16);
   return {uploadRequiredHashes:[...additions.entries()].filter(([key])=>!key.startsWith("/index")&&
    !oldFiles().some(f=>f.path===key)).map(([,hash])=>hash),
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/NEW_123/files"};
  }
  if(url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/NEW_123/files/")&&method==="POST"){
   assert.equal(type,"application/octet-stream");
   assert(Buffer.isBuffer(body));uploads++;
   return {};
  }
  if(url==="https://firebasehosting.googleapis.com/v1beta1/"+nextVersion+"?update_mask=status"&&method==="PATCH"){
   finalized=true;return {name:nextVersion,status:"FINALIZED",config:{headers:[{source:"**",headers:[{key:"X-NICO",value:"keep"}]}]}};
  }
  if(url.startsWith("https://firebasehosting.googleapis.com/v1beta1/sites/nico-factory/releases?versionName=")&&method==="POST"){
   assert(finalized);current=nextVersion;
   return {version:{name:nextVersion}};
  }
  throw Error("UNEXPECTED_TEST_REQUEST");
 };
 return {request,log,get uploads(){return uploads},get current(){return current}};
}
test("dry-run fetches only current published metadata; never creates a version",async()=>{
 const net=mock(),res=await releaseOwnerSetupAdditive({
  request:net.request,sources:sources(),release:false
 });
 assert.equal(res.released,false);
 assert.equal(res.newAssetsPlanned,11);
 assert.equal(net.log.filter(x=>x.method!=="GET").length,0);
});
test("manual release adds exactly 11 assets, verifies every original digest and keeps config",async()=>{
 const net=mock(),res=await releaseOwnerSetupAdditive({
  request:net.request,sources:sources(),release:true
 });
 assert.equal(res.released,true);
 assert.equal(res.existingAssetsUnchanged,5);
 assert.equal(res.newAssets,11);
 assert.equal(net.uploads,11);
 assert.equal(net.log.filter(x=>x.url.includes("releases?versionName=")).length,1);
});
