import test from "node:test";
import assert from "node:assert/strict";
import {
 runOwnerOnOffHosting
} from "../tools/hosting/run-owner-onoff-exact-two-release.mjs";

const SHA="a".repeat(40);
const environment=()=>({
 GITHUB_ACTIONS:"true",
 GITHUB_REPOSITORY:"Keikei-p/-",
 GITHUB_EVENT_NAME:"push",
 GITHUB_REF:"refs/heads/main",
 GITHUB_SHA:SHA,
 NICO_ONOFF_STATIC_MAIN_SHA:SHA,
 NICO_ONOFF_STATIC_COMMIT_SUBJECT:
  "release(hosting): publish Owner ONOFF two assets only",
 FIREBASE_PROJECT_ID:"sales-management-cc116",
 GOOGLE_APPLICATION_CREDENTIALS:"/tmp/stub-account.json"
});
const secrets=()=>async()=> "stub".repeat(10);

test("no credential, GitHub context or pinned main SHA means zero network",async()=>{
 for(const altered of [
  {GITHUB_ACTIONS:"false"},{GITHUB_REF:"refs/heads/feature"},
  {FIREBASE_PROJECT_ID:"other"},
  {NICO_ONOFF_STATIC_COMMIT_SUBJECT:"bypass"}
 ]){
  const calls=[];
  await assert.rejects(runOwnerOnOffHosting({
   args:["--dry-run"],env:{...environment(),...altered},
   credentials:secrets(),
   net:async(...a)=>{calls.push(a);throw Error("NEVER_CALLED")}
  }),/STOP_OWNER_ONOFF_EXACT_TWO_/);
  assert.equal(calls.length,0);
 }
});
test("release cannot start a request with missing explicit static-only approval",async()=>{
 const calls=[];
 await assert.rejects(runOwnerOnOffHosting({
  args:["--release"],env:environment(),credentials:secrets(),
  net:async(...a)=>{calls.push(a);throw Error("NEVER_CALLED")}
 }),/EXPLICIT_RELEASE_APPROVAL/);
 assert.equal(calls.length,0);
});
test("invalid arguments and unprovided OAuth method fail without network",async()=>{
 for(const a of [[],["--publish"],["--release","--dry-run"]]){
  await assert.rejects(runOwnerOnOffHosting({
   args:a,env:environment()
  }),/STOP_OWNER_ONOFF_EXACT_TWO_ARGUMENTS/);
 }
 await assert.rejects(runOwnerOnOffHosting({
  args:["--dry-run"],env:environment()
 }),/STOP_OWNER_ONOFF_EXACT_TWO_DEPENDENCIES/);
});
test("exact main event can only make authenticated GETs for dry-run",async()=>{
 const urls=[];
 const sourcePaths=[
 "/owner-product-publication.html",
 "/ranking/owner-product-visibility-dashboard-mount.mjs",
 "/ranking/owner-product-visibility-firebase-bridge.mjs",
 "/ranking/owner-product-visibility-panel.mjs",
 "/ranking/owner-product-visibility-panel.css"
 ];
 const source=new Map();
 const {readFileSync}=await import("node:fs");
 const {hostingAssetHash}=await import("../tools/hosting/owner-product-onoff-additive-guard.mjs");
 for(const p of sourcePaths)source.set(p,readFileSync(new URL(".."+p,import.meta.url),"utf8"));
 const rows=[
  {path:"/index.html",hash:"a".repeat(64)},
  {path:"/partner-workspace.html",hash:"b".repeat(64)},
  ...sourcePaths.slice(2).map(p=>({path:p,hash:hostingAssetHash(source.get(p))}))
 ];
 const version="sites/nico-factory/versions/still_safe";
 const base="https://firebasehosting.googleapis.com/v1beta1";
 const response=object=>({ok:true,status:200,text:async()=>JSON.stringify(object)});
 const result=await runOwnerOnOffHosting({
  args:["--dry-run"],env:environment(),credentials:secrets(),
  read:()=>Object.fromEntries(source),
  net:async(url,options)=>{
   urls.push({url,options});
   assert.equal(options.method,"GET");
   assert.match(options.headers.Authorization,/^Bearer stub/);
   assert.equal(options.redirect,"error");
   if(url===base+"/sites/nico-factory/releases?pageSize=1")
    return response({releases:[{version:{name:version}}]});
   if(url===base+"/"+version)
    return response({name:version,status:"FINALIZED",fileCount:rows.length,config:{headers:[]}});
   if(url===base+"/"+version+"/files?pageSize=1000")
    return response({files:rows});
   throw Error("UNEXPECTED_READ_"+url);
  }
 });
 assert.equal(result.released,false);
 assert.deepEqual(result.newPaths,sourcePaths.slice(0,2));
 assert.equal(result.originalFilesPreserved,rows.length);
 assert(urls.length>=5);
});
