import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {planOwnerStaffHtmlOnly,hostingHash,SOURCE_VERSION,TARGET}
 from "../tools/hosting/owner-staff-html-only-guard.mjs";
import {releaseOnlyOwnerStaffHtml}
 from "../tools/hosting/release-owner-staff-html-only.mjs";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const old=SOURCE_VERSION,news="sites/nico-factory/versions/new_staff";
const base=new URL("../",import.meta.url);
const load=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const assets={
 previous:load("staging/owner-workspace-errors-v1/owner-partner-admin.html"),
 candidate:load("staging/owner-staff-count-readonly-v1/owner-partner-admin.html"),
 bootstrap:load("staging/owner-workspace-errors-v1/mobile-bootstrap.mjs"),
 client:load("staging/owner-workspace-errors-v1/owner-client.mjs"),
 ui:load("staging/owner-workspace-errors-v1/owner-ui.mjs")
};
const canon=["/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/finance-boundary-check.html","/script.js","/style.css",
 "/manifest.json","/service-worker.js","/legacy.html","/help.html",
 "/app-shell.html","/site-info.html"];
const paths={
 bootstrap:"/owner-partner-admin-assets/mobile-bootstrap.mjs",
 client:"/owner-partner-admin-assets/owner-client.mjs",
 ui:"/owner-partner-admin-assets/owner-ui.mjs"
};
function live(){
 const out=canon.map((path,i)=>({path,hash:String(i%9+1).repeat(64)}));
 out.push({path:TARGET,hash:hostingHash(assets.previous)});
 for(const [key,path] of Object.entries(paths))out.push({path,hash:hostingHash(assets[key])});
 assert.equal(out.length,17);
 return out;
}
function transport({drift=false,concurrent=false,configChanged=false,
 manifestCorrupt=false,wrongUpload=false}={}){
 const calls=[],original=live(),config={headers:[{source:"**",headers:[{
  key:"Cache-Control",value:"no-store"}]}]};
 if(drift)original.find(x=>x.path===TARGET).hash="f".repeat(64);
 let liveVersion=old,latestCalls=0,staged=[],done=false;
 const request=async(method,url,body=null,type="application/json")=>{
  calls.push({method,url,body:type==="application/octet-stream"?"binary":body});
  if(url===BASE+"/sites/nico-factory/releases?pageSize=1"&&method==="GET"){
   latestCalls++;
   if(concurrent&&latestCalls>2)liveVersion="sites/nico-factory/versions/other";
   return {releases:[{version:{name:liveVersion}}]};
  }
  if(url===BASE+"/"+old&&method==="GET")return {
   name:old,status:"FINALIZED",config,fileCount:17
  };
  if(url===BASE+"/"+old+"/files?pageSize=1000"&&method==="GET")
   return {files:original};
  if(url===BASE+"/sites/nico-factory/versions"&&method==="POST")
   return {name:news,status:"CREATED"};
  if(url===BASE+"/"+news+":populateFiles"&&method==="POST"){
   staged=Object.entries(body.files).map(([path,hash])=>({path,hash}));
   return {
    uploadRequiredHashes:[wrongUpload?"a".repeat(64):hostingHash(assets.candidate)],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new_staff/files"
   };
  }
  if(url.startsWith("https://upload-firebasehosting.googleapis.com/upload/")&&method==="POST"){
   assert.equal(type,"application/octet-stream");return {};
  }
  if(url===BASE+"/"+news+"?update_mask=status"&&method==="PATCH"){
   done=true;return {name:news,status:"FINALIZED",config:configChanged?{rewrites:[]}:config};
  }
  if(url===BASE+"/"+news+"/files?pageSize=1000"&&method==="GET")
   return {files:manifestCorrupt?staged.slice(1):staged};
  if(url===BASE+"/"+news&&method==="GET")return {name:news,status:done?"FINALIZED":"CREATED",config};
  if(url===BASE+"/sites/nico-factory/releases?versionName="+encodeURIComponent(news)&&method==="POST"){
   liveVersion=news;return {version:{name:news}};
  }
  throw Error("UNEXPECTED_REQUEST "+method+" "+url);
 };
 return {request,calls,original};
}
test("current production 17-file manifest -> only one Owner HTML replacement and 16 unchanged",()=>{
 const plan=planOwnerStaffHtmlOnly({liveFiles:live(),...assets});
 assert.equal(plan.changedPaths.length,1);
 assert.equal(plan.changedPaths[0],TARGET);
 assert.equal(plan.unchangedFileCount,16);
 assert.equal(plan.zeroFirestoreWrites,true);
 assert.equal(plan.releaseApproved,false);
 for(const [path,hash] of plan.originalManifest)
  assert.equal(plan.proposedManifest.get(path),path===TARGET?
   hostingHash(assets.candidate):hash);
});
test("preflight makes only GET requests; no Hosting version created",async()=>{
 const f=transport();
 const report=await releaseOnlyOwnerStaffHtml({...assets,request:f.request,release:false});
 assert.equal(report.released,false);
 assert.equal(report.liveCount,17);
 assert.equal(report.unmodified,16);
 assert(f.calls.every(x=>x.method==="GET"));
});
test("one-HTML-only production release preserves other 16 file hashes and config",async()=>{
 const f=transport();
 const out=await releaseOnlyOwnerStaffHtml({...assets,request:f.request,release:true});
 assert.equal(out.released,true);assert.equal(out.activatedVersion,news);
 assert.equal(out.productionDataWrites,0);
 assert.equal(out.oldVersionRetained,true);
 const populate=f.calls.find(x=>x.url.endsWith(":populateFiles"));
 const prev=new Map(f.original.map(x=>[x.path,x.hash]));
 for(const [path,hash] of Object.entries(populate.body.files))
  assert.equal(hash,path===TARGET?hostingHash(assets.candidate):prev.get(path));
 assert.equal(f.calls.filter(x=>x.method==="POST"&&
  x.url.includes("/releases?versionName=")).length,1);
 assert(f.calls.every(x=>!x.url.includes("firestore")&&!x.url.includes("identitytoolkit")));
});
test("unreviewed source, live drift, concurrent release, missing assets, unknown upload fail closed",async()=>{
 const badFiles=[live().slice(1),[...live(),live()[0]],
  live().map(x=>x.path===paths.ui?{...x,hash:"f".repeat(64)}:x)];
 for(const f of badFiles)assert.throws(
  ()=>planOwnerStaffHtmlOnly({liveFiles:f,...assets}),/STOP_OWNER_STAFF_HTML_/);
 for(const key of Object.keys(assets))assert.throws(
  ()=>planOwnerStaffHtmlOnly({liveFiles:live(),...assets,[key]:assets[key]+"."}),
  /STOP_OWNER_STAFF_HTML_SOURCE_DRIFT/);
 for(const opt of [{drift:true},{concurrent:true},{configChanged:true},
  {manifestCorrupt:true},{wrongUpload:true}]){
  const f=transport(opt);
  await assert.rejects(releaseOnlyOwnerStaffHtml({...assets,request:f.request,release:true}),
   /STOP_OWNER_STAFF_(HTML|RELEASE)_/);
  assert.equal(f.calls.filter(x=>x.method==="POST"&&
   x.url.includes("/releases?versionName=")).length,0);
 }
});
test("reviewed UI retains writer off and protects all app, finance and authentication sources",()=>{
 const src=readFileSync(new URL("../tools/hosting/release-owner-staff-html-only.mjs",import.meta.url),"utf8");
 const guard=readFileSync(new URL("../tools/hosting/owner-staff-html-only-guard.mjs",import.meta.url),"utf8");
 assert.match(assets.candidate,/const HUB_OWNER_CORRECTION_READY=false/);
 assert.match(assets.candidate,/verifiedOwnerStaffCountRows/);
 assert.match(src,/SOURCE_VERSION/);
 assert.doesNotMatch(src,/firebase deploy|setDoc\(|deleteDoc\(|updateDoc\(|signInWith/);
 assert.doesNotMatch(guard,/fetch\(|firebase deploy|runTransaction\(/);
 assert.equal(assets.bootstrap,load("staging/owner-workspace-errors-v1/mobile-bootstrap.mjs"));
});
