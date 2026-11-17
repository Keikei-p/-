import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 ASSET,planSingleOwnerSetupMountRelease,runSurgicalOwnerSetupMountRelease
} from "../tools/hosting/release-owner-sku-setup-mount-surgical.mjs";
import {uploadSha}
 from "../tools/hosting/owner-setup-additive-guard.mjs";
const oldText=["prior-published-owner-panel","reviewed-main-owner-panel","current-live-owner-panel"];
const oldHashes=oldText.map(uploadSha);
const newText=readFileSync(new URL("../ranking/owner-partner-setup-mount.mjs",import.meta.url),"utf8");
const indexText=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const newHash=uploadSha(newText),indexHash=uploadSha(indexText);
const blob=(path,hash)=>({path,hash});
function manifest(hash=oldHashes[2]){
 const files=[
  blob("/index.html",indexHash),
  blob("/partner-workspace.html","0".repeat(64)),
  blob("/partner-counts.html","1".repeat(64)),
  blob("/partner-invite.html","2".repeat(64)),
  blob("/owner-partner-setup.html","3".repeat(64)),
  blob(ASSET,hash)
 ];
 for(let n=0;n<27;n++)files.push(blob("/other"+n+".js",n.toString(16).padStart(64,"0")));
 return files;
}
test("one validated module replacement keeps every other live path and hash",()=>{
 const files=manifest();
 const result=planSingleOwnerSetupMountRelease({files,oldHashes,newHash,indexHash});
 assert.equal(result.already,false);
 assert.equal(result.oldCount,33);
 assert.equal(result.next.size,33);
 assert.equal(result.next.get(ASSET),newHash);
 for(const f of files)if(f.path!==ASSET)
  assert.equal(result.next.get(f.path),f.hash.toLowerCase());
});
test("the live new version is idempotent, never attempts second release",()=>{
 const result=planSingleOwnerSetupMountRelease({
  files:manifest(newHash),oldHashes,newHash,indexHash
 });
 assert.equal(result.already,true);
});
test("unreviewed new live module, different index, missing canonical or duplicate paths stop",()=>{
 const make=files=>planSingleOwnerSetupMountRelease({files,oldHashes,newHash,indexHash});
 assert.throws(()=>make(manifest("e".repeat(64))),/UNREVIEWED_OLD_PANEL_HASH/);
 const changedIndex=manifest();changedIndex[0].hash="a".repeat(64);
 assert.throws(()=>make(changedIndex),/EXISTING_SALES_APP_INDEX_CHANGED/);
 const missing=manifest().filter(p=>p.path!==ASSET);
 assert.throws(()=>make(missing),/REQUIRED_HOSTING_FILE_MISSING/);
 const duplicate=manifest();duplicate[10].path=ASSET;
 assert.throws(()=>make(duplicate),/INVALID_HOSTING_MANIFEST/);
});
function server(){
 const oldVersion="sites/nico-factory/versions/b28e28c80da7aab9";
 const newVersion="sites/nico-factory/versions/testing123";
 const config={headers:[{source:"**",headers:[{key:"X-Test",value:"safe"}]}]};
 const original=manifest(),updated=manifest();
 updated.find(x=>x.path===ASSET).hash=newHash;
 let released=oldVersion;const calls=[];
 const request=async(method,url,body=null,kind)=>{
  calls.push({method,url,body,kind});
  if(method==="GET"&&url.endsWith("/releases?pageSize=1"))
   return {releases:[{version:{name:released}}]};
  if(method==="GET"&&url.endsWith(oldVersion))
   return {name:oldVersion,status:"FINALIZED",config,fileCount:33};
  if(method==="GET"&&url.endsWith(newVersion))
   return {name:newVersion,status:"FINALIZED",config,fileCount:33};
  if(method==="GET"&&url.includes(oldVersion+"/files?"))
   return {files:original};
  if(method==="GET"&&url.includes(newVersion+"/files?"))
   return {files:updated};
  if(method==="POST"&&url.endsWith("/sites/nico-factory/versions"))
   return {name:newVersion,status:"CREATED"};
  if(method==="POST"&&url.endsWith(newVersion+":populateFiles")){
   assert.equal(Object.keys(body.files).length,33);
   assert.equal(body.files[ASSET],newHash);
   return {uploadRequiredHashes:[newHash],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/testing123/files"};
  }
  if(method==="POST"&&url.includes("upload-firebasehosting.googleapis.com"))return {};
  if(method==="PATCH"&&url.includes("update_mask=status"))
   return {name:newVersion,status:"FINALIZED",config};
  if(method==="POST"&&url.includes("/releases?versionName=")){
   released=newVersion;return {version:{name:newVersion}};
  }
  throw Error("UNEXPECTED_TEST_HTTP "+method+" "+url);
 };
 return {request,calls};
}
test("dry-run inspects exact live hash without POST/PATCH",async()=>{
 const s=server();
 const result=await runSurgicalOwnerSetupMountRelease({
  request:s.request,oldText,newText,indexText,release:false
 });
 assert.equal(result.released,false);
 assert.equal(s.calls.some(x=>x.method!=="GET"),false);
});
test("approved release replaces one file with full manifest copied, not Rules or Functions",async()=>{
 const s=server();
 const result=await runSurgicalOwnerSetupMountRelease({
  request:s.request,oldText,newText,indexText,release:true
 });
 assert.equal(result.released,true);
 const writes=s.calls.filter(x=>x.method!=="GET");
 assert(writes.some(x=>x.url.includes(":populateFiles")));
 assert(writes.some(x=>x.url.includes("/releases?versionName=")));
 assert(writes.every(x=>x.url.includes("firebasehosting.googleapis.com")||
   x.url.includes("upload-firebasehosting.googleapis.com")));
 assert.equal(writes.filter(x=>x.url.includes("/upload/sites")).length,1);
});
