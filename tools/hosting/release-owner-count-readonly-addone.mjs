#!/usr/bin/env node
/**
 * One-shot Firebase Hosting ADD-ONE. Only a reviewed Owner count reader HTML
 * is added. Copies 17 original assets and Hosting config byte/hash-identically.
 * No Firebase Auth, Firestore, Functions or Security Rules updates.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import path from "node:path";
import {
 SITE,PROJECT,NEW_PATH,BASE_VERSION,planOwnerCountAddOne
} from "./owner-count-readonly-addone-guard.mjs";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const RELEASES=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const HASH=/^[a-f0-9]{64}$/;
const STOP=x=>{throw Error("STOP_OWNER_COUNT_ONE_RELEASE_"+x)};
function releasedName(data){
 const name=data?.releases?.[0]?.version?.name;
 if(!Array.isArray(data?.releases)||data.releases.length!==1||
    !VERSION.test(name||""))STOP("LIVE_VERSION_UNVERIFIED");
 return name;
}
async function filesOf(request,version){
 const result=[];let token="",seen=new Set();
 do{
  if(seen.has(token)||seen.size>30)STOP("PAGINATION");
  seen.add(token);
  const query=new URLSearchParams({pageSize:"1000"});
  if(token)query.set("pageToken",token);
  const data=await request("GET",BASE+"/"+version+"/files?"+query);
  if(!Array.isArray(data?.files)||data.files.length>1000||
    result.length+data.files.length>20000)STOP("FILES_UNVERIFIED");
  result.push(...data.files);
  token=data.nextPageToken||"";
  if(typeof token!=="string"||token.length>3000)STOP("TOKEN_SHAPE");
 }while(token);
 return result;
}
export async function publishOwnerCountAddOne({request,oldSources,candidate,release=false,log=()=>{}}={}){
 if(typeof request!=="function"||typeof release!=="boolean"||
    typeof log!=="function")STOP("ARGUMENTS");
 const latest=async()=>releasedName(await request("GET",RELEASES));
 const oldVersion=await latest();
 // A concurrent routine can publish a newer Hosting version. Accept it ONLY
 // if its full asset manifest and Hosting config are identical to the pinned
 // 17-asset previously reviewed version. Never assume a new version is safe.
 const old=await request("GET",BASE+"/"+oldVersion);
 if(old?.name!==oldVersion||old.status!=="FINALIZED"||
    !old.config||typeof old.config!=="object"||Array.isArray(old.config))
  STOP("LIVE_CONFIG_UNVERIFIED");
 const base=oldVersion===BASE_VERSION?old:await request("GET",BASE+"/"+BASE_VERSION);
 if(base?.name!==BASE_VERSION||base.status!=="FINALIZED"||
    JSON.stringify(base.config)!==JSON.stringify(old.config))
  STOP("REVIEWED_BASE_CONFIG_DRIFT");
 const baseFiles=await filesOf(request,BASE_VERSION);
 if(base.fileCount!=null&&Number(base.fileCount)!==baseFiles.length)
  STOP("REVIEWED_BASE_COUNT");
 const pinned=planOwnerCountAddOne({
  version:BASE_VERSION,liveFiles:baseFiles,oldSources,candidate
 });
 const liveFiles=oldVersion===BASE_VERSION?baseFiles:await filesOf(request,oldVersion);
 if(liveFiles.length!==pinned.previousCount||
    old.fileCount!=null&&Number(old.fileCount)!==liveFiles.length)
  STOP("LIVE_ASSET_COUNT_DRIFT");
 const current=new Map();
 for(const file of liveFiles){
  if(typeof file?.path!=="string"||typeof file.hash!=="string"||
     !/^[a-f0-9]{64}$/.test(file.hash.toLowerCase())||
     current.has(file.path))STOP("LIVE_ASSET_SCHEMA_DRIFT");
  current.set(file.path,file.hash.toLowerCase());
 }
 if([...pinned.originalManifest.keys()].some(path=>!current.has(path)))
  STOP("LIVE_ASSET_PATH_SET_DRIFT");
 // The new read-only page is FULLY INDEPENDENT of existing Owner assets.
 // Check the reviewed baseline's four Owner files against pinned Git sources,
 // then preserve ALL 17 currently live asset hashes, including updated Owner
 // assets. We neither load nor replace any existing HTML/JS in this release.
 const plan=Object.freeze({
  ...pinned,
  originalManifest:current,
  proposedManifest:new Map([...current,[NEW_PATH,pinned.newHash]])
 });
 if(plan.originalManifest.size!==17||plan.proposedManifest.size!==18||
    [...current].some(([p,h])=>plan.proposedManifest.get(p)!==h))
  STOP("UNRELATED_LIVE_FILE_CHANGED");
 const changedExisting=[...current].filter(([p,h])=>
  pinned.originalManifest.get(p)!==h).length;
 log("OWNER_COUNT_ADDONE_PREFLIGHT "+JSON.stringify({
  existingFilesPreserved:plan.previousCount,filesAdded:1,
  existingFilesChangedSinceReviewedBaseline:changedExisting,
  latestExistingHashesPreserved:true,
  scope:NEW_PATH,readOnlyPortal:true,firestoreWrites:0
 }));
 if(!release)return Object.freeze({
  released:false,readOnly:true,baseVersion:oldVersion,
  originalAssetsUnmodified:17,newAssets:1
 });
 if(await latest()!==oldVersion)STOP("CONCURRENT_RELEASE_BEFORE_CREATE");
 const created=await request("POST",BASE+"/sites/"+SITE+"/versions",{config:old.config});
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  STOP("NEW_VERSION_NOT_CREATED");
 const all=[...plan.proposedManifest.entries()];
 const needed=new Set();let uploadUrl="";
 for(let i=0;i<all.length;i+=800){
  const response=await request("POST",BASE+"/"+created.name+":populateFiles",{
   files:Object.fromEntries(all.slice(i,i+800))
  });
  if(!response||typeof response!=="object"||
     response.uploadRequiredHashes!=null&&!Array.isArray(response.uploadRequiredHashes))
   STOP("POPULATE_INVALID");
  if(response.uploadUrl){
   if(typeof response.uploadUrl!=="string"||
      uploadUrl&&response.uploadUrl!==uploadUrl)STOP("UPLOAD_ORIGIN_CHANGED");
   uploadUrl=response.uploadUrl;
  }
  for(const digest of response.uploadRequiredHashes||[]){
   if(typeof digest!=="string"||!HASH.test(digest)||digest!==plan.newHash)
    STOP("UNREVIEWED_UPLOAD");
   needed.add(digest);
  }
 }
 if(needed.size){
  const target="https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+
   "/versions/"+created.name.split("/").at(-1)+"/";
  if(!uploadUrl.startsWith(target))STOP("UPLOAD_URL_UNVERIFIED");
 }
 for(const digest of needed)await request("POST",uploadUrl+"/"+digest,
  plan.uploadBytes,"application/octet-stream");
 const finished=await request("PATCH",BASE+"/"+created.name+"?update_mask=status",{
  status:"FINALIZED"
 });
 if(finished?.name!==created.name||finished.status!=="FINALIZED"||
   JSON.stringify(finished.config)!==JSON.stringify(old.config))
  STOP("FINALIZED_CONFIG_CHANGED");
 const inspect=async()=>{
  const allFiles=await filesOf(request,created.name),rows=new Map();
  for(const f of allFiles){
   if(typeof f?.path!=="string"||typeof f.hash!=="string"||
      !HASH.test(f.hash.toLowerCase())||rows.has(f.path))
    STOP("FINAL_MANIFEST_INVALID");
   rows.set(f.path,f.hash.toLowerCase());
  }
  if(rows.size!==18||[...plan.proposedManifest].some(([p,h])=>rows.get(p)!==h))
   STOP("FINAL_MANIFEST_MISMATCH");
 };
 await inspect();
 const createdMeta=await request("GET",BASE+"/"+created.name);
 if(createdMeta?.name!==created.name||createdMeta.status!=="FINALIZED"||
    JSON.stringify(createdMeta.config)!==JSON.stringify(old.config))
  STOP("CREATED_VERSION_NOT_VERIFIED");
 if(await latest()!==oldVersion)STOP("CONCURRENT_RELEASE_BEFORE_PUBLISH");
 const published=await request("POST",BASE+"/sites/"+SITE+
  "/releases?versionName="+encodeURIComponent(created.name),{});
 if(published?.version?.name!==created.name)STOP("PUBLISH_UNVERIFIED");
 if(await latest()!==created.name)STOP("PUBLISHED_LIVE_VERSION_MISMATCH");
 await inspect();
 const report=Object.freeze({
  released:true,verifiedHostingVersion:created.name,
  newPage:NEW_PATH,oldFilesPreserved:17,newFileCount:1,
  originalVersionRetained:true,firestoreWrites:0,
  existingAuthFunctionsRulesUnchanged:true
 });
 log("OWNER_COUNT_ADDONE_RELEASED "+JSON.stringify(report));
 return report;
}
function safeUrl(method,url){
 if(!["GET","POST","PATCH"].includes(method))STOP("METHOD_FORBIDDEN");
 let parsed;try{parsed=new URL(url)}catch{STOP("BAD_URL")}
 const normal=parsed.origin==="https://firebasehosting.googleapis.com"&&
  parsed.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=parsed.origin==="https://upload-firebasehosting.googleapis.com"&&
  parsed.pathname.startsWith("/upload/sites/"+SITE+"/versions/");
 if(!normal&&!upload||parsed.username||parsed.password||parsed.hash)
  STOP("HOST_UNVERIFIED");
 if(upload&&method!=="POST")STOP("UPLOAD_METHOD");
 if(method==="PATCH"&&parsed.search!=="?update_mask=status")STOP("PATCH_SCOPE");
 if(method==="POST"&&!upload&&
    !(/\/versions$/.test(parsed.pathname)||/:populateFiles$/.test(parsed.pathname)||
       /\/releases$/.test(parsed.pathname)))STOP("POST_SCOPE");
 return parsed.href;
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==1||!["--dry-run","--release"].includes(args[0])||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("CI_CONTEXT");
 const release=args[0]==="--release";
 if(release&&process.env.NICO_OWNER_COUNT_ADDONE_RELEASE!==
   "APPROVE_ADD_ONE_READONLY_OWNER_COUNTS_HTML")
  STOP("RELEASE_APPROVAL_REQUIRED");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const read=p=>readFileSync(path.join(root,p),"utf8");
 const oldSources={
  "/owner-partner-admin.html":read("staging/owner-workspace-errors-v1/owner-partner-admin.html"),
  "/owner-partner-admin-assets/mobile-bootstrap.mjs":read("staging/owner-workspace-errors-v1/mobile-bootstrap.mjs"),
  "/owner-partner-admin-assets/owner-client.mjs":read("staging/owner-workspace-errors-v1/owner-client.mjs"),
  "/owner-partner-admin-assets/owner-ui.mjs":read("staging/owner-workspace-errors-v1/owner-ui.mjs")
 };
 const candidate=read("staging/owner-count-readonly-v1/owner-partner-counts-readonly.html");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const cred=applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  const target=safeUrl(method,url);
  const access=(await cred.getAccessToken())?.access_token;
  if(typeof access!=="string"||access.length<20)STOP("CREDENTIAL_UNAVAILABLE");
  const opts={method,redirect:"error",headers:{Authorization:"Bearer "+access}};
  if(body!==null){
   opts.headers["Content-Type"]=type;
   opts.body=type==="application/octet-stream"?body:JSON.stringify(body);
  }
  const response=await fetch(target,opts);
  if(!response.ok)STOP("HTTP_"+response.status);
  const raw=await response.text();
  if(raw.length>4000000)STOP("TOO_MUCH_DATA");
  try{return raw?JSON.parse(raw):{}}catch{STOP("JSON_INVALID")}
 };
 const result=await publishOwnerCountAddOne({
  request,oldSources,candidate,release,log:console.log
 });
 console.log("OWNER_COUNT_ADDONE_RESULT "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{
  console.error(/^STOP_OWNER_(?:COUNT_ONE_RELEASE|COUNT_ADDONE)_[A-Z0-9_]+$/.test(err?.message||"")?
   err.message:"STOP_OWNER_COUNT_ONE_RELEASE_UNKNOWN");
  process.exitCode=1;
 });
