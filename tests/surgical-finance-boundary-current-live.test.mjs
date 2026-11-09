import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {ASSET,EXACT_PREVIOUS_GIT_BLOB,validateManifest,uploadReviewedFinanceMobileLogin}
 from "../tools/hosting/surgical-finance-boundary-current-live.mjs";
const original=execFileSync("git",["show",
 "2c10e27bb6a92684470c74388a76cad3d0f3ee4c:finance-boundary-check.html"],
 {maxBuffer:1024*1024});
const candidate=readFileSync(new URL("../finance-boundary-check.html",import.meta.url));
const hex=x=>createHash("sha256").update(x).digest("hex");
const hash=hex(gzipSync(original,{mtime:0}));
const fresh=hex(gzipSync(candidate,{mtime:0}));
const oldGitBlob=createHash("sha1").update("blob "+original.length+"\0").update(original).digest("hex");
const entries=["/index.html","/partner-invite.html","/partner-counts.html",
 "/partner-workspace.html","/service-worker.js","/script.js","/style.css",
 "/manifest.webmanifest","/icon-192.png","/icon-512.png","/icon-180.png",ASSET]
 .map((path,i)=>({path,hash:path===ASSET?hash:String(i).padStart(64,"a")}));
const dynamic="sites/nico-factory/versions/dynamic_manual_other_20261109";
function fake(files=entries,version=dynamic){
 const calls=[];
 return {calls,request:async(method,url,body)=>{
  calls.push({method,url,body});
  if(method!=="GET")throw Error("NO_REMOTE_WRITES_IN_DRY_RUN");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))
   return {name:version,status:"FINALIZED",config:{rewrites:[]}};
  if(url.includes("/"+version+"/files?"))return {files};
  throw Error("UNEXPECTED_GET_URL");
 }};
}
test("current Hosting version can be reviewed without trusting an obsolete version ID",async()=>{
 assert.equal(oldGitBlob,EXACT_PREVIOUS_GIT_BLOB);
 const f=fake();
 const result=await uploadReviewedFinanceMobileLogin({
  assetBytes:candidate,originalBytes:original,request:f.request,
  release:false,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.sourceName,dynamic);
 assert.equal(result.originalCount,12);
 assert.equal(f.calls.length,3);
 assert(f.calls.every(x=>x.method==="GET"&&x.body===undefined));
});
test("pin each old diagnostic source byte; do not replace any other 11 live files",()=>{
 const {original:was,next}=validateManifest(entries,new Map([[ASSET,fresh]]),12,hash);
 assert.equal(was.size,12);
 assert.equal(next.get(ASSET),fresh);
 for(const [path,before] of was)if(path!==ASSET)
  assert.equal(next.get(path),before);
});
test("malformed current version, altered old diagnostic, missing partner page, unrelated count abort before POST",async()=>{
 for(const [files,version,expected] of [
  [entries,"sites/another/versions/changed",/INVALID_SOURCE_MANIFEST|UNEXPECTED_LIVE_VERSION|UNRECOGNIZED_LIVE_RELEASE|UNRECOGNIZED_LIVE_VERSION|INVALID_LIVE_VERSION/],
  [entries.map(x=>x.path===ASSET?{...x,hash:"f".repeat(64)}:x),dynamic,/LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/],
  [entries.filter(x=>x.path!=="/partner-workspace.html"),dynamic,/LIVE_REQUIRED_ASSETS_UNVERIFIED/],
  [entries.slice(0,11),dynamic,/LIVE_REQUIRED_ASSETS_UNVERIFIED/],
 ]){
  const f=fake(files,version);
  await assert.rejects(uploadReviewedFinanceMobileLogin({
   assetBytes:candidate,originalBytes:original,request:f.request,
   release:true,log:()=>{}
  }),expected);
  assert(f.calls.every(x=>x.method==="GET"));
 }
});
test("GET-only live release gate can never touch Rules or originals",()=>{
 const wf=readFileSync(new URL("../.github/workflows/nico-finance-diagnostic-current-live-single-release.yml",import.meta.url),"utf8");
 const code=readFileSync(new URL("../tools/hosting/surgical-finance-boundary-current-live.mjs",import.meta.url),"utf8");
 assert.match(wf,/startsWith\(github\.event\.head_commit\.message, 'release: audited finance diagnostic page only/);
 assert.match(wf,/--dry-run/);
 assert.match(wf,/--release/);
 assert.match(wf,/FINANCE_DIAGNOSTIC_RELEASE_CONFIRMATION/);
 assert.match(wf,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.match(wf,/test "\$\(git hash-object index\.html\)"/);
 assert.match(code,/LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/);
 assert.match(code,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(code,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(code,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(code,/ONLY_ONE_EXISTING_DIAGNOSTIC_REPLACEMENT_ALLOWED/);
 assert.doesNotMatch(code,/firestore\.googleapis\.com|firebaserules\.googleapis\.com|firebase deploy/);
});
