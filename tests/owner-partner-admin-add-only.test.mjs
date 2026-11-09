import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {REVIEWED,prepareHubPortal}
 from "../tools/production/prepare-hub-owner-portal-static.mjs";
import {verifyAddOnlyManifest,publishAddOnlyPortal}
 from "../tools/hosting/owner-partner-admin-add-only.mjs";
const files=Object.fromEntries(Object.keys(REVIEWED).map(p=>
 [p,readFileSync(new URL("../"+p,import.meta.url),"utf8")]));
const assets=prepareHubPortal(files);
const names=[
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/finance-boundary-check.html","/another-approved-page.js"
];
const original=names.map((path,i)=>({path,hash:String(i+1).repeat(64)}));
const newHashes=new Map(Object.entries(assets).map(([p,v])=>[
 "/"+p,createHash("sha256").update(gzipSync(Buffer.from(v),{mtime:0})).digest("hex")
]));
const old="sites/nico-factory/versions/old_approved";
const newer="sites/nico-factory/versions/new_approved";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
function fake({existing=original,liveChanged=false,foreignHash=false}={}){
 const calls=[],config={rewrites:[{source:"**",destination:"/index.html"}]};
 let replaced=false;
 async function request(method,url,body){
  calls.push({method,url,body});
  if(url===BASE+"/sites/nico-factory/releases?pageSize=1"&&method==="GET")
   return {releases:[{version:{name:replaced?newer:old}}]};
  if(url===BASE+"/"+old&&method==="GET")
   return {name:old,status:"FINALIZED",config,fileCount:existing.length};
  if(url===BASE+"/"+newer&&method==="GET")
   return {name:newer,status:"FINALIZED",config,fileCount:existing.length+4};
  if(url===BASE+"/"+old+"/files?pageSize=1000"&&method==="GET")
   return {files:existing};
  if(url===BASE+"/"+newer+"/files?pageSize=1000"&&method==="GET")
   return {files:[...existing,...[...newHashes].map(([path,hash])=>({path,hash}))]};
  if(url===BASE+"/sites/nico-factory/versions"&&method==="POST"){
   replaced=liveChanged;
   return {name:newer,status:"CREATED"};
  }
  if(url===BASE+"/"+newer+":populateFiles"&&method==="POST"){
   const desired=Object.fromEntries([...existing].map(x=>[x.path,x.hash]));
   for(const [p,h] of newHashes)desired[p]=h;
   assert.deepEqual(body.files,desired);
   return {uploadRequiredHashes:foreignHash?["f".repeat(64)]:[...newHashes.values()],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new_approved/files"};
  }
  if(url.startsWith("https://upload-firebasehosting.googleapis.com/")&&method==="POST"){
   assert(Buffer.isBuffer(body));
   return {};
  }
  if(url===BASE+"/"+newer+"?update_mask=status"&&method==="PATCH")
   return {name:newer,status:"FINALIZED",config};
  if(url===BASE+"/sites/nico-factory/releases?versionName="+encodeURIComponent(newer)&&method==="POST")
   return {version:{name:newer}};
  throw Error("UNEXPECTED_REQUEST_"+method);
 }
 return {calls,request};
}
test("new management portal adds precisely four assets and preserves every existing path and digest",()=>{
 const report=verifyAddOnlyManifest(original,newHashes);
 assert.equal(report.original.size,original.length);
 assert.equal(report.next.size,original.length+4);
 for(const x of original)assert.equal(report.next.get(x.path),x.hash);
 assert.equal(report.next.get("/owner-partner-admin.html"),newHashes.get("/owner-partner-admin.html"));
});
test("read-only dry-run inspects complete existing Hosting manifest with no writes",async()=>{
 const f=fake(),result=await publishAddOnlyPortal({
  assets,request:f.request,release:false
 });
 assert.equal(result.released,false);
 assert.equal(result.oldFiles,original.length);
 assert.equal(f.calls.length,3);
 assert(f.calls.every(x=>x.method==="GET"));
});
test("successful additive Hosting release validates final full manifest and uploads only new blobs",async()=>{
 const f=fake(),result=await publishAddOnlyPortal({
  assets,request:f.request,release:true
 });
 assert.equal(result.released,true);
 assert.equal(result.newFiles,4);
 assert.equal(f.calls.filter(x=>x.method==="POST"&&x.url.includes(":populateFiles")).length,1);
 assert.equal(f.calls.filter(x=>x.url.startsWith("https://upload-firebasehosting.googleapis.com")).length,4);
 assert.equal(f.calls.filter(x=>x.url.includes("/releases?versionName=")).length,1);
 const manifest=f.calls.find(x=>x.url.endsWith(":populateFiles")).body.files;
 assert.equal(Object.keys(manifest).length,original.length+4);
 for(const existing of original)assert.equal(manifest[existing.path],existing.hash);
});
test("existing target path, wrong file hash and missing original pages stop before remote writes",async()=>{
 for(const existing of [
  [...original,{path:"/owner-partner-admin.html",hash:"f".repeat(64)}],
  original.filter(x=>x.path!=="/partner-counts.html"),
  original.map(x=>x.path==="/index.html"?{...x,hash:"invalid"}:x)
 ]){
  const f=fake({existing});
  await assert.rejects(publishAddOnlyPortal({
   assets,request:f.request,release:true
  }),/STOP_ADD_ONLY_OWNER_PORTAL_/);
  assert(f.calls.every(x=>x.method==="GET"));
 }
});
test("cannot silently reuse an untrusted old live blob or race another Hosting release",async()=>{
 for(const opts of [{foreignHash:true},{liveChanged:true}]){
  const f=fake(opts);
  await assert.rejects(publishAddOnlyPortal({
   assets,request:f.request,release:true
  }),/STOP_ADD_ONLY_OWNER_PORTAL_/);
  assert.equal(f.calls.filter(x=>x.url.includes("/releases?versionName=")).length,0);
 }
});
test("no extra asset names, foreign paths or unapproved scheme can enter publish",async()=>{
 for(const v of [
  {...assets,"/index.html":"unsafe"},
  Object.fromEntries(Object.entries(assets).slice(0,3))
 ]){
  const f=fake();
  await assert.rejects(publishAddOnlyPortal({assets:v,request:f.request,release:true}),
   /STOP_ADD_ONLY_OWNER_PORTAL_/);
  assert.equal(f.calls.length,0);
 }
 const fakeHashes=new Map(newHashes);
 fakeHashes.delete("/owner-partner-admin.html");
 assert.throws(()=>verifyAddOnlyManifest(original,fakeHashes),
  /STOP_ADD_ONLY_OWNER_PORTAL_MANIFEST_INPUT/);
});
test("release implementation forbids Firebase Firestore, sign-in or finance original access",()=>{
 const code=readFileSync(new URL("../tools/hosting/owner-partner-admin-add-only.mjs",import.meta.url),"utf8");
 assert.match(code,/OLD_LIVE_BLOBS_NOT_REUSABLE/);
 assert.match(code,/LIVE_CHANGED_BEFORE_CREATE/);
 assert.match(code,/CONCURRENT_HOSTING_RELEASE/);
 assert.match(code,/FINAL_MANIFEST_NOT_EXACT/);
 assert.doesNotMatch(code,/firestore\.googleapis\.com|firebaserules\.googleapis\.com|cloudfunctions\.net|firebase deploy/);
});
