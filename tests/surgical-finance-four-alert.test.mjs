test("new warning must be the EXACT review candidate, not unreviewed PR HTML",async()=>{
 let called=0;
 const request=async()=>{called++;throw Error("MUST_NOT_NETWORK");};
 assert.ok(next.toString("utf8").includes('role!=="owner"&&anyMoneyReadable'));
 await assert.rejects(uploadWarningFinanceFourProof({
  assetBytes:Buffer.from(next.toString("utf8").replace('role!=="owner"&&anyMoneyReadable',
   'role==="partner-verified"&&anyMoneyReadable')),
  originalBytes:old,request,release:true
 }),/INVALID_READ_ONLY_DIAGNOSTIC_ASSET/);
 assert.equal(called,0);
});
test("session-safe HTML must be the EXACT candidate, never supplied by user/PR inputs",async()=>{
 const fakeGet=async()=>{throw Error("MUST_NOT_NETWORK");};
 assert.ok(next.toString("utf8").includes("STALE_AUTH_PROBE"));
 await assert.rejects(uploadWarningFinanceFourProof({
  assetBytes:Buffer.from(next.toString("utf8").replace("STALE_AUTH_PROBE","OLD_PROBE")),
  originalBytes:old,request:fakeGet,release:true
 }),/INVALID_READ_ONLY_DIAGNOSTIC_ASSET/);
});
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {financeAlertFour} from "../staging/finance-diagnostic-v5/build-finance-alert.mjs";
import {sessionSafeFour} from "../staging/finance-diagnostic-v4/build-session-safe.mjs";
import {
 ASSET,EXACT_PREVIOUS_VERSION,validateManifest,uploadWarningFinanceFourProof
} from "../tools/hosting/surgical-finance-four-alert.mjs";

const old=Buffer.from(sessionSafeFour(),"utf8");
const next=Buffer.from(financeAlertFour(),"utf8");
const hash=b=>createHash("sha256").update(gzipSync(b,{mtime:0})).digest("hex");
const oldHash=hash(old),nextHash=hash(next);
const paths=[
 "/index.html","/partner-invite.html","/partner-counts.html",
 "/partner-workspace.html","/finance-boundary-check.html",
 "/service-worker.js","/script.js","/style.css",
 "/manifest.webmanifest","/icon-192.png","/icon-512.png",
 "/icon-180.png",ASSET
];
const files=()=>paths.map((p,i)=>({path:p,
 hash:p===ASSET?oldHash:String(i).padStart(64,"a")}));
const fake=(docs=files(),version=EXACT_PREVIOUS_VERSION)=>{
 const calls=[];
 const request=async(method,url,body)=>{
  calls.push({method,url,body});
  if(method!=="GET")throw Error("NO_TEST_REMOTE_WRITES");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))
   return {name:version,status:"FINALIZED",config:{rewrites:[]},fileCount:docs.length};
  if(url.includes("/"+version+"/files?"))return {files:docs};
  throw Error("UNEXPECTED_HOSTING_ENDPOINT");
 };
 return {request,calls};
};
test("live strict four-collection page is exact and all original routes are untouched",()=>{
 assert.equal(ASSET,"/finance-boundary-four.html");
 assert.equal(EXACT_PREVIOUS_VERSION,"sites/nico-factory/versions/3802c1bbf38dd8a5");
 assert.equal(files().length,13);
 assert.notEqual(oldHash,nextHash);
 const result=validateManifest(files(),new Map([[ASSET,nextHash]]),13,oldHash);
 assert.equal(result.next.size,13);
 assert.equal(result.next.get(ASSET),nextHash);
 for(const f of files())if(f.path!==ASSET)
  assert.equal(result.next.get(f.path),f.hash,f.path);
 assert.throws(()=>validateManifest(files(),new Map([[ASSET,oldHash]]),13,oldHash),
  /DIAGNOSTIC_UNCHANGED/);
 assert.throws(()=>validateManifest(files(),new Map([["/index.html",nextHash]]),13,oldHash),
  /ONLY_ONE_EXISTING_DIAGNOSTIC_REPLACEMENT_ALLOWED/);
});
test("Hosting dry-run is read-only and pins last actually released version",async()=>{
 const f=fake();
 const result=await uploadWarningFinanceFourProof({
  assetBytes:next,originalBytes:old,request:f.request,release:false,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,13);
 assert.equal(result.sourceName,EXACT_PREVIOUS_VERSION);
 assert.equal(f.calls.length,3);
 assert.ok(f.calls.every(x=>x.method==="GET"&&x.body===undefined));
});
test("any unknown version, previous asset or missing old route stops BEFORE write",async()=>{
 const changedVersion=fake(files(),"sites/nico-factory/versions/unknown");
 await assert.rejects(uploadWarningFinanceFourProof({
  assetBytes:next,originalBytes:old,request:changedVersion.request,
  release:true,log:()=>{}
 }),/UNREVIEWED_LIVE_VERSION/);
 assert.equal(changedVersion.calls.length,1);
 const changedHash=fake(files().map(x=>x.path===ASSET?{...x,hash:"f".repeat(64)}:x));
 await assert.rejects(uploadWarningFinanceFourProof({
  assetBytes:next,originalBytes:old,request:changedHash.request,
  release:true,log:()=>{}
 }),/LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/);
 assert.ok(changedHash.calls.every(x=>x.method==="GET"));
 const missing=fake(files().filter(x=>x.path!=="/finance-boundary-check.html"));
 await assert.rejects(uploadWarningFinanceFourProof({
  assetBytes:next,originalBytes:old,request:missing.request,
  release:true,log:()=>{}
 }),/LIVE_REQUIRED_ASSETS_UNVERIFIED/);
 assert.ok(missing.calls.every(x=>x.method==="GET"));
});
test("unknown source, unreviewed HTML or money writes are refused without network",async()=>{
 let calls=0;
 const request=async()=>{calls++;throw Error("UNEXPECTED_NETWORK");};
 for(const scenario of [
  {assetBytes:next,originalBytes:Buffer.from("altered"),request,release:true},
  {assetBytes:Buffer.from(old),originalBytes:old,request,release:true},
  {assetBytes:Buffer.concat([next,Buffer.from("setDoc(x)\\n")]),
   originalBytes:old,request,release:true}
 ])await assert.rejects(uploadWarningFinanceFourProof(scenario));
 assert.equal(calls,0);
});
test("strict publisher never writes Firestore, Rules, Functions, Auth or original app HTML",()=>{
 const code=readFileSync(new URL(
  "../tools/hosting/surgical-finance-four-alert.mjs",import.meta.url),"utf8");
 assert.match(code,/NICO_FINANCE_WARNING_RELEASE_CONFIRMATION/);
 assert.match(code,/CONFIRM_REPLACE_FINANCE_WARNING_ONLY/);
 assert.match(code,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(code,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(code,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(code,/NON_DIAGNOSTIC_FILE_MODIFIED/);
 assert.match(code,/sessionSafeFour\(\)/);
 assert.match(code,/financeAlertFour\(\)/);
 assert.doesNotMatch(code,/firebase deploy|firestore\.googleapis\.com|functions:deploy|firebaserules\.googleapis\.com/);
});
