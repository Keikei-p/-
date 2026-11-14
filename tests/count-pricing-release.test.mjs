import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {gzipSync} from "node:zlib";
import vm from "node:vm";
import {releaseCountPricingHotfix,manifestSha256,configSha256,sha256,
 assertCandidateRepoSource,MANIFEST_SHA256,CONFIG_SHA256,CANDIDATE_BLOB,CANDIDATE_SHA256,CONFIRMATION}
 from "../tools/hosting/release-count-pricing-hotfix.mjs";
import {prepareCountPricingHotfix,BASE_COMMIT,LIVE_BLOB,LIVE_VERSION,gitBlob,CHANGED_FUNCTIONS,functionBody}
 from "../tools/hosting/prepare-count-pricing-hotfix.mjs";

const baseline=JSON.parse(readFileSync(new URL("./fixtures/count-pricing-hosting-baseline.json",import.meta.url),"utf8"));
const git=args=>execFileSync("git",["--no-optional-locks",...args],{encoding:"utf8",maxBuffer:3000000});
const live=Buffer.from(git(["cat-file","blob",LIVE_BLOB]));
const base=git(["show",BASE_COMMIT+":index.html"]).replace(/\r\n/g,"\n");
const current=readFileSync(new URL("../index.html",import.meta.url),"utf8").replace(/\r\n/g,"\n");
// General CI may contain future unrelated UI work. Compose only the pricing
// functions into the old baseline for this historical release's unit fixture.
// The actual CLI independently requires the exact, three-function-only source.
let candidate=base;
for(const name of CHANGED_FUNCTIONS)
 candidate=candidate.replace(functionBody(base,name),functionBody(current,name));
const prepared=prepareCountPricingHotfix({live:live.toString("utf8"),
 base,candidate});
const asset=Buffer.from(prepared.asset),main="b".repeat(40);
const BASE="https://firebasehosting.googleapis.com/v1beta1/";
const latest=BASE+"sites/nico-factory/releases?pageSize=1";
const nextVersion="sites/nico-factory/versions/count-pricing-test";
const clone=x=>structuredClone(x);

test("manual human review parser accepts only this unique release section, never a later unrelated signature",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/nico-count-pricing-hotfix-manual.yml",import.meta.url),"utf8").replace(/\r\n/g,"\n");
 const start=workflow.indexOf("const sections="),end=workflow.indexOf("const runs=",start);
 assert(start>0&&end>start);
 const actual=workflow.slice(start,end);
 // Synthetic strings exercise the actual parser; no review document is signed.
 const signed="- 本人レビュー日: 2026-11-14\n- 本人GitHubアカウント: Keikei-p\n- 本人署名: Keikei-p\n";
 const heading="## COUNT_PRICING_HOTFIX_20261114\n";
 const run=text=>vm.runInNewContext(actual,{
  fs:{readFileSync:()=>text},stop:()=>{throw Error("review-required")}
 });
 assert.doesNotThrow(()=>run(heading+signed));
 for(const text of [heading,"## unrelated\n"+signed,
   heading+"- 本人署名:\n\n## unrelated\n"+signed,
   heading+signed+"\n"+heading+signed])
  assert.throws(()=>run(text),/review-required/);
});
function authorization(){
 const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"Keikei-p/-",GITHUB_REF:"refs/heads/main",
  GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_ACTOR:"Keikei-p",GITHUB_TRIGGERING_ACTOR:"Keikei-p",
  GITHUB_WORKFLOW_REF:"Keikei-p/-/.github/workflows/nico-count-pricing-hotfix-manual.yml@refs/heads/main",
  GITHUB_SHA:main,REVIEWED_MAIN_SHA:main,REVIEWED_PR:"999",
  NICO_COUNT_PRICING_CONFIRMATION:CONFIRMATION};
 return {env,event:{sender:{login:"Keikei-p"},inputs:{reviewed_main_sha:main,
  reviewed_pr:"999",confirmation:CONFIRMATION}}};
}
function host(options={}){
 const original=clone(baseline),calls=[],writes=[];
 const state={current:LIVE_VERSION,phase:"create",mainChecks:0,published:false,finalized:false};
 const gzip=gzipSync(asset,{mtime:0}),hash=sha256(gzip);
 const auth=authorization();let finalFiles;
 const request=async(method,url,body=null,type)=>{
  calls.push({method,url});
  if(method==="GET"){
   if(url===latest)return {releases:[{version:{name:
    state.mainChecks>=3&&options.sourceDrift===state.phase?"sites/nico-factory/versions/foreign":state.current}}]};
   if(url===BASE+LIVE_VERSION)return {...clone(original),files:undefined};
   if(url.startsWith(BASE+LIVE_VERSION+"/files?")){
    if(options.pageLoop)return {files:[],nextPageToken:"repeat"};
    return {files:clone(original.files)};
   }
   if(url===BASE+nextVersion)return {name:nextVersion,status:"FINALIZED",config:clone(original.config),fileCount:33};
   if(url.startsWith(BASE+nextVersion+"/files?"))return {files:clone(finalFiles)};
   throw Error("UNMOCKED_GET");
  }
  writes.push({method,url,body:Buffer.isBuffer(body)?Buffer.from(body):clone(body),type});
  if(method==="POST"&&url===BASE+"sites/nico-factory/versions"){
   state.phase="populate";return {name:nextVersion,status:"CREATED"};
  }
  if(method==="POST"&&url===BASE+nextVersion+":populateFiles"){
   finalFiles=Object.entries(body.files).map(([path,hash])=>({path,hash}));
   state.phase=options.reusable?"finalize":"upload";
   return {uploadRequiredHashes:options.reusable?[]:[hash],uploadUrl:options.badUploadUrl||
    "https://upload-firebasehosting.googleapis.com/upload/"+nextVersion+"/files"};
  }
  if(method==="POST"&&url.startsWith("https://upload-firebasehosting.googleapis.com/")){
   assert(body.equals(gzip));state.phase="finalize";return {};
  }
  if(method==="PATCH"&&url===BASE+nextVersion+"?update_mask=status"){
   state.finalized=true;state.phase="release";
   if(options.finalFileDrift)finalFiles[0].hash="0".repeat(64);
   if(options.revokeAfterFinalize)auth.env.NICO_COUNT_PRICING_CONFIRMATION="NOT_APPROVED";
   return {name:nextVersion,status:"FINALIZED",config:clone(original.config),fileCount:33};
  }
  if(method==="POST"&&url===BASE+"sites/nico-factory/releases?versionName="+encodeURIComponent(nextVersion)){
   assert(state.finalized);state.current=nextVersion;state.published=true;state.phase="done";
   return {name:"sites/nico-factory/releases/test",version:{name:nextVersion}};
  }
  throw Error("UNMOCKED_WRITE");
 };
 return {original,calls,writes,state,auth,
  args:{assetBytes:asset,request,
   readCurrentMain:async()=>{
    state.mainChecks++;
    return state.mainChecks>=3&&options.mainDrift===state.phase?"c".repeat(40):main;
   },
   readLiveIndex:async()=>state.published?(options.postHttpDrift?Buffer.from("wrong"):asset):
    options.liveIndexDrift?Buffer.concat([live,Buffer.from("\n")]):live,
   reviewedMainSha:main,...auth}};
}

