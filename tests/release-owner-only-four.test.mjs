import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SOURCES,uploadSha}
 from "../tools/hosting/owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS,planOwnerOnlySetupReplacement}
 from "../tools/hosting/owner-only-setup-replacement-guard.mjs";
import {prepareOwnerFourHosting}
 from "../tools/hosting/release-owner-only-four.mjs";
import {historicalSources} from "./helpers/historical-builder-fixtures.mjs";

const historical=()=>historicalSources(SOURCES);
const current=()=>Object.fromEntries(Object.keys(OWNER_ONLY_REPLACEMENTS)
 .map(path=>[path,readFileSync(new URL("../"+path,import.meta.url),"utf8")]));
const old=()=>[
 ...["/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/owner-partner-admin.html"]
 .map((path,i)=>({path,hash:String(i+1).repeat(64)})),
 ...Object.entries(historical()).map(([name,data])=>({
  path:"/"+name,hash:uploadSha(data)
 }))
];
const PREFIX="https://firebasehosting.googleapis.com/v1beta1/";
const SITE=PREFIX+"sites/nico-factory/";
const OLD="sites/nico-factory/versions/OLD",NEW="sites/nico-factory/versions/NEW";
const proof=()=>({
 ownerAuthenticatedGetVerified:true,ownerRoleVerified:true,
 financeReadDeniedVerified:true,ownerGetFunctionDeployedVerified:true,
 hostingVersionBeforeVerification:OLD,evidenceSha256:"a".repeat(64)
});
function mock({drift=false,unknownUpload=false,changedConfig=false}={}){
 const originals=old();
 let current=OLD,populated=null,uploaded=[],releaseCount=0;
 const calls=[];
 const config={headers:[{source:"**",headers:[{key:"Cache-Control",value:"no-store"}]}]};
 const request=async(method,url,body,type)=>{
  calls.push({method,url});
  if(url===SITE+"releases?pageSize=1"&&method==="GET"){
   if(drift&&calls.length>4)current="sites/nico-factory/versions/OTHER";
   return {releases:[{version:{name:current}}]};
  }
  if(url===PREFIX+OLD&&method==="GET")
   return {name:OLD,status:"FINALIZED",config,fileCount:originals.length};
  if(url.startsWith(PREFIX+OLD+"/files?")&&method==="GET")
   return {files:originals};
  if(url===SITE+"versions"&&method==="POST"){
   assert.deepEqual(body,{config});
   return {name:NEW,status:"CREATED"};
  }
  if(url===PREFIX+NEW+":populateFiles"&&method==="POST"){
   populated=new Map(Object.entries(body.files));
   assert.equal(populated.size,originals.length);
   const changed=[...planOwnerOnlySetupReplacement({
    liveFiles:originals,historicalSources:historical(),
    candidateSources:currentSources
   }).changedPaths];
   return {
    uploadRequiredHashes:unknownUpload?["b".repeat(64)]:
     changed.map(p=>populated.get(p)),
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/NEW/files"
   };
  }
  if(url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/NEW/files/")&&method==="POST"){
   assert.equal(type,"application/octet-stream");
   assert(Buffer.isBuffer(body));uploaded.push(url.split("/").at(-1));return {};
  }
  if(url===PREFIX+NEW+"?update_mask=status"&&method==="PATCH")
   return {name:NEW,status:"FINALIZED",config:changedConfig?{}:config};
  if(url.startsWith(PREFIX+NEW+"/files?")&&method==="GET"){
   assert(populated);
   return {files:[...populated].map(([path,hash])=>({path,hash}))};
  }
  if(url===SITE+"releases?versionName="+encodeURIComponent(NEW)&&method==="POST"){
   current=NEW;releaseCount++;return {version:{name:NEW}};
  }
  throw Error("MOCK_UNEXPECTED_"+method+" "+url);
 };
 return {request,calls,get uploaded(){return uploaded},get releaseCount(){return releaseCount}};
}
const currentSources=current();

