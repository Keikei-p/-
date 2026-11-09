import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {inspectLiveOwnerPortal,reviewedLocalAssets}
 from "../tools/production/inspect-owner-portal-hosting-readonly.mjs";

const root=path.resolve(fileURLToPath(new URL("../",import.meta.url)));
const {previous,candidate}=reviewedLocalAssets(root);
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const V="sites/nico-factory/versions/reviewed_old";
const sha=x=>createHash("sha256").update(gzipSync(Buffer.from(x),{mtime:0})).digest("hex");
const files=()=>{
 const paths=[
  "/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/finance-boundary-check.html",
  "/script.js","/style.css","/service-worker.js"
 ];
 const f=paths.map((p,i)=>({path:p,hash:String(i+1).repeat(64)}));
 for(const [key,p] of Object.entries({
  html:"/owner-partner-admin.html",
  bootstrap:"/owner-partner-admin-assets/mobile-bootstrap.mjs",
  client:"/owner-partner-admin-assets/owner-client.mjs",
  ui:"/owner-partner-admin-assets/owner-ui.mjs"
 }))f.push({path:p,hash:sha(previous[key])});
 return f;
};
function fixture({liveFiles=files(),concurrent=false,invalidMeta=false,unavailable=false}={}){
 const calls=[];let releases=0;
 const request=async(method,url)=>{
  calls.push({method,url});
  if(method!=="GET")throw Error("WRITES_FORBIDDEN");
  if(url===BASE+"/sites/nico-factory/releases?pageSize=1"){
   if(unavailable)return {releases:[]};
   releases++;
   return {releases:[{version:{name:concurrent&&releases>1?
    "sites/nico-factory/versions/other":V}}]};
  }
  if(url===BASE+"/"+V)return {name:V,status:invalidMeta?"CREATED":"FINALIZED",
   config:{rewrites:[{source:"**",destination:"/index.html"}]},fileCount:liveFiles.length};
  if(url===BASE+"/"+V+"/files?pageSize=1000")return {files:liveFiles};
  throw Error("UNKNOWN_GET_URL");
 };
 return {request,calls};
}
test("reads only official Hosting version metadata and full manifest, with no writes",async()=>{
 const f=fixture();
 const result=await inspectLiveOwnerPortal({request:f.request,previous,candidate});
 assert.deepEqual(result.proposedPaths,[
  "/owner-partner-admin-assets/mobile-bootstrap.mjs",
  "/owner-partner-admin.html"
 ].sort());
 assert.equal(result.verified,"HOSTING_MANIFEST_MATCHES_REVIEWED_OLD_PORTAL");
 assert.equal(result.releaseApproved,false);
 assert.equal(result.modifiedLiveFiles,0);
 assert.equal(result.filesInspected,files().length);
 assert.equal(result.proposedReplacementCount,2);
 assert.equal(f.calls.length,4);
 assert(f.calls.every(x=>x.method==="GET"&&x.url.startsWith(BASE+"/sites/nico-factory/")));
});
test("concurrent deployment, incomplete live version and missing release safely refuse",async()=>{
 for(const f of [fixture({concurrent:true}),fixture({invalidMeta:true}),fixture({unavailable:true})]){
  await assert.rejects(inspectLiveOwnerPortal({
   request:f.request,previous,candidate
  }),/STOP_OWNER_PORTAL_LIVE_READONLY_/);
  assert(f.calls.every(x=>x.method==="GET"));
 }
});
test("a changed or absent old Hosting asset is NOT silently replaced",async()=>{
 for(const altered of [
  files().map(x=>x.path==="/owner-partner-admin.html"?{...x,hash:"f".repeat(64)}:x),
  files().filter(x=>x.path!=="/owner-partner-admin-assets/owner-ui.mjs"),
  files().concat(files()[0])
 ]){
  const f=fixture({liveFiles:altered});
  await assert.rejects(inspectLiveOwnerPortal({
   request:f.request,previous,candidate
  }),/STOP_OWNER_PORTAL_TWO_ASSETS_/);
  assert(f.calls.every(x=>x.method==="GET"));
 }
});
test("strict runner source review and no production-write code in live read-only audit",()=>{
 const src=readFileSync(new URL("../tools/production/inspect-owner-portal-hosting-readonly.mjs",import.meta.url),"utf8");
 assert.match(src,/method!=="GET"/);
 assert.match(src,/GITHUB_REF!=="refs\/heads\/main"/);
 assert.match(src,/releaseApproved:false/);
 assert.doesNotMatch(src,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|:populateFiles|method:"POST"|method:"PATCH"/);
 assert.equal(candidate.client,previous.client);
 assert.equal(candidate.ui,previous.ui);
});
