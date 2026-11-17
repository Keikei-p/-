import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SOURCES,uploadSha} from "../tools/hosting/owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS} from "../tools/hosting/owner-only-setup-replacement-guard.mjs";
import {LIVE_CURRENT_OWNER_JS} from "../tools/hosting/owner-entry-one-file-guard.mjs";
import {releaseOwnerEntryOneFile} from "../tools/hosting/release-owner-entry-one-file.mjs";
import {historicalSources} from "./helpers/historical-builder-fixtures.mjs";

const HIST=()=>historicalSources(SOURCES);
const candidates=()=>Object.fromEntries(Object.keys(OWNER_ONLY_REPLACEMENTS).map(p=>
 [p,readFileSync(new URL("../"+p,import.meta.url),"utf8")]));
function mock(){
 const historical=HIST(),fresh=candidates();
 const root="sites/nico-factory/versions/";
 const old=root+"old",next=root+"new";
 let active=old,publishCount=0;
 const original=[
 ...["/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/owner-partner-admin.html"].map((path,i)=>({path,hash:String(i+1).repeat(64)})),
 ...Object.keys(SOURCES).map(path=>({path:"/"+path,
  hash:uploadSha(LIVE_CURRENT_OWNER_JS.includes(path)?fresh[path]:historical[path])})),
 ...Array.from({length:17},(_,i)=>({path:"/other/"+i,hash:"a".repeat(64)}))
 ];
 const configs={keepRoutes:true};
 const maps=new Map([[old,original],[next,[]]]);
 const request=async(method,url,body,type,raw)=>{
  if(method==="GET"&&url.includes("/releases?pageSize=1"))
   return {releases:[{version:{name:active}}]};
  if(method==="GET"&&url.endsWith("/"+active))
   return {name:active,status:"FINALIZED",config:configs,fileCount:33};
  if(method==="GET"&&url.endsWith("/"+next))
   return {name:next,status:"FINALIZED",config:configs,fileCount:33};
  if(method==="GET"&&url.includes("/files?")){
   const v=url.includes("/versions/old/")?old:next;
   return {files:maps.get(v)};
  }
  if(method==="POST"&&url.endsWith("/versions"))
   return {name:next,status:"CREATED"};
  if(method==="POST"&&url.endsWith(":populateFiles")){
   maps.set(next,Object.entries(body.files).map(([path,hash])=>({path,hash})));
   return {uploadRequiredHashes:[uploadSha(fresh["owner-partner-setup.html"])],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/new/"};
  }
  if(method==="POST"&&url.includes("upload-firebasehosting.googleapis.com")){
   assert.equal(type,"application/octet-stream");
   assert.equal(raw,fresh["owner-partner-setup.html"]);
   return {};
  }
  if(method==="PATCH"&&url.endsWith("?update_mask=status"))
   return {name:next,status:"FINALIZED",config:configs};
  if(method==="POST"&&url.includes("/releases?versionName=")){
   const newVersion=decodeURIComponent(url.split("versionName=")[1]);
   assert(newVersion===old||newVersion===next);
   active=newVersion;publishCount++;
   return {version:{name:active}};
  }
  throw Error("MOCK_UNKNOWN "+method+" "+url);
 };
 return {historical,fresh,request,old,next,
  state:()=>({active,publishCount,oldFiles:maps.get(old),newFiles:maps.get(next)})};
}
test("read-only inspection verifies live 3 current JS plus 8 old without posting",async()=>{
 const a=mock();let writes=0;
 const out=await releaseOwnerEntryOneFile({
  request:async(method,...args)=>{if(method!=="GET")writes++;return a.request(method,...args);},
  historicalSources:a.historical,candidateSources:a.fresh
 });
 assert.equal(out.released,false);assert.equal(out.liveAssets,33);
 assert.equal(writes,0);assert.equal(a.state().active,a.old);
});
test("one-file release keeps 32 existing immutable assets and verifies public HTML",async()=>{
 const a=mock();
 const out=await releaseOwnerEntryOneFile({
  request:a.request,historicalSources:a.historical,candidateSources:a.fresh,
  release:true,publicGet:async()=>a.fresh["owner-partner-setup.html"]
 });
 assert.equal(out.released,true);assert.equal(out.preservedAssets,32);
 assert.equal(a.state().active,a.next);assert.equal(a.state().publishCount,1);
 const old=new Map(a.state().oldFiles.map(x=>[x.path,x.hash]));
 const now=new Map(a.state().newFiles.map(x=>[x.path,x.hash]));
 for(const [p,sha] of old)
  assert.equal(sha===now.get(p),p!=="/owner-partner-setup.html",p);
});
test("one-file release restores old version if post-deploy public byte proof fails",async()=>{
 const a=mock();
 await assert.rejects(releaseOwnerEntryOneFile({
  request:a.request,historicalSources:a.historical,candidateSources:a.fresh,
  release:true,publicGet:async()=>"<html>stale</html>"
 }),/PUBLIC_OWNER_ENTRY_NOT_VERIFIED/);
 assert.equal(a.state().active,a.old);
 assert.equal(a.state().publishCount,2);
});
test("mixed or changed live Owner assets fail before any Hosting writes",async()=>{
 const a=mock();let writes=0;
 const req=async(method,...args)=>{if(method!=="GET")writes++;return a.request(method,...args);};
 const tampered={...a.fresh,"owner-partner-setup.html":"tampered"};
 await assert.rejects(releaseOwnerEntryOneFile({
  request:req,historicalSources:a.historical,candidateSources:tampered,
  release:true,publicGet:async()=>tampered["owner-partner-setup.html"]
 }),/STOP_OWNER_ENTRY_ONE_FILE_/);
 assert.equal(writes,0);
});