test("live Hosting GET-only preflight verifies old 11 immutable assets and preserves every unrelated digest",async()=>{
 const net=mock(),r=await prepareOwnerFourHosting({
  request:net.request,historicalSources:historical(),candidateSources:currentSources
 });
 assert.equal(r.released,false);
 assert.equal(r.originalAssets,16);
 assert.equal(r.preservedAssets,12);
 assert.equal(r.changedPaths.length,4);
 assert.equal(r.productionDocumentWrites,0);
 assert.deepEqual([...new Set(net.calls.map(x=>x.method))],["GET"]);
});
test("a real Owner/auth/finance/deployed receipt is REQUIRED before any mutation",async()=>{
 for(const entry of [null,{},{
  ...proof(),financeReadDeniedVerified:false
 },{...proof(),ownerAuthenticatedGetVerified:false},{
  ...proof(),hostingVersionBeforeVerification:"sites/nico-factory/versions/OTHER"
 }]){
  const net=mock();
  await assert.rejects(prepareOwnerFourHosting({
   request:net.request,historicalSources:historical(),candidateSources:currentSources,
   release:true,authenticatedProof:entry
  }),/STOP_OWNER_FOUR_HOSTING_AUTHENTICATED_RELEASE_PROOF_REQUIRED/);
  assert(net.calls.every(x=>x.method==="GET"));
  assert.equal(net.releaseCount,0);
 }
});
test("simulation: exactly four replaced bytes uploaded; other assets/config unchanged",async()=>{
 const net=mock();
 const r=await prepareOwnerFourHosting({
  request:net.request,historicalSources:historical(),candidateSources:currentSources,
  release:true,authenticatedProof:proof()
 });
 assert.equal(r.released,true);
 assert.equal(net.releaseCount,1);
 assert.equal(net.uploaded.length,4);
 assert.equal(new Set(net.uploaded).size,4);
 assert.equal(r.exactlyFourReviewedAssetsChanged,true);
 assert.equal(r.allOtherAssetsAndConfigPreserved,true);
});
test("unknown server upload request and pre-release config drift stop before publication",async()=>{
 for(const options of [{unknownUpload:true},{changedConfig:true},{drift:true}]){
  const net=mock(options);
  await assert.rejects(prepareOwnerFourHosting({
   request:net.request,historicalSources:historical(),candidateSources:currentSources,
   release:true,authenticatedProof:proof()
  }),/STOP_OWNER_FOUR_HOSTING_/);
  assert.equal(net.releaseCount,0);
 }
});
test("new or missing historic source, stale live hash and candidate edits cannot be released",async()=>{
 const badHist=historical();badHist["owner-partner-setup.html"]="unsafe";
 const cases=[
  {historicalSources:badHist,candidateSources:currentSources},
  {historicalSources:historical(),candidateSources:{
   ...currentSources,["ranking/owner-partner-setup-mount.mjs"]:"unsafe"
  }}
 ];
 for(const sample of cases){
  const net=mock();
  await assert.rejects(prepareOwnerFourHosting({
   request:net.request,...sample,release:true,authenticatedProof:proof()
  }),/STOP_OWNER_ONLY_SETUP_REPLACEMENT_/);
  assert(net.calls.every(x=>x.method==="GET"));
 }
});
test("CLI never sources owner GET proof from CI text inputs or sets true itself",()=>{
 const text=readFileSync(new URL("../tools/hosting/release-owner-only-four.mjs",import.meta.url),"utf8");
 assert.match(text,/authenticatedProof:null/);
 assert.match(text,/--dry-run/);
 assert.match(text,/--release/);
 assert.match(text,/CONFIRM_REPLACE_ONLY_FOUR_OWNER_SETUP_ASSETS/);
 assert.doesNotMatch(text,/firebase deploy|firestore\.rules|runTransaction\(/);
});
