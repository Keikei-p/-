#!/usr/bin/env node
/**
 * Production Firebase Hosting release of EXACTLY TWO already-existing,
 * reviewed Owner portal assets. Existing 15/17 files remain byte-hash
 * identical; no Firestore, Functions, Auth, financial, or Rules writes.
 * On any unexpected state, STOP; never retry writes automatically.
 */
import {readFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {planTwoAssetOwnerPortalReplacement}
 from "./owner-portal-two-assets-replacement-guard.mjs";
import {reviewedLocalAssets}
 from "../production/inspect-owner-portal-hosting-readonly.mjs";

const BASE="https://firebasehosting.googleapis.com/v1beta1";
const SITE="nico-factory",PROJECT="sales-management-cc116";
const RELEASES=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const HASH=/^[0-9a-f]{64}$/;
const EXPECTED=Object.freeze([
 "/owner-partner-admin.html",
 "/owner-partner-admin-assets/mobile-bootstrap.mjs"
]);
const stop=c=>{throw Error("STOP_OWNER_PORTAL_EXACT_TWO_"+c)};
const sha=data=>createHash("sha256").update(data).digest("hex");
function verifiedVersionName(releases){
 const name=releases?.releases?.[0]?.version?.name;
 if(!Array.isArray(releases?.releases)||releases.releases.length!==1||
    typeof name!=="string"||!VERSION.test(name))stop("LIVE_RELEASE_UNVERIFIED");
 return name;
}
export async function releaseExactlyTwoOwnerAssets({
 previous,candidate,request,release=false,log=()=>{}
}={}){
 if(typeof request!=="function"||typeof release!=="boolean"||typeof log!=="function")
  stop("ARGUMENTS_UNVERIFIED");
 const latest=async()=>verifiedVersionName(await request("GET",RELEASES));
 const sourceName=await latest();
 const source=await request("GET",BASE+"/"+sourceName);
 if(source?.name!==sourceName||source.status!=="FINALIZED"||
    !source.config||typeof source.config!=="object"||
    Array.isArray(source.config))stop("LIVE_CONFIG_UNVERIFIED");
 const listFiles=async(version)=>{
  const files=[];let cursor="",pageCount=0;const visited=new Set();
  do{
   if(++pageCount>100||visited.has(cursor))stop("FILES_PAGINATION");
   visited.add(cursor);
   const params=new URLSearchParams({pageSize:"1000"});
   if(cursor)params.set("pageToken",cursor);
   const data=await request("GET",BASE+"/"+version+"/files?"+params);
   if(!Array.isArray(data?.files)||data.files.length>1000||
      data.files.length+files.length>30000)stop("LIVE_FILE_LIST");
   files.push(...data.files);
   cursor=data.nextPageToken||"";
   if(typeof cursor!=="string"||cursor.length>3000)stop("PAGE_TOKEN");
  }while(cursor);
  return files;
 };
 const liveFiles=await listFiles(sourceName);
 if(source.fileCount!=null&&Number(source.fileCount)!==liveFiles.length)
  stop("LIVE_FILE_COUNT");
 const plan=planTwoAssetOwnerPortalReplacement({liveFiles,previous,candidate});
 if(plan.changedPaths.length!==2||
   EXPECTED.some(p=>!plan.changedPaths.includes(p)))stop("REPLACEMENT_SCOPE");
 const baseline=Object.freeze({
  sourceName,liveCount:plan.originalManifest.size,
  changedPaths:plan.changedPaths,unmodified:plan.originalManifest.size-2
 });
 log("OWNER_EXACT_TWO_PREFLIGHT "+JSON.stringify({...baseline,noDataWrites:true}));
 if(!release)return Object.freeze({released:false,releaseApproved:false,...baseline});
 if(await latest()!==sourceName)stop("CONCURRENT_RELEASE_BEFORE_CREATE");
 const created=await request("POST",BASE+"/sites/"+SITE+"/versions",{
  config:source.config
 });
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  stop("NEW_VERSION_UNVERIFIED");
 const uploads=new Map(Object.entries(plan.payloads).map(([name,body])=>{
  const bytes=gzipSync(Buffer.from(body,"utf8"),{mtime:0});
  return [sha(bytes),bytes];
 }));
 if(uploads.size!==2)stop("EXPECTED_EXACTLY_TWO_PAYLOADS");
 let uploadUrl="",required=new Set();
 const manifest=[...plan.proposedManifest.entries()];
 for(let i=0;i<manifest.length;i+=800){
  const result=await request("POST",BASE+"/"+created.name+":populateFiles",{
   files:Object.fromEntries(manifest.slice(i,i+800))
  });
  if(!result||typeof result!=="object"||
     (result.uploadRequiredHashes!=null&&!Array.isArray(result.uploadRequiredHashes)))
   stop("POPULATE_FAILED");
  if(result.uploadUrl){
   if(typeof result.uploadUrl!=="string"||uploadUrl&&result.uploadUrl!==uploadUrl)
    stop("UPLOAD_SERVER_CHANGED");
   uploadUrl=result.uploadUrl;
  }
  for(const h of result.uploadRequiredHashes||[]){
   if(typeof h!=="string"||!HASH.test(h)||!uploads.has(h))stop("UNREVIEWED_UPLOAD_REQUIRED");
   required.add(h);
  }
 }
 if(required.size){
  const prefix="https://upload-firebasehosting.googleapis.com/upload/sites/"+
   SITE+"/versions/";
  if(!uploadUrl.startsWith(prefix)||!uploadUrl.includes(created.name.split("/").at(-1)))
   stop("UPLOAD_URL_UNVERIFIED");
 }
 for(const h of required)await request("POST",uploadUrl+"/"+h,
  uploads.get(h),"application/octet-stream");
 const finalized=await request("PATCH",BASE+"/"+created.name+
  "?update_mask=status",{status:"FINALIZED"});
 if(finalized?.name!==created.name||finalized.status!=="FINALIZED"||
    JSON.stringify(finalized.config)!==JSON.stringify(source.config))
  stop("FINAL_CONFIG_UNVERIFIED");
 const approved=new Map();
 for(const f of await listFiles(created.name)){
  if(typeof f?.path!=="string"||typeof f.hash!=="string"||
     !HASH.test(f.hash.toLowerCase())||approved.has(f.path))
   stop("NEW_MANIFEST_INVALID");
  approved.set(f.path,f.hash.toLowerCase());
 }
 if(approved.size!==plan.proposedManifest.size||
    [...plan.proposedManifest].some(([p,h])=>approved.get(p)!==h))
  stop("NEW_MANIFEST_MISMATCH");
 const verify=await request("GET",BASE+"/"+created.name);
 if(verify?.name!==created.name||verify.status!=="FINALIZED"||
    JSON.stringify(verify.config)!==JSON.stringify(source.config))
  stop("NEW_VERSION_UNVERIFIED_AFTER_FINALIZE");
 if(await latest()!==sourceName)stop("CONCURRENT_RELEASE_BEFORE_ACTIVATE");
 const published=await request("POST",BASE+"/sites/"+SITE+
  "/releases?versionName="+encodeURIComponent(created.name),{});
 if(published?.version?.name!==created.name)stop("ACTIVATE_RELEASE_UNVERIFIED");
 if(await latest()!==created.name)stop("POST_RELEASE_VERSION_CHANGED");
 const verifiedLive=await listFiles(created.name);
 if(verifiedLive.length!==plan.proposedManifest.size||
    verifiedLive.some(f=>plan.proposedManifest.get(f.path)!==f.hash?.toLowerCase()))
  stop("POST_RELEASE_MANIFEST_MISMATCH");
 const report=Object.freeze({released:true,...baseline,
  activatedVersion:created.name,productionDataWrites:0,
  oldVersionRetained:true,otherFileHashesUnchanged:true});
 log("OWNER_EXACT_TWO_RELEASED "+JSON.stringify(report));
 return report;
}
function allowedUrl(method,url){
 let p;
 try{p=new URL(url)}catch{stop("UNVERIFIED_URL")}
 const base=p.origin==="https://firebasehosting.googleapis.com"&&
   p.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=p.origin==="https://upload-firebasehosting.googleapis.com"&&
   p.pathname.startsWith("/upload/sites/"+SITE+"/versions/");
 if((!base&&!upload)||p.username||p.password||p.hash)stop("UNVERIFIED_URL");
 if(upload&&method!=="POST")stop("UPLOAD_METHOD");
 if(!["GET","POST","PATCH"].includes(method))stop("UNAPPROVED_METHOD");
 if(method==="PATCH"&&p.search!=="?update_mask=status")stop("PATCH_SCOPE");
 if(method==="POST"&&!upload&&
  !(/\/versions$/.test(p.pathname)||/:populateFiles$/.test(p.pathname)||
    /\/releases$/.test(p.pathname)))stop("POST_SCOPE");
 return p.href;
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==1||!["--dry-run","--release"].includes(args[0])||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  stop("MAIN_CONTEXT");
 const release=args[0]==="--release";
 if(release&&process.env.NICO_OWNER_EXACT_TWO_RELEASE!==
   "APPROVE_REPLACE_ONLY_TWO_REVIEWED_OWNER_ERROR_ASSETS")
  stop("MISSING_RELEASE_APPROVAL");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const assets=reviewedLocalAssets(root);
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  const endpoint=allowedUrl(method,url);
  const token=(await credential.getAccessToken()).access_token;
  if(typeof token!=="string"||token.length<20)stop("TOKEN_UNAVAILABLE");
  const headers={Authorization:"Bearer "+token};
  const options={method,headers,redirect:"error"};
  if(body!==null){
   headers["Content-Type"]=type;
   options.body=type==="application/octet-stream"?body:JSON.stringify(body);
  }
  const res=await fetch(endpoint,options);
  if(!res.ok)stop("HOSTING_STATUS_"+res.status);
  const raw=await res.text();
  if(raw.length>4_000_000)stop("RESPONSE_TOO_LARGE");
  try{return raw?JSON.parse(raw):{}}catch{stop("RESPONSE_JSON")}
 };
 const result=await releaseExactlyTwoOwnerAssets({...assets,
  request,release,log:console.log});
 console.log("OWNER_EXACT_TWO_RESULT "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{
  console.error(/^STOP_OWNER_PORTAL_(EXACT_TWO|TWO_ASSETS)_[A-Z0-9_]+$/.test(
   error?.message||"")?error.message:"STOP_OWNER_PORTAL_EXACT_TWO_UNKNOWN");
  process.exitCode=1;
 });
