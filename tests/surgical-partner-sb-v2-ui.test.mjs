import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {
 ASSET,EXACT_PREVIOUS_VERSION,EXACT_PREVIOUS_GIT_BLOB,
 validateManifest,uploadReviewedSbV2PartnerUi
} from "../tools/hosting/surgical-partner-sb-v2-ui.mjs";

const original=readFileSync(new URL("../partner-workspace.html",import.meta.url));
const latest=readFileSync(new URL("../staging/partner-sb-v2/partner-workspace.html",import.meta.url));
const hex=x=>createHash("sha256").update(x).digest("hex");
const oldHash=hex(gzipSync(original,{mtime:0}));
const newHash=hex(gzipSync(latest,{mtime:0}));
const gitBlob=b=>createHash("sha1").update("blob "+b.length+String.fromCharCode(0)).update(b).digest("hex");
const paths=[
 "/index.html","/partner-invite.html","/partner-counts.html",ASSET,
 "/service-worker.js","/script.js","/style.css","/manifest.webmanifest",
 "/icon-192.png","/icon-512.png","/icon-180.png","/finance-boundary-check.html"
];
const oldFiles=paths.map((file,i)=>({path:file,
 hash:file===ASSET?oldHash:String(i).padStart(64,"a")
}));
const version=EXACT_PREVIOUS_VERSION;
const newVersion="sites/nico-factory/versions/synthetic-v2-01";
function fake({files=oldFiles,sourceVersion=version,complete=false}={}){
 const requests=[],config={rewrites:[{source:"**",destination:"/index.html"}],headers:[]};
 let releaseCalled=false;
 const request=async(method,url,body)=>{
  requests.push({method,url,body});
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:sourceVersion}}]};
  if(method==="GET"&&url.endsWith("/"+sourceVersion))
   return {name:sourceVersion,status:"FINALIZED",fileCount:12,config};
  if(method==="GET"&&url.includes("/"+sourceVersion+"/files?"))
   return {files};
  if(!complete)throw Error("DRY_RUN_MADE_UNEXPECTED_REMOTE_REQUEST");
  if(method==="POST"&&url.endsWith("/sites/nico-factory/versions"))
   return {name:newVersion,status:"CREATED"};
  if(method==="POST"&&url.endsWith("/"+newVersion+":populateFiles")){
   assert.equal(Object.keys(body.files).length,12);
   const expected=new Map(files.map(x=>[x.path,x.hash]));
   expected.set(ASSET,newHash);
   for(const [name,hash] of Object.entries(body.files))
    assert.equal(hash,expected.get(name),name);
   return {uploadRequiredHashes:[]};
  }
  if(method==="PATCH"&&url.includes("/"+newVersion+"?"))
   return {name:newVersion,status:"FINALIZED",fileCount:12,config};
  if(method==="GET"&&url.endsWith("/"+newVersion))
   return {name:newVersion,status:"FINALIZED",config};
  if(method==="GET"&&url.includes("/"+newVersion+"/files?"))
   return {files:files.map(x=>x.path===ASSET?{...x,hash:newHash}:x)};
  if(method==="POST"&&url.includes("/sites/nico-factory/releases?versionName=")){
   releaseCalled=true;
   return {name:"sites/nico-factory/releases/synthetic-v2",
    version:{name:newVersion}};
  }
  throw Error("UNREVIEWED_SIMULATED_HOSTING_REQUEST_"+method);
 };
 return {request,requests,get released(){return releaseCalled}};
}
test("existing production page and reviewed live version are exact immutable originals",()=>{
 assert.equal(gitBlob(original),EXACT_PREVIOUS_GIT_BLOB);
 assert.equal(ASSET,"/partner-workspace.html");
 assert.equal(version,"sites/nico-factory/versions/551d5e3128fd01bd");
 assert.notEqual(oldHash,newHash);
 assert.equal(paths.length,12);
 assert.equal(paths.filter(x=>x===ASSET).length,1);
});
test("exactly one reviewed page changes, all 11 other Hosting assets survive by hash",()=>{
 const {original:before,next}=validateManifest(oldFiles,
  new Map([[ASSET,newHash]]),12,oldHash);
 assert.equal(next.size,12);
 for(const [file,hash] of before)
  assert.equal(next.get(file),file===ASSET?newHash:hash,file);
 assert.throws(()=>validateManifest(oldFiles,new Map([[ASSET,oldHash]]),12,oldHash),
  /PARTNER_WORKSPACE_UNCHANGED/);
 assert.throws(()=>validateManifest(oldFiles,new Map([["/index.html",newHash]]),12,oldHash),
  /ONLY_ONE_PARTNER_WORKSPACE_REPLACEMENT_ALLOWED/);
 assert.throws(()=>validateManifest(oldFiles,new Map([[ASSET,newHash]]),12,"c".repeat(64)),
  /LIVE_PARTNER_PAGE_NOT_EXACT_PREVIOUS_BYTES/);
});
test("real uploader dry-run uses metadata GET only and cannot publish any assets",async()=>{
 const f=fake();
 const result=await uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:f.request,release:false,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,12);
 assert.equal(f.requests.length,3);
 assert.ok(f.requests.every(x=>x.method==="GET"&&x.body===undefined));
});
test("a different live version, altered live file, missing login/finance page blocks writes",async()=>{
 const changed=fake({sourceVersion:"sites/nico-factory/versions/unreviewed-other"});
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:changed.request,release:true,log:()=>{}
 }),/UNREVIEWED_LIVE_VERSION/);
 assert.equal(changed.requests.length,1);
 assert.ok(changed.requests.every(x=>x.method==="GET"));
 const modified=fake({files:oldFiles.map(x=>x.path===ASSET?
  {...x,hash:"f".repeat(64)}:x)});
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:modified.request,release:true,log:()=>{}
 }),/LIVE_PARTNER_PAGE_NOT_EXACT_PREVIOUS_BYTES/);
 assert.ok(modified.requests.every(x=>x.method==="GET"));
 const missing=fake({files:oldFiles.filter(x=>x.path!=="/finance-boundary-check.html")});
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:missing.request,release:true,log:()=>{}
 }),/LIVE_REQUIRED_ASSETS_UNVERIFIED/);
 assert.ok(missing.requests.every(x=>x.method==="GET"));
});
test("a non-approved old page or a modified split/client page fails before any remote call",async()=>{
 const badOld=fake();
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:Buffer.from("unreviewed"),request:badOld.request,
  release:true,log:()=>{}
 }),/OLD_PARTNER_PAGE_BLOB_UNREVIEWED/);
 assert.equal(badOld.requests.length,0);
 const badNext=fake();
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:Buffer.from(latest.toString().replace("sb_count_mismatch","tampered")),
  originalBytes:original,request:badNext.request,release:true,log:()=>{}
 }),/INVALID_COUNT_ONLY_SB_V2_ASSET/);
 assert.equal(badNext.requests.length,0);
});
test("mock release preserves all 12 paths, same config, only partner workspace page changes",async()=>{
 const f=fake({complete:true});
 const result=await uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:f.request,release:true,log:()=>{}
 });
 assert.equal(result.released,true);
 assert.equal(result.newVersion,newVersion);
 assert.equal(result.originalCount,12);
 assert.equal(f.released,true);
 const remoteWrites=f.requests.filter(x=>x.method!=="GET");
 assert.equal(remoteWrites.filter(x=>x.method==="POST"&&x.url.includes("/releases?")).length,1);
 assert.ok(remoteWrites.every(x=>x.url.includes("firebasehosting.googleapis.com")));
 assert.ok(remoteWrites.every(x=>!x.url.includes("firestore")&&!x.url.includes("cloudfunctions")));
 assert.equal(f.requests.filter(x=>x.url.includes("/"+newVersion+"/files?")).length,1);
});
test("publisher never writes Rules, Functions, Firestore, accounts or logs finance",()=>{
 const s=readFileSync(new URL("../tools/hosting/surgical-partner-sb-v2-ui.mjs",import.meta.url),"utf8");
 assert.match(s,/CONFIRM_SB_V2_ONLY_AFTER_REAL_PARTNER_PROOF/);
 assert.match(s,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(s,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(s,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(s,/NON_PARTNER_FILE_MODIFIED/);
 assert.doesNotMatch(s,/firebase deploy|https:\/\/firestore\.googleapis\.com|firebaserules\.googleapis\.com/);
 assert.doesNotMatch(s,/setDoc\(|updateDoc\(|deleteDoc\(|runTransaction\(/);
});

test("repeated original Hosting file-list page tokens fail closed before any write",async()=>{
 const f=fake();
 const repeated=async(method,url,body)=>{
  const response=await f.request(method,url,body);
  return method==="GET"&&url.includes("/"+version+"/files?")
   ?{...response,nextPageToken:"repeat"}:response;
 };
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:repeated,release:true,log:()=>{}
 }),/SOURCE_FILE_PAGE_LOOP/);
 assert.equal(f.requests.length,4,"two metadata GETs and two file-list GETs only");
 assert.ok(f.requests.every(x=>x.method==="GET"),"no release or asset writes");
 assert.equal(f.released,false);
});

test("non-string live Hosting page tokens fail closed without releasing",async()=>{
 const f=fake();
 const malformed=async(method,url,body)=>{
  const response=await f.request(method,url,body);
  return method==="GET"&&url.includes("/"+version+"/files?")
   ?{...response,nextPageToken:{broken:true}}:response;
 };
 await assert.rejects(uploadReviewedSbV2PartnerUi({
  assetBytes:latest,originalBytes:original,request:malformed,release:true,log:()=>{}
 }),/SOURCE_FILE_PAGE_TOKEN_INVALID/);
 assert.equal(f.requests.length,3);
 assert.ok(f.requests.every(x=>x.method==="GET"));
 assert.equal(f.released,false);
});