test("fixed public Hosting metadata reproduces the actual 33-path and config SHA calculations",()=>{
 assert.equal(baseline.name,LIVE_VERSION);assert.equal(baseline.files.length,33);
 assert.equal(manifestSha256(baseline.files),MANIFEST_SHA256);
 assert.equal(manifestSha256(baseline.files.slice().reverse()),MANIFEST_SHA256);
 assert.equal(configSha256(baseline.config),CONFIG_SHA256);
 assert.equal(gitBlob(asset),CANDIDATE_BLOB);assert.equal(sha256(asset),CANDIDATE_SHA256);
 assert.doesNotThrow(()=>assertCandidateRepoSource(candidate));
 assert.throws(()=>assertCandidateRepoSource(candidate+'\nwindow.unrelatedUi=true;'),/REPO_SOURCE_BYTES/);
});

test("default dry-run uses only GETs and the unchanged uploader, retaining all 33 live assets",async()=>{
 const h=host();const result=await releaseCountPricingHotfix(h.args);
 assert.equal(result.mode,"DRY_RUN");assert.equal(result.released,false);
 assert.equal(result.sourceFiles,33);assert.equal(result.unchangedOtherAssets,32);
 assert.equal(result.hostingWriteCalls,0);assert.equal(result.postPublicationByteCheck,false);
 assert(h.calls.every(x=>x.method==="GET"));assert.equal(h.writes.length,0);
});

test("only the exact candidate is accepted before any network or credential callback",async()=>{
 const h=host();
 await assert.rejects(releaseCountPricingHotfix({...h.args,assetBytes:Buffer.concat([asset,Buffer.from("\n")])}),/CANDIDATE_BYTES/);
 assert.equal(h.calls.length,0);
});

test("missing manual human intent, wrong actor, branch, workflow, confirmation or exact reviewed SHA stops before any GET",async()=>{
 for(const [key,value] of [["GITHUB_ACTIONS","false"],["GITHUB_ACTOR","other"],
  ["GITHUB_TRIGGERING_ACTOR","other"],["GITHUB_TRIGGERING_ACTOR",undefined],["GITHUB_REF","refs/heads/dev"],
  ["GITHUB_EVENT_NAME","push"],["GITHUB_WORKFLOW_REF","other"],["REVIEWED_MAIN_SHA","c".repeat(40)],
  ["NICO_COUNT_PRICING_CONFIRMATION","NOT_APPROVED"]]){
  const h=host();h.auth.env[key]=value;
  await assert.rejects(releaseCountPricingHotfix({...h.args,release:true}),/HUMAN_MANUAL_INTENT_REQUIRED/);
  assert.equal(h.calls.length,0);
 }
 const h=host();h.auth.event.inputs.reviewed_main_sha="c".repeat(40);
 await assert.rejects(releaseCountPricingHotfix({...h.args,release:true}),/HUMAN_MANUAL_INTENT_REQUIRED/);
 assert.equal(h.calls.length,0);
});

