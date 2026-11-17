#!/usr/bin/env node
/**
 * Existing Owner setup Hosting upgrade: replace exactly FOUR historically
 * reviewed assets; preserve all others and complete active Hosting config.
 * No Firestore/Auth/Functions/Rules API is imported or used here.
 *
 * Source/manifest checks are GET-only. A production release additionally
 * needs a reviewed, REAL authenticated Owner GET receipt issued externally.
 */
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {resolve,join} from "node:path";
import {SOURCES,uploadBytes,uploadSha} from "./owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS,planOwnerOnlySetupReplacement} from "./owner-only-setup-replacement-guard.mjs";

const SITE="nico-factory",PROJECT="sales-management-cc116";
const API="https://firebasehosting.googleapis.com/v1beta1";
const RELEASES=API+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const fail=code=>{throw Error("STOP_OWNER_FOUR_HOSTING_"+code);};
const versionOf=result=>{
 const items=result?.releases;
 if(!Array.isArray(items)||items.length!==1||
    !VERSION.test(items[0]?.version?.name||""))fail("ACTIVE_VERSION");
 return items[0].version.name;
};
function checkProof(proof,oldVersion){
 if(!proof||proof.ownerAuthenticatedGetVerified!==true||
    proof.ownerRoleVerified!==true||proof.financeReadDeniedVerified!==true||
    proof.ownerGetFunctionDeployedVerified!==true||
    proof.hostingVersionBeforeVerification!==oldVersion||
    typeof proof.evidenceSha256!=="string"||
    !/^[a-f0-9]{64}$/.test(proof.evidenceSha256))
  fail("AUTHENTICATED_RELEASE_PROOF_REQUIRED");
}
export async function prepareOwnerFourHosting({
 request,historicalSources,candidateSources,release=false,
 authenticatedProof=null,log=()=>{}
}={}){
 if(typeof request!=="function"||typeof release!=="boolean"||
    typeof log!=="function")fail("ARGUMENTS");
 const latest=async()=>versionOf(await request("GET",RELEASES));
 const version=await latest();
 const before=await request("GET",API+"/"+version);
 if(before?.name!==version||before.status!=="FINALIZED"||
    !before.config||typeof before.config!=="object"||
    Array.isArray(before.config))fail("LIVE_CONFIG");
 const listing=async target=>{
  const all=[];let token="",pages=0;const seen=new Set();
  do{
   if(++pages>100||seen.has(token))fail("FILES_PAGING");
   seen.add(token);
   const query=new URLSearchParams({pageSize:"1000"});
   if(token)query.set("pageToken",token);
   const result=await request("GET",API+"/"+target+"/files?"+query);
   if(!Array.isArray(result?.files)||result.files.length>1000||
      all.length+result.files.length>20000)fail("FILES_INCOMPLETE");
   all.push(...result.files);token=result.nextPageToken||"";
   if(typeof token!=="string"||token.length>3000)fail("FILES_TOKEN");
  }while(token);
  return all;
 };
 const oldFiles=await listing(version);
 if(before.fileCount!=null&&Number(before.fileCount)!==oldFiles.length)
  fail("LIVE_FILE_COUNT_DRIFT");
 const plan=planOwnerOnlySetupReplacement({
  liveFiles:oldFiles,historicalSources,candidateSources
 });
 const uploads=new Map();
 for(const name of Object.keys(OWNER_ONLY_REPLACEMENTS)){
  const data=candidateSources[name],digest=uploadSha(data);
  if(uploads.has(digest)||plan.proposedManifest.get("/"+name)!==digest)
   fail("DUPLICATE_OR_UNREVIEWED_UPLOAD");
  uploads.set(digest,uploadBytes(data));
 }
 if(uploads.size!==4)fail("UPLOAD_SCOPE");
 const result={
  released:false,liveVersion:version,
  originalAssets:plan.originalManifest.size,
  preservedAssets:plan.unchangedAssetCount,
  changedPaths:plan.changedPaths,
  productionDocumentWrites:0,functionsDeploys:0,rulesDeploys:0
 };
 log("OWNER_FOUR_HOSTING_PREFLIGHT "+JSON.stringify(result));
 if(!release)return Object.freeze(result);
 // Never reinterpret a unit/synthetic test as real Owner authentication.
 // The separate authenticated proof must be produced and reviewed in the
 // runner before this function may issue a single remote write.
 checkProof(authenticatedProof,version);
 if(await latest()!==version)fail("CONCURRENT_RELEASE_BEFORE_CREATE");
 const created=await request("POST",API+"/sites/"+SITE+"/versions",{
  config:before.config
 });
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  fail("CREATED_VERSION_INVALID");
 const manifest=[...plan.proposedManifest],required=new Set();let uploadUrl="";
 for(let i=0;i<manifest.length;i+=800){
  const p=await request("POST",API+"/"+created.name+":populateFiles",{
   files:Object.fromEntries(manifest.slice(i,i+800))
  });
  if(!p||typeof p!=="object"||
     p.uploadRequiredHashes!=null&&!Array.isArray(p.uploadRequiredHashes))
   fail("POPULATE_INVALID");
  if(p.uploadUrl){
   if(typeof p.uploadUrl!=="string"||uploadUrl&&p.uploadUrl!==uploadUrl)
    fail("UPLOAD_URL_DRIFT");
   uploadUrl=p.uploadUrl;
  }
  for(const hash of p.uploadRequiredHashes||[]){
   if(typeof hash!=="string"||!uploads.has(hash))fail("UNREVIEWED_UPLOAD");
   required.add(hash);
  }
 }
 if(required.size){
  const prefix="https://upload-firebasehosting.googleapis.com/upload/sites/"+
   SITE+"/versions/"+created.name.split("/").at(-1)+"/";
  if(!uploadUrl.startsWith(prefix))fail("UPLOAD_ORIGIN");
 }
 for(const digest of required)
  await request("POST",uploadUrl+"/"+digest,uploads.get(digest),
   "application/octet-stream");
 const finalized=await request("PATCH",API+"/"+created.name+"?update_mask=status",{
  status:"FINALIZED"
 });
 if(finalized?.name!==created.name||finalized.status!=="FINALIZED"||
    JSON.stringify(finalized.config)!==JSON.stringify(before.config))
  fail("CONFIG_DRIFT");
 const finalManifest=async()=>{
  const list=await listing(created.name),actual=new Map();
  for(const row of list){
   if(typeof row.path!=="string"||typeof row.hash!=="string"||
      actual.has(row.path))fail("FINAL_MANIFEST");
   actual.set(row.path,row.hash.toLowerCase());
  }
  if(actual.size!==plan.proposedManifest.size||
     [...plan.proposedManifest].some(([path,hash])=>actual.get(path)!==hash))
   fail("FINAL_MANIFEST_DRIFT");
 };
 await finalManifest();
 if(await latest()!==version)fail("CONCURRENT_RELEASE_BEFORE_PUBLISH");
 const published=await request("POST",API+"/sites/"+SITE+
  "/releases?versionName="+encodeURIComponent(created.name),{});
 if(published?.version?.name!==created.name||
    await latest()!==created.name)fail("RELEASE_VERSION_MISMATCH");
 await finalManifest();
 const done=Object.freeze({...result,released:true,liveVersion:created.name,
  exactlyFourReviewedAssetsChanged:true,
  allOtherAssetsAndConfigPreserved:true});
 log("OWNER_FOUR_HOSTING_RELEASE "+JSON.stringify(done));
 return done;
}
function allowed(method,input){
 let u;try{u=new URL(input)}catch{fail("URL_INVALID")}
 const host=u.origin==="https://firebasehosting.googleapis.com"&&
  u.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=u.origin==="https://upload-firebasehosting.googleapis.com"&&
  u.pathname.startsWith("/upload/sites/"+SITE+"/versions/");
 if((!host&&!upload)||u.username||u.password||u.hash||
    !["GET","POST","PATCH"].includes(method)||upload&&method!=="POST")
  fail("REMOTE_SCOPE");
 if(method==="PATCH"&&u.search!=="?update_mask=status")fail("PATCH_SCOPE");
 if(method==="POST"&&!upload&&
    !(/\/versions$/.test(u.pathname)||/:populateFiles$/.test(u.pathname)||
      /\/releases$/.test(u.pathname)))fail("POST_SCOPE");
 return u.href;
}
async function cli(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!["--dry-run","--release"].includes(mode)||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)fail("RUNTIME_SCOPE");
 if(mode==="--release"&&process.env.NICO_OWNER_FOUR_HOSTING_APPROVAL!==
    "CONFIRM_REPLACE_ONLY_FOUR_OWNER_SETUP_ASSETS")fail("APPROVAL");
 const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const historicalSources=Object.fromEntries(Object.entries(SOURCES).map(([name,sha])=>[
  name,execFileSync("git",["cat-file","blob",sha],{
   cwd:root,maxBuffer:256000
  }).toString("utf8")
 ]));
 const candidateSources=Object.fromEntries(Object.keys(OWNER_ONLY_REPLACEMENTS)
  .map(name=>[name,readFileSync(join(root,name),"utf8")]));
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const admin=require("firebase-admin/app").applicationDefault();
 const request=async(method,raw,body=null,type="application/json")=>{
  const url=allowed(method,raw);
  const token=(await admin.getAccessToken())?.access_token;
  if(typeof token!=="string"||token.length<20)fail("TOKEN");
  const headers={Authorization:"Bearer "+token};
  const opts={method,headers,redirect:"error"};
  if(body!==null){
   headers["Content-Type"]=type;
   opts.body=type==="application/octet-stream"?body:JSON.stringify(body);
  }
  const response=await fetch(url,opts);
  if(!response.ok)fail("HOSTING_HTTP_"+response.status);
  const data=await response.text();
  if(data.length>4000000)fail("RESPONSE_TOO_LARGE");
  try{return data?JSON.parse(data):{}}catch{fail("JSON")}
 };
 const report=await prepareOwnerFourHosting({
  request,historicalSources,candidateSources,release:mode==="--release",
  // A real user proof cannot be inferred from an environment variable.
  // This remains unavailable until a separate secure proof issuer is linked.
  authenticatedProof:null,log:console.log
 });
 console.log("OWNER_FOUR_HOSTING_RESULT "+JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 cli().catch(e=>{
  console.error(/^STOP_OWNER_(?:FOUR_HOSTING|ONLY_SETUP_REPLACEMENT)_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_FOUR_HOSTING_UNVERIFIED");
  process.exitCode=1;
 });
