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


test("live index dry-run accepts absent Hosting fileCount ONLY with full original route manifest",async()=>{
 const base="https://firebasehosting.googleapis.com/v1beta1";
 const source="sites/nico-factory/versions/abc123";
 const asset=Buffer.from("営業実績管理 partnerInviteInline mergedPartnerRankingDay ".repeat(20));
 const seen=[];
 const request=async(method,url)=>{
  seen.push({method,url});
  if(url===base+"/sites/nico-factory/releases?pageSize=1")
   return {releases:[{version:{name:source}}]};
  if(url===base+"/"+source)
   return {name:source,status:"FINALIZED",config:{rewrites:[{glob:"**",destination:"/index.html"}]}};
  if(url.startsWith(base+"/"+source+"/files?"))return {files:originals};
  throw Error("UNEXPECTED_REQUEST "+url);
 };
 const lines=[];
 const result=await uploadSingleExistingIndex({
  assetBytes:asset,request,log:x=>lines.push(x)
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,4);
 assert.ok(seen.every(x=>x.method==="GET"));
 assert.ok(lines.some(x=>String(x).includes("Source fileCount metadata absent")));
});
test("fail-closed when live source version lacks required preexisting partner route",async()=>{
 const base="https://firebasehosting.googleapis.com/v1beta1";
 const name="sites/nico-factory/versions/abc123";
 const asset=Buffer.from("営業実績管理 partnerInviteInline mergedPartnerRankingDay ".repeat(20));
 const seen=[];
 const request=async(method,url)=>{
  seen.push(method);
  if(url===base+"/sites/nico-factory/releases?pageSize=1")return {releases:[{version:{name}}]};
  if(url===base+"/"+name)return {name,status:"FINALIZED",config:{rewrites:[]}};
  if(url.startsWith(base+"/"+name+"/files?"))return {files:originals.filter(f=>f.path!=="/partner-workspace.html")};
  throw Error("UNEXPECTED");
 };
 await assert.rejects(uploadSingleExistingIndex({assetBytes:asset,request,log:()=>{}}),
  /REQUIRED_ORIGINAL_PAGE_MISSING/);
 assert.ok(seen.every(x=>x==="GET"));
});
