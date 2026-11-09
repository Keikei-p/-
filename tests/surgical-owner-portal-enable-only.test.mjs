import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {ASSET,EXACT_PREVIOUS_GIT_BLOB,validateManifest,uploadReviewedOwnerPortalEnable}
 from "../tools/hosting/surgical-owner-portal-enable-only.mjs";
const old=execFileSync("git",["show","e9b71350e1133a96e960f2a87fbd7c4f0b228acf:staging/hub-owner-management/owner-partner-admin.html"],
 {maxBuffer:1048576});
const activated=readFileSync(new URL("../staging/hub-owner-management/owner-partner-admin-enabled.html",import.meta.url));
const blob=x=>createHash("sha1").update("blob "+x.length+"\0").update(x).digest("hex");
const hash=x=>createHash("sha256").update(gzipSync(x,{mtime:0})).digest("hex");
const hashBefore=hash(old),hashAfter=hash(activated);
const version="sites/nico-factory/versions/valid_current_20261109";
const necessary=["/index.html","/partner-workspace.html","/partner-invite.html","/partner-counts.html",
 "/finance-boundary-check.html",ASSET];
const paths=[...necessary,...Array.from({length:11},(_,i)=>"/retained-file-"+i+".js")];
const oldFiles=paths.map((path,i)=>({path,hash:path===ASSET?hashBefore:String(i).padStart(64,"a")}));
function transport(files=oldFiles){
 const calls=[];
 return {calls,request:async(method,url,payload)=>{
  calls.push({method,url,payload});
  if(method!=="GET")throw Error("NO_LIVE_WRITES_IN_DRY_RUN");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))return {name:version,status:"FINALIZED",config:{rewrites:[]}};
  if(url.includes("/"+version+"/files?"))return {files};
  throw Error("UNEXPECTED_GET");
 }};
}
test("previous live review blob is exactly original add-only portal, candidate differs by one flag",()=>{
 assert.equal(ASSET,"/owner-partner-admin.html");
 assert.equal(blob(old),EXACT_PREVIOUS_GIT_BLOB);
 assert.equal(old.toString("utf8").includes("const HUB_OWNER_CORRECTION_READY=false"),true);
 assert.equal(activated.toString("utf8"),old.toString("utf8").replace(
  "const HUB_OWNER_CORRECTION_READY=false","const HUB_OWNER_CORRECTION_READY=true"));
 assert.notEqual(hashBefore,hashAfter);
});
test("dry-run preserves all 17 current live assets and makes no POST",async()=>{
 const f=transport();
 const result=await uploadReviewedOwnerPortalEnable({
  originalBytes:old,assetBytes:activated,release:false,request:f.request,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,17);
 assert.equal(f.calls.length,3);
 assert(f.calls.every(x=>x.method==="GET"&&x.payload===undefined));
 const {original,next}=validateManifest(oldFiles,new Map([[ASSET,hashAfter]]),oldFiles.length,hashBefore);
 assert.equal(next.size,17);
 for(const [file,value] of original)if(file!==ASSET)
  assert.equal(next.get(file),value);
});
test("fail closed on a modified Owner portal, replacement of other assets, missing canonical route",async()=>{
 for(const edited of [
  Buffer.from(activated.toString("utf8").replace("HUB_OWNER_CORRECTION_READY=true","HUB_OWNER_CORRECTION_READY=false")),
  Buffer.concat([activated,Buffer.from("<!-- unrelated injection -->")]),
  Buffer.from(activated.toString("utf8").replace("mountVerifiedOwnerCorrection","unsafe"))
 ]){
  const f=transport();
  await assert.rejects(uploadReviewedOwnerPortalEnable({
   originalBytes:old,assetBytes:edited,release:true,request:f.request,log:()=>{}
  }),/OWNER_PORTAL_ONLY_ONE_REVIEWED_FLAG_CHANGE_ALLOWED|INVALID_OWNER_PORTAL_ENABLED_ASSET/);
  assert(f.calls.every(x=>x.method==="GET"));
 }
 for(const files of [
  oldFiles.filter(x=>x.path!=="/index.html"),
  oldFiles.map(x=>x.path===ASSET?{...x,hash:"f".repeat(64)}:x)
 ]){
  const f=transport(files);
  await assert.rejects(uploadReviewedOwnerPortalEnable({
   originalBytes:old,assetBytes:activated,release:true,request:f.request,log:()=>{}
  }),/LIVE_REQUIRED_ASSETS_UNVERIFIED|LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/);
  assert(f.calls.every(x=>x.method==="GET"));
 }
});
test("release workflow cannot publish without BOTH verified live Owner backends already enabled",()=>{
 const w=readFileSync(new URL("../.github/workflows/nico-owner-portal-one-page-enable.yml",import.meta.url),"utf8");
 const s=readFileSync(new URL("../tools/hosting/surgical-owner-portal-enable-only.mjs",import.meta.url),"utf8");
 assert.match(w,/startsWith\(github\.event\.head_commit\.message, 'release: owner portal one page enable 20261109'/);
 assert.match(w,/needs\.offline\.result == 'success'/);
 assert.match(w,/afterEnabled\(data\)/);
 assert.match(w,/--dry-run/);
 assert.match(w,/--release/);
 assert.match(w,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.match(w,/test "\$\(git hash-object index\.html\)"/);
 assert.match(s,/NICO_OWNER_PORTAL_ENABLE_CONFIRMATION/);
 assert.match(s,/ONLY_ONE_EXISTING_DIAGNOSTIC_REPLACEMENT_ALLOWED/);
 assert.match(s,/NON_DIAGNOSTIC_FILE_MODIFIED/);
 assert.match(s,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(s,/FINAL_ASSET_HASH_MISMATCH/);
 assert.doesNotMatch(w,/firebase deploy|--only firestore|firestore:delete|upload-artifact/);
});
