import test from "node:test";
import assert from "node:assert/strict";
import {validateManifest,uploadAdditiveInvite,ASSET} from "../tools/hosting/additive-partner-invite.mjs";

const h=s=>s.repeat(64);
const samples=[{path:"/index.html",hash:h("a")},{path:"/service-worker.js",hash:h("b")}];
test("retains each original asset exactly and adds one invite",()=>{
 const {original,next}=validateManifest(samples,new Map([[ASSET,h("c")]]),2);
 assert.equal(original.size,2);assert.equal(next.size,3);
 assert.equal(next.get("/index.html"),h("a"));
 assert.equal(next.get("/service-worker.js"),h("b"));
 assert.equal(next.get(ASSET),h("c"));
});
test("rejects existing invite, missing index, bad count or duplicate source",()=>{
 assert.throws(()=>validateManifest(samples,new Map([[ASSET,h("c")]]),3),/SOURCE_FILE_COUNT/);
 assert.throws(()=>validateManifest([samples[1]],new Map([[ASSET,h("c")]]),1),/LIVE_INDEX/);
 assert.throws(()=>validateManifest([...samples,{path:ASSET,hash:h("d")}],new Map([[ASSET,h("c")]]),3),/EXISTING_PARTNER/);
 assert.throws(()=>validateManifest([samples[0],samples[0]],new Map([[ASSET,h("c")]]),2),/INVALID_SOURCE/);
 assert.throws(()=>validateManifest(samples,new Map([[ASSET,h("c")],["/index.html",h("d")]]),2),/ONLY_ONE/);
});
function mock({mutateLive=false,missingOldBlob=false,configMismatch=false}={}){
 const seen=[];
 let current="sites/nico-factory/versions/111",releaseCount=0;
 const base="https://firebasehosting.googleapis.com/v1beta1";
 const cfg={rewrites:[{glob:"**",destination:"/index.html"}],headers:[{glob:"**",headers:{"cache-control":"no-cache"}}]};
 const request=async(method,url,body)=>{
  seen.push({method,url,body});
  const suffix=url.slice(base.length);
  if(method==="GET"&&suffix==="/sites/nico-factory/releases?pageSize=1"){
   releaseCount++;
   if(mutateLive&&releaseCount>=2)current="sites/nico-factory/versions/999";
   return {releases:[{version:{name:current}}]};
  }
  if(method==="GET"&&suffix==="/sites/nico-factory/versions/111")
   return {name:current,status:"FINALIZED",fileCount:"2",config:cfg};
  if(method==="GET"&&suffix.startsWith("/sites/nico-factory/versions/111/files?"))
   return {files:samples};
  if(method==="POST"&&suffix==="/sites/nico-factory/versions")
   return {name:"sites/nico-factory/versions/222",status:"CREATED"};
  if(method==="POST"&&suffix==="/sites/nico-factory/versions/222:populateFiles")
   return {uploadRequiredHashes:missingOldBlob?[h("a")]:[],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/222/files"};
  if(method==="PATCH"&&suffix.startsWith("/sites/nico-factory/versions/222?"))
   return {name:"sites/nico-factory/versions/222",status:"FINALIZED",fileCount:"3",config:configMismatch?{}:cfg};
  if(method==="POST"&&suffix.startsWith("/sites/nico-factory/releases?"))
   return {name:"sites/nico-factory/releases/777",version:{name:"sites/nico-factory/versions/222"}};
  throw Error("UNMOCKED "+method+" "+url);
 };
 return {request,seen};
}
const asset=Buffer.from("createPartnerCompanyInvitation acceptPartnerCompanyInvitation ".repeat(15));
test("dry-run calls only read endpoints and returns no release",async()=>{
 const x=mock(),r=await uploadAdditiveInvite({assetBytes:asset,request:x.request,log:()=>{}});
 assert.equal(r.released,false);assert.equal(r.originalCount,2);
 assert.ok(x.seen.every(v=>v.method==="GET"));
});
test("additive release cannot mutate original hashes or config",async()=>{
 const x=mock(),r=await uploadAdditiveInvite({assetBytes:asset,request:x.request,release:true,log:()=>{}});
 assert.equal(r.released,true);
 const populate=x.seen.find(x=>x.url.includes(":populateFiles"));
 assert.equal(populate.body.files["/index.html"],h("a"));
 assert.equal(populate.body.files["/service-worker.js"],h("b"));
 assert.ok(typeof populate.body.files[ASSET]==="string");
 assert.equal(x.seen.filter(x=>x.url.includes("/releases?versionName")).length,1);
});
test("fail-closed when existing blobs unavailable or config changes",async()=>{
 for(const flags of [{missingOldBlob:true},{configMismatch:true}]){
  const x=mock(flags);
  await assert.rejects(uploadAdditiveInvite({assetBytes:asset,request:x.request,release:true,log:()=>{}}),/OLD_LIVE_BLOB|CONFIG_CHANGED/);
  assert.ok(!x.seen.some(v=>v.url.includes("/releases?versionName")));
 }
});
test("fail-closed on a concurrent live version change",async()=>{
 const x=mock({mutateLive:true});
 await assert.rejects(uploadAdditiveInvite({assetBytes:asset,request:x.request,release:true,log:()=>{}}),/LIVE_CHANGED/);
 assert.ok(!x.seen.some(v=>v.url.includes("/releases?versionName")));
});
