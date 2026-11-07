import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {makeCandidate,originalSource,gitBlob,ORIGINAL_BLOB} from
 "../staging/finance-diagnostic-v2/build-candidate.mjs";
import {validateManifest,uploadAdditiveFinanceBoundaryFour,ASSET} from
 "../tools/hosting/additive-finance-four-proof.mjs";

const html=makeCandidate(originalSource()),asset=Buffer.from(html,"utf8");
const knownRoutes=[
 "/index.html","/partner-invite.html","/partner-counts.html",
 "/partner-workspace.html","/finance-boundary-check.html",
 "/service-worker.js","/script.js","/style.css","/manifest.webmanifest",
 "/icon-192.png","/icon-512.png"
];
const original=()=>knownRoutes.map((path,i)=>({path,
 hash:Buffer.from("same-live-hash-"+i).toString("hex").padEnd(64,"0").slice(0,64)}));
const hash="f".repeat(64);
const VERSION="sites/nico-factory/versions/reviewed11";
test("source, original 2-collection diagnostic, Rules and sales app remain unchanged",()=>{
 assert.equal(gitBlob(originalSource()),ORIGINAL_BLOB);
 assert.equal(ASSET,"/finance-boundary-four.html");
 assert.ok(!knownRoutes.includes(ASSET));
 const path=readFileSync(new URL("../tools/hosting/additive-finance-four-proof.mjs",import.meta.url),"utf8");
 assert.match(path,/makeCandidate\(originalSource\(\)\)/);
 assert.match(path,/FINANCE_COLLECTIONS=Object\.freeze/);
 assert.match(path,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(path,/ORIGINAL_FILE_MODIFIED/);
 assert.match(path,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(path,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(path,/EXISTING_DIAGNOSTIC_PATH/);
 assert.match(path,/NICO_FINANCE_FOUR_RELEASE_CONFIRMATION/);
 assert.match(path,/CONFIRM_ADD_FINANCE_FOUR_ONLY/);
 assert.doesNotMatch(path,/firebase deploy|firestore\.googleapis\.com|functions:deploy|firebase\.auth/);
 const source=readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8");
 assert.notEqual(html,source);
 for(const key of ["products","records","recordCorrections","revenueGoals"])
  assert.match(html,new RegExp('id="'+key+'">未確認'));
 assert.match(html,/LIST拒否・GET未検証（合格ではない）/);
 assert.match(html,/getIdToken\(true\)/);
 assert.match(html,/mask\.fieldPaths/);
 assert.doesNotMatch(html,/setDoc\(|deleteDoc\(|updateDoc\(|writeBatch\(/);
});
test("new route is the ONLY new file and preserves every earlier live file/hash",()=>{
 const before=original();
 const out=validateManifest(before,new Map([[ASSET,hash]]),before.length);
 assert.equal(out.original.size,before.length);
 assert.equal(out.next.size,before.length+1);
 for(const row of before)assert.equal(out.next.get(row.path),row.hash);
 assert.equal(out.next.get(ASSET),hash);
 assert.throws(()=>validateManifest([...before,{path:ASSET,hash}],
  new Map([[ASSET,hash]]),before.length+1),/EXISTING_DIAGNOSTIC_PATH/);
 assert.throws(()=>validateManifest(before,new Map([["/index.html",hash]]),before.length));
 assert.throws(()=>validateManifest(before,new Map([[ASSET,hash]]),before.length+1));
 assert.throws(()=>validateManifest([...before,before[0]],new Map([[ASSET,hash]]),before.length+1));
});
test("preview performs GET only, without any Hosting writes or live data operations",async()=>{
 const calls=[];
 const request=async(method,url,body)=>{
  calls.push({method,url,body});
  if(url.endsWith("/releases?pageSize=1"))return {releases:[{version:{name:VERSION}}]};
  if(url.endsWith("/"+VERSION))return {name:VERSION,status:"FINALIZED",config:{rewrites:[]}};
  if(url.includes("/"+VERSION+"/files?"))return {files:original()};
  throw Error("UNEXPECTED_API");
 };
 const result=await uploadAdditiveFinanceBoundaryFour({
  assetBytes:asset,request,release:false,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,original().length);
 assert.ok(calls.length>=3);
 assert.ok(calls.every(x=>x.method==="GET"&&x.body===undefined));
});
test("missing original diagnostic or existing new route aborts BEFORE any write",async()=>{
 const requestFor=files=>async(method,url)=>{
  assert.equal(method,"GET");
  if(url.endsWith("/releases?pageSize=1"))return {releases:[{version:{name:VERSION}}]};
  if(url.endsWith("/"+VERSION))return {
   name:VERSION,status:"FINALIZED",config:{},fileCount:files.length
  };
  if(url.includes("/"+VERSION+"/files?"))return {files};
  throw Error("UNEXPECTED_WRITE");
 };
 await assert.rejects(uploadAdditiveFinanceBoundaryFour({
  assetBytes:asset,request:requestFor(original().filter(x=>x.path!=="/finance-boundary-check.html")),
  release:true,log:()=>{}
 }),/LIVE_REQUIRED_ASSETS_UNVERIFIED/);
 await assert.rejects(uploadAdditiveFinanceBoundaryFour({
  assetBytes:asset,request:requestFor([...original(),{path:ASSET,hash}]),
  release:true,log:()=>{}
 }),/EXISTING_DIAGNOSTIC_PATH/);
});
test("any added financial or count WRITE command is rejected at asset-level",async()=>{
 const forbidden=Buffer.concat([asset,Buffer.from("\nsetDoc(anything);\n")]);
 let calls=0;
 await assert.rejects(uploadAdditiveFinanceBoundaryFour({
  assetBytes:forbidden,request:async()=>{calls++;throw Error("SHOULD_NOT_CONNECT");},
  release:true
 }),/INVALID_READ_ONLY_DIAGNOSTIC_ASSET/);
 assert.equal(calls,0);
 assert.match(createHash("sha256").update(asset).digest("hex"),/^[a-f0-9]{64}$/);
});