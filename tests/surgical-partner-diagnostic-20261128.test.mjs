import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {ASSET,EXACT_PREVIOUS_VERSION,EXACT_PREVIOUS_GIT_BLOB,validateManifest,uploadReviewedPartnerDiagnostic} from "../tools/hosting/surgical-partner-diagnostic-20261128.mjs";
const old=execFileSync("git",["show","23f0f2d52be3590afe3dc0433fa037a51501be99:finance-partner-boundary-check.html"],{maxBuffer:1024*1024});
const candidate=readFileSync(new URL("../finance-partner-boundary-check.html",import.meta.url));
const hash=b=>createHash("sha256").update(gzipSync(b,{mtime:0})).digest("hex");
const git=b=>createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");
const entries=["/index.html","/partner-workspace.html","/partner-counts.html","/partner-invite.html","/service-worker.js","/unrelated.js",ASSET].map((path,i)=>({path,hash:path===ASSET?hash(old):String(i).padStart(64,"a")}));
function fake(files=entries,version=EXACT_PREVIOUS_VERSION){
 const calls=[];
 const request=async(method,url)=>{calls.push(method);if(method!=="GET")throw Error("MOCK_NO_WRITE");
 if(url.endsWith("/releases?pageSize=1"))return {releases:[{version:{name:version}}]};
 if(url.endsWith("/"+version))return {name:version,status:"FINALIZED",config:{rewrites:[]}};
 if(url.includes("/files?"))return {files};throw Error("MOCK_UNKNOWN_URL");};
 return {calls,request};
}
test("exact two reviewed blobs and dry-run GET only",async()=>{
 assert.equal(git(old),EXACT_PREVIOUS_GIT_BLOB);
 assert.equal(git(candidate),"8a9641e10555e372a36044a557e5a15070749222");
 const f=fake();const r=await uploadReviewedPartnerDiagnostic({assetBytes:candidate,originalBytes:old,request:f.request,log:()=>{}});
 assert.equal(r.released,false);assert.equal(r.originalCount,entries.length);assert.deepEqual(f.calls,["GET","GET","GET"]);
});
test("one replaced asset and every other hash preserved",()=>{
 const {original,next}=validateManifest(entries,new Map([[ASSET,hash(candidate)]]),entries.length,hash(old));
 assert.equal(next.size,original.size);assert.notEqual(next.get(ASSET),original.get(ASSET));
 for(const [p,h] of original)if(p!==ASSET)assert.equal(next.get(p),h);
});
test("changed version, altered previous hash, missing required page or unreviewed candidate fail before any write",async()=>{
 for(const [f,asset,pattern] of [[fake(entries,"sites/nico-factory/versions/different"),candidate,/LIVE_BASELINE_CHANGED/],[fake(entries.map(x=>x.path===ASSET?{...x,hash:"f".repeat(64)}:x)),candidate,/LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/],[fake(entries.filter(x=>x.path!=="/partner-workspace.html")),candidate,/LIVE_REQUIRED_ASSETS_UNVERIFIED/],[fake(),Buffer.concat([candidate,Buffer.from(" ")]),/INVALID_READ_ONLY_DIAGNOSTIC_ASSET/]]){
 await assert.rejects(uploadReviewedPartnerDiagnostic({assetBytes:asset,originalBytes:old,request:f.request,release:true,log:()=>{}}),pattern);
 assert(f.calls.every(x=>x==="GET"));
 }
});

function releaseFake(mode="ok"){
 const calls=[],created="sites/nico-factory/versions/mock_new";
 const config={rewrites:[],headers:[{glob:"**",headers:[{key:"X-Test",value:"keep"}]}]};
 let expected={},latestReads=0;
 const request=async(method,url,body,type)=>{
  calls.push({method,url,body,type});
  if(method==="GET"&&url.endsWith("/releases?pageSize=1")){
   latestReads++;
   return {releases:[{version:{name:mode==="concurrent"&&latestReads===3?
    "sites/nico-factory/versions/other":EXACT_PREVIOUS_VERSION}}]};
  }
  if(method==="GET"&&url.endsWith("/"+EXACT_PREVIOUS_VERSION))
   return {name:EXACT_PREVIOUS_VERSION,status:"FINALIZED",config,fileCount:entries.length};
  if(method==="GET"&&url.includes("/"+EXACT_PREVIOUS_VERSION+"/files?"))return {files:entries};
  if(method==="POST"&&url.endsWith("/sites/nico-factory/versions")){
   assert.deepEqual(body,{config});
   return {name:created,status:"CREATED"};
  }
  if(method==="POST"&&url.endsWith("/"+created+":populateFiles")){
   expected=body.files;
   return {uploadRequiredHashes:[mode==="old-blob-missing"?entries[0].hash:hash(candidate)],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/"+created};
  }
  if(method==="POST"&&url.startsWith("https://upload-firebasehosting.googleapis.com/upload/")){
   assert.equal(type,"application/octet-stream");
   assert.deepEqual(body,gzipSync(candidate,{mtime:0}));
   return {};
  }
  if(method==="PATCH"&&url.includes("/"+created+"?")){
   assert.deepEqual(body,{status:"FINALIZED"});
   return {name:created,status:"FINALIZED",config,fileCount:entries.length};
  }
  if(method==="GET"&&url.includes("/"+created+"/files?")){
   const files=Object.entries(expected).map(([path,hash])=>({path,hash}));
   if(mode==="hash-mismatch")files.find(f=>f.path==="/index.html").hash="e".repeat(64);
   return {files};
  }
  if(method==="GET"&&url.endsWith("/"+created))
   return {name:created,status:"FINALIZED",config:mode==="config-mismatch"?{}:config};
  if(method==="POST"&&url.includes("/sites/nico-factory/releases?versionName="))
   return {name:"mock_release",version:{name:created}};
  throw Error("UNEXPECTED_MOCK_REQUEST");
 };
 return {request,calls,get expected(){return expected}};
}
test("mock full release replaces exactly one path and preserves all other hashes and config",async()=>{
 const f=releaseFake();
 const result=await uploadReviewedPartnerDiagnostic({assetBytes:candidate,originalBytes:old,request:f.request,release:true,log:()=>{}});
 assert.equal(result.released,true);
 assert.equal(Object.keys(f.expected).length,entries.length);
 assert.equal(f.expected[ASSET],hash(candidate));
 for(const entry of entries)if(entry.path!==ASSET)assert.equal(f.expected[entry.path],entry.hash);
 assert.equal(f.calls.filter(c=>c.method==="POST"&&c.url.includes("/releases?versionName=")).length,1);
 assert.equal(f.calls.filter(c=>c.url.startsWith("https://upload-firebasehosting.googleapis.com/")).length,1);
});
test("mock release refuses changed final hash, config, live version or unavailable original asset before release",async()=>{
 for(const [mode,pattern] of [["hash-mismatch",/FINAL_ASSET_HASH_MISMATCH/],["config-mismatch",/FINAL_VERSION_CONFIG_UNVERIFIED/],["concurrent",/LIVE_CHANGED_BEFORE_RELEASE/],["old-blob-missing",/OLD_LIVE_BLOB_NOT_REUSABLE/]]){
  const f=releaseFake(mode);
  await assert.rejects(uploadReviewedPartnerDiagnostic({assetBytes:candidate,originalBytes:old,request:f.request,release:true,log:()=>{}}),pattern);
  assert.equal(f.calls.some(c=>c.method==="POST"&&c.url.includes("/releases?versionName=")),false);
 }
});
