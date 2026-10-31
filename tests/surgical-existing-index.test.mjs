import test from "node:test";
import assert from "node:assert/strict";
import {validateManifest,uploadSingleExistingIndex} from "../tools/hosting/surgical-existing-index.mjs";
const hash=c=>String(c).repeat(64);
const originals=[
  {path:"/index.html",hash:hash("a")},
  {path:"/partner-invite.html",hash:hash("b")},
  {path:"/partner-counts.html",hash:hash("c")},
  {path:"/partner-workspace.html",hash:hash("d")}
];
test("only existing index is replaced; all other live files and hashes retained",()=>{
 const {original,next}=validateManifest(originals,new Map([["/index.html",hash("e")]]),4);
 assert.equal(next.size,original.size);
 assert.equal(next.get("/index.html"),hash("e"));
 for(const [path,sha] of original)if(path!=="/index.html")assert.equal(next.get(path),sha);
 assert.equal(next.get("/partner-workspace.html"),hash("d"));
});
test("stop when index is missing, unchanged, count unexpected or additive path attempted",()=>{
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("a")]]),4),/NO_INDEX_CHANGE/);
 assert.throws(()=>validateManifest(originals.slice(1),new Map([["/index.html",hash("e")]]),3),/LIVE_INDEX_MISSING/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")]]),3),/SOURCE_FILE_COUNT_MISMATCH/);
 assert.throws(()=>validateManifest(originals,new Map([["/foo.html",hash("e")]]),4),/ONLY_ONE_REPLACED_INDEX_ALLOWED/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")],["/partner-counts.html",hash("f")]]),4),/ONLY_ONE_REPLACED_INDEX_ALLOWED/);
});

function live(version="sites/nico-factory/versions/b6ab2b826667954d",omitCount=true,missing=false) {
 const paths=["/index.html","/partner-invite.html","/partner-counts.html","/partner-workspace.html",
  "/service-worker.js","/manifest.webmanifest","/favicon.ico","/assets/app.js","/assets/theme.css","/icons/app.svg","/robots.txt"];
 const originals=paths.map((p,i)=>({path:p,hash:hash((i%6).toString(16))}));
 if(missing)originals.splice(2,1);
 const seen=[];
 const request=async(method,url)=>{
  seen.push({method,url});
  if(method!=="GET")throw Error("UNEXPECTED_REMOTE_WRITE");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))
   return {name:version,status:"FINALIZED",config:{headers:[]},
    ...(omitCount?{}:{fileCount:originals.length})};
  if(url.includes("/"+version+"/files?"))return {files:originals};
  throw Error("UNMOCKED "+url);
 };
 return {request,seen};
}
const fakeIndex=Buffer.from("mergedPartnerRankingDay partnerInviteInline 営業実績管理".repeat(30));
test("audited 11-file live version missing fileCount is dry-run verifiable without any writes",async()=>{
 const x=live();
 const r=await uploadSingleExistingIndex({assetBytes:fakeIndex,request:x.request,release:false,log:()=>{}});
 assert.equal(r.released,false);
 assert.equal(r.originalCount,11);
 assert.ok(x.seen.every(s=>s.method==="GET"));
});
test("unreviewed live source missing fileCount is never allowed",async()=>{
 const x=live("sites/nico-factory/versions/unreviewed");
 await assert.rejects(uploadSingleExistingIndex({assetBytes:fakeIndex,request:x.request,log:()=>{}}),
  /UNREVIEWED_LIVE_VERSION_MISSING_COUNT/);
 assert.ok(x.seen.every(s=>s.method==="GET"));
});
test("known version missing one mandatory partner page is rejected without a release",async()=>{
 const x=live(undefined,true,true);
 await assert.rejects(uploadSingleExistingIndex({assetBytes:fakeIndex,request:x.request,log:()=>{}}),
  /SOURCE_REQUIRED_FILE_MISSING/);
 assert.ok(x.seen.every(s=>s.method==="GET"));
});
