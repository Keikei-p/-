import test from "node:test";
import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {releaseExactlyTwoOwnerAssets} from "../tools/hosting/release-owner-portal-exact-two.mjs";
import {reviewedLocalAssets} from "../tools/production/inspect-owner-portal-hosting-readonly.mjs";

const root=new URL("../",import.meta.url);
const {previous,candidate}=reviewedLocalAssets(new URL(root).pathname);
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const L="sites/nico-factory/versions/live_old";
const N="sites/nico-factory/versions/created_new";
const currentPath="/sites/nico-factory/releases?pageSize=1";
const hash=x=>createHash("sha256").update(gzipSync(Buffer.from(x),{mtime:0})).digest("hex");
function fixture({drift=false,concurrent=false,unknownUpload=false,alterConfig=false,finalCorrupt=false}={}){
 const canonical=[
  "/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/finance-boundary-check.html",
  "/script.js","/style.css","/service-worker.js","/manifest.json",
  "/service-worker-static.js","/legacy.html","/app-shell.html","/help.html"
 ];
 const old=[...canonical.map((p,i)=>({path:p,hash:String((i%9)+1).repeat(64)})),
  ...Object.entries({
   html:"/owner-partner-admin.html",
   bootstrap:"/owner-partner-admin-assets/mobile-bootstrap.mjs",
   client:"/owner-partner-admin-assets/owner-client.mjs",
   ui:"/owner-partner-admin-assets/owner-ui.mjs"
  }).map(([k,path])=>({path,hash:hash(previous[k])}))];
 if(drift)old.find(x=>x.path==="/owner-partner-admin.html").hash="f".repeat(64);
 let live=L,news=[],created=false,finalized=false,uploads=[],reads=0,config={headers:[{source:"**",headers:[{key:"Cache-Control",value:"no-cache"}]}]};
 const history=[];
 const request=async(method,url,body=null,type="application/json")=>{
  history.push({method,url,body:body&&type==="application/octet-stream"?"binary":body});
  if(url===BASE+currentPath&&method==="GET"){
   reads++;
   if(concurrent&&reads>2)live="sites/nico-factory/versions/elsewhere";
   return {releases:[{version:{name:live}}]};
  }
  if(url===BASE+"/"+L&&method==="GET")return {name:L,status:"FINALIZED",config,fileCount:old.length};
  if(url===BASE+"/"+L+"/files?pageSize=1000"&&method==="GET")return {files:old};
  if(url===BASE+"/sites/nico-factory/versions"&&method==="POST"){
   assert(!created);created=true;return {name:N,status:"CREATED"};
  }
  if(url===BASE+"/"+N+":populateFiles"&&method==="POST"){
   assert(created); news=Object.entries(body.files).map(([path,hash])=>({path,hash}));
   const newHashes=new Set([hash(candidate.html),hash(candidate.bootstrap)]);
   return {uploadRequiredHashes:unknownUpload?["f".repeat(64)]:[...newHashes],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/created_new/files"};
  }
  if(url.startsWith("https://upload-firebasehosting.googleapis.com/upload/")&&method==="POST"){
   assert.equal(type,"application/octet-stream");
   uploads.push(url);return {};
  }
  if(url===BASE+"/"+N+"?update_mask=status"&&method==="PATCH"){
   finalized=true;return {name:N,status:"FINALIZED",config:alterConfig?{rewrites:[]}:config};
  }
  if(url===BASE+"/"+N+"/files?pageSize=1000"&&method==="GET")
   return {files:finalCorrupt?news.slice(1):news};
  if(url===BASE+"/"+N&&method==="GET")return {name:N,status:finalized?"FINALIZED":"CREATED",config};
  if(url===BASE+"/sites/nico-factory/releases?versionName="+encodeURIComponent(N)&&method==="POST"){
   assert(finalized);
   live=N;return {version:{name:N}};
  }
  throw Error("UNKNOWN_REQUEST "+method+" "+url);
 };
 return {request,history,old,get state(){return {live,uploads,created}}};
}
test("first preflight is GET-only and verifies 17 pinned original files",async()=>{
 const f=fixture();
 const r=await releaseExactlyTwoOwnerAssets({request:f.request,previous,candidate,release:false});
 assert.equal(r.released,false);
 assert.equal(r.liveCount,17);
 assert.equal(r.unmodified,15);
 assert.equal(r.changedPaths.length,2);
 assert.equal(f.state.created,false);
 assert(f.history.every(x=>x.method==="GET"));
});
test("approved run publishes ONLY two new hashed asset contents and preserves 15 original hashes",async()=>{
 const f=fixture();const outputs=[];
 const r=await releaseExactlyTwoOwnerAssets({request:f.request,previous,candidate,release:true,log:x=>outputs.push(x)});
 assert.equal(r.released,true);
 assert.equal(r.productionDataWrites,0);
 assert.equal(r.unmodified,15);
 assert.equal(r.activatedVersion,N);
 assert.equal(f.state.live,N);
 assert.equal(f.state.uploads.length,2);
 assert.equal(f.history.filter(x=>x.method==="POST"&&x.url.startsWith(BASE+"/sites/nico-factory/releases")).length,1);
 assert(f.history.every(x=>!x.url.includes("firestore")&&!x.url.includes("functions")&&!x.url.includes("identitytoolkit")));
 const populate=f.history.find(x=>x.url.endsWith(":populateFiles"));
 const oldMap=new Map(f.old.map(x=>[x.path,x.hash]));
 for(const [p,h] of Object.entries(populate.body.files)){
  if(p==="/owner-partner-admin.html")assert.equal(h,hash(candidate.html));
  else if(p==="/owner-partner-admin-assets/mobile-bootstrap.mjs")assert.equal(h,hash(candidate.bootstrap));
  else assert.equal(h,oldMap.get(p),p);
 }
 assert(outputs.some(x=>x.startsWith("OWNER_EXACT_TWO_RELEASED")));
});
test("drift and unknown upload abort before any live activation",async()=>{
 for(const opts of [{drift:true},{unknownUpload:true},{alterConfig:true},{finalCorrupt:true},{concurrent:true}]){
  const f=fixture(opts);
  await assert.rejects(releaseExactlyTwoOwnerAssets({request:f.request,previous,candidate,release:true}),
   /STOP_OWNER_PORTAL_(EXACT_TWO|TWO_ASSETS)_/);
  assert.equal(f.history.filter(x=>x.method==="POST"&&x.url.startsWith(BASE+"/sites/nico-factory/releases")).length,0);
 }
});
test("stale/mutated local source stopped before any write",async()=>{
 const f=fixture();
 await assert.rejects(releaseExactlyTwoOwnerAssets({
  request:f.request,previous:{...previous,html:previous.html+"."},candidate,release:true
 }),/STOP_OWNER_PORTAL_TWO_ASSETS_/);
 assert(f.history.every(x=>x.method==="GET"));
});
test("no broad hosting deploy, existing pinned assets and financial writes are available",()=>{
 const source=readFileSync(new URL("../tools/hosting/release-owner-portal-exact-two.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/firebase deploy|deleteDoc\(|setDoc\(|updateDoc\(|writeBatch\(|DELETE|\/documents\//);
 assert.match(source,/NO|unmodified/);
 assert.equal(previous.client,candidate.client);
 assert.equal(previous.ui,candidate.ui);
});