test("changed source count, missing count, config, asset hash or HTTP bytes fails before any mutation",async()=>{
 for(const mutate of [
  x=>{delete x.fileCount},x=>{x.fileCount=32},x=>{x.fileCount=34},
  x=>{x.config.headers=[]},x=>{x.files[1].hash="0".repeat(64)},
  x=>{x.files.pop()},x=>{x.files.push({path:"/unreviewed",hash:"0".repeat(64)})},
  x=>{x.files[1].path=x.files[0].path}
 ]){
  const h=host();mutate(h.original);
  await assert.rejects(releaseCountPricingHotfix({...h.args,release:true}),/SOURCE_|MANIFEST_ENTRY/);
  assert.equal(h.writes.length,0);
 }
 const h=host({liveIndexDrift:true});
 await assert.rejects(releaseCountPricingHotfix({...h.args,release:true}),/LIVE_INDEX_DRIFT/);
 assert.equal(h.writes.length,0);
});

test("looping source pagination cannot reach the legacy uploader or perform writes",async()=>{
 const h=host({pageLoop:true});
 await assert.rejects(releaseCountPricingHotfix({...h.args,release:true}),/SOURCE_PAGE_LOOP/);
 assert.equal(h.writes.length,0);
});

test("main or Hosting source drift is rejected before create, populate, upload, finalize AND release",async()=>{
 const phases=["create","populate","upload","finalize","release"];
 for(const key of ["mainDrift","sourceDrift"])for(const [i,phase] of phases.entries()){
  const h=host({[key]:phase});
  await assert.rejects(releaseCountPricingHotfix({...h.args,release:true}),
   key==="mainDrift"?/MAIN_DRIFT/:/LIVE_VERSION_DRIFT/);
  assert.equal(h.writes.length,i,key+" "+phase);
  assert.equal(h.state.published,false);
 }
});

test("explicit synthetic release replaces index only, preserves the other 32 hashes/config and verifies public bytes",async()=>{
 const h=host();const result=await releaseCountPricingHotfix({...h.args,release:true});
 assert.equal(result.released,true);assert.equal(result.postPublicationByteCheck,true);
 assert.equal(result.newVersion,nextVersion);assert.equal(h.writes.length,5);
 assert.equal(result.firestoreWrites,0);assert.equal(result.rulesWrites,0);assert.equal(result.functionsWrites,0);
 const create=h.writes.find(x=>x.url===BASE+"sites/nico-factory/versions");
 assert.deepEqual(create.body,{config:baseline.config});
 const body=h.writes.find(x=>x.url.endsWith(":populateFiles")).body;
 assert.equal(Object.keys(body.files).length,33);
 for(const file of baseline.files)if(file.path!=="/index.html")assert.equal(body.files[file.path],file.hash);
 assert.notEqual(body.files["/index.html"],baseline.files.find(x=>x.path==="/index.html").hash);
 assert(h.writes.every(x=>x.url.startsWith(BASE)||x.url.startsWith("https://upload-firebasehosting.googleapis.com/upload/"+nextVersion+"/files/")));
});

test("already stored candidate gzip skips upload without widening the four remaining mutations",async()=>{
 const h=host({reusable:true});const result=await releaseCountPricingHotfix({...h.args,release:true});
 assert.equal(result.released,true);assert.equal(h.writes.length,4);
 assert(h.writes.every(x=>!x.url.startsWith("https://upload-firebasehosting.googleapis.com/")));
});

test("wrong upload version, changed final manifest, revoked intent or bad post-release HTTP is not success",async()=>{
 const badUpload=host({badUploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/other/versions/foreign/files"});
 await assert.rejects(releaseCountPricingHotfix({...badUpload.args,release:true}),/UNAPPROVED_WRITE/);
 assert.equal(badUpload.writes.length,2);assert.equal(badUpload.state.published,false);
 const changed=host({finalFileDrift:true});
 await assert.rejects(releaseCountPricingHotfix({...changed.args,release:true}),/FILE_HASH_DRIFT/);
 assert.equal(changed.state.published,false);
 const revoked=host({revokeAfterFinalize:true});
 await assert.rejects(releaseCountPricingHotfix({...revoked.args,release:true}),/HUMAN_MANUAL_INTENT_REQUIRED/);
 assert.equal(revoked.writes.length,4);assert.equal(revoked.state.published,false);
 const stale=host({postHttpDrift:true});
 await assert.rejects(releaseCountPricingHotfix({...stale.args,release:true}),/POST_RELEASE_HTTP/);
 assert.equal(stale.state.published,true,"a post-publication check failure must never be reported as an unpublished attempt");
});
