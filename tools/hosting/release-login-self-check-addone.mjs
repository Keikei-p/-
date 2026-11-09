#!/usr/bin/env node
/**
 * ONE-SHOT login self-check HTML only. Preserves every current Hosting asset
 * hash and config. No Finance/Firestore/Auth/Functions/Rules deployments.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import path from "node:path";
import {SITE,PROJECT,BASE_VERSION,NEW_PATH,planLoginSelfCheck} from "./login-self-check-addone-guard.mjs";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const RELEASES=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const HASH=/^[a-f0-9]{64}$/;
const STOP=x=>{throw Error("STOP_LOGIN_SELF_CHECK_RELEASE_"+x)};
function latestName(d){
 const name=d?.releases?.[0]?.version?.name;
 if(!Array.isArray(d?.releases)||d.releases.length!==1||!VERSION.test(name||""))
  STOP("LATEST_UNVERIFIED");
 return name;
}
async function listFiles(request,version){
 let token="",tokens=new Set(),rows=[];
 do{
  if(tokens.has(token)||tokens.size>30)STOP("PAGINATION");
  tokens.add(token);
  const q=new URLSearchParams({pageSize:"1000"});
  if(token)q.set("pageToken",token);
  const d=await request("GET",BASE+"/"+version+"/files?"+q);
  if(!Array.isArray(d?.files)||d.files.length>1000||rows.length+d.files.length>20000)
   STOP("INVALID_FILES_PAGE");
  rows.push(...d.files);
  token=d.nextPageToken||"";
  if(typeof token!=="string"||token.length>3000)STOP("INVALID_TOKEN");
 }while(token);
 return rows;
}
export async function publishLoginSelfCheck({request,source,release=false,log=()=>{}}={}){
 if(typeof request!=="function"||typeof log!=="function"||typeof release!=="boolean")
  STOP("ARGS");
 const latest=async()=>latestName(await request("GET",RELEASES));
 const beforeVersion=await latest();
 const before=await request("GET",BASE+"/"+beforeVersion);
 const baseline=beforeVersion===BASE_VERSION?before:
  await request("GET",BASE+"/"+BASE_VERSION);
 if(before?.name!==beforeVersion||before.status!=="FINALIZED"||
    !before.config||Array.isArray(before.config)||
    baseline?.name!==BASE_VERSION||baseline.status!=="FINALIZED"||
    JSON.stringify(before.config)!==JSON.stringify(baseline.config))
  STOP("LIVE_CONFIG_NOT_REVIEWED");
 const baseFiles=await listFiles(request,BASE_VERSION);
 const liveFiles=beforeVersion===BASE_VERSION?baseFiles:
  await listFiles(request,beforeVersion);
 if(baseline.fileCount!=null&&Number(baseline.fileCount)!==baseFiles.length||
    before.fileCount!=null&&Number(before.fileCount)!==liveFiles.length)
  STOP("FILE_COUNT_MISMATCH");
 const plan=planLoginSelfCheck({
  baseVersion:BASE_VERSION,baseFiles,liveFiles,source
 });
 const changedSinceBaseline=[...plan.before].filter(([p,h])=>
  baseFiles.find(x=>x.path===p)?.hash?.toLowerCase()!==h).length;
 log("LOGIN_SELF_CHECK_PREFLIGHT "+JSON.stringify({
  oldHostingVersion:beforeVersion,
  existingFilesPreserved:18,
  existingHashesPreserved:true,
  changedSinceBaselinePreserved:changedSinceBaseline,
  filesAdded:1,path:NEW_PATH,
  firestoreWrites:0,financeRead:false,authChanged:false
 }));
 if(!release)return {released:false,oldVersion:beforeVersion,
  originalAssetsUnchanged:18,newAssets:1};
 if(await latest()!==beforeVersion)STOP("CONCURRENT_RELEASE_BEFORE_CREATE");
 const created=await request("POST",BASE+"/sites/"+SITE+"/versions",{config:before.config});
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  STOP("VERSION_NOT_CREATED");
 const response=await request("POST",BASE+"/"+created.name+":populateFiles",{
  files:Object.fromEntries(plan.after)
 });
 if(!response||typeof response!=="object"||
  !Array.isArray(response.uploadRequiredHashes)||
  response.uploadRequiredHashes.some(h=>!HASH.test(h)||h!==plan.newHash))
  STOP("UNREVIEWED_UPLOAD_HASH");
 const required=new Set(response.uploadRequiredHashes);
 if(required.size>1)STOP("UNEXPECTED_UPLOAD_COUNT");
 if(required.size){
  const uploadBase="https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+
   "/versions/"+created.name.split("/").at(-1)+"/";
  if(typeof response.uploadUrl!=="string"||
     !response.uploadUrl.startsWith(uploadBase))STOP("UPLOAD_URL_UNVERIFIED");
  for(const digest of required)
   await request("POST",response.uploadUrl+"/"+digest,plan.bytes,"application/octet-stream");
 }
 const done=await request("PATCH",BASE+"/"+created.name+"?update_mask=status",{
  status:"FINALIZED"
 });
 if(done?.name!==created.name||done.status!=="FINALIZED"||
    JSON.stringify(done.config)!==JSON.stringify(before.config))
  STOP("FINALIZED_CONFIG_MISMATCH");
 async function inspect(){
  const files=await listFiles(request,created.name);
  if(files.length!==19)STOP("FINAL_COUNT");
  const manifest=new Map(files.map(f=>[f.path,f.hash?.toLowerCase()]));
  if(manifest.size!==19||[...plan.after].some(([p,h])=>manifest.get(p)!==h))
   STOP("FINAL_MANIFEST_DRIFT");
 }
 await inspect();
 const v=await request("GET",BASE+"/"+created.name);
 if(v?.name!==created.name||v.status!=="FINALIZED"||
  JSON.stringify(v.config)!==JSON.stringify(before.config))
  STOP("FINAL_VERSION_CHANGED");
 if(await latest()!==beforeVersion)STOP("CONCURRENT_RELEASE_BEFORE_PUBLISH");
 const pub=await request("POST",BASE+"/sites/"+SITE+
  "/releases?versionName="+encodeURIComponent(created.name),{});
 if(pub?.version?.name!==created.name||await latest()!==created.name)
  STOP("PUBLIC_RELEASE_UNVERIFIED");
 await inspect();
 const report={released:true,verifiedHostingVersion:created.name,
  oldFilesPreserved:18,newFileCount:1,path:NEW_PATH,
  firestoreWrites:0,authUpdates:0,functionsUpdated:0,rulesUpdated:0};
 log("LOGIN_SELF_CHECK_ADDONE_RELEASED "+JSON.stringify(report));
 return report;
}
function safeUrl(method,url){
 if(!["GET","POST","PATCH"].includes(method))STOP("UNSUPPORTED_METHOD");
 let target;try{target=new URL(url)}catch{STOP("URL_INVALID")}
 const normal=target.origin==="https://firebasehosting.googleapis.com"&&
  target.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=target.origin==="https://upload-firebasehosting.googleapis.com"&&
  target.pathname.startsWith("/upload/sites/"+SITE+"/versions/");
 if(!normal&&!upload||target.username||target.password||target.hash)
  STOP("URL_ORIGIN_NOT_ALLOWED");
 if(upload&&method!=="POST")STOP("UPLOAD_METHOD");
 if(method==="PATCH"&&target.search!=="?update_mask=status")
  STOP("PATCH_SCOPE");
 if(method==="POST"&&!upload&&
  !(/\/versions$/.test(target.pathname)||/:populateFiles$/.test(target.pathname)||
    /\/releases$/.test(target.pathname)))STOP("POST_SCOPE");
 return target.href;
}
async function main(){
 const argv=process.argv.slice(2);
 if(argv.length!==1||!["--dry-run","--release"].includes(argv[0])||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("PRODUCTION_CONTEXT_UNVERIFIED");
 const release=argv[0]==="--release";
 if(release&&process.env.NICO_LOGIN_SELF_CHECK_RELEASE!==
    "APPROVE_SINGLE_READONLY_LOGIN_STATUS_PAGE")
  STOP("EXPLICIT_APPROVAL_REQUIRED");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const source=readFileSync(path.join(root,"staging/login-selfcheck-v1/login-self-check.html"),"utf8");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const cred=applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  const target=safeUrl(method,url);
  const access=(await cred.getAccessToken())?.access_token;
  if(typeof access!=="string"||access.length<20)STOP("ACCESS_TOKEN_MISSING");
  const opts={method,redirect:"error",headers:{Authorization:"Bearer "+access}};
  if(body!==null){
   opts.headers["Content-Type"]=type;
   opts.body=type==="application/octet-stream"?body:JSON.stringify(body);
  }
  const res=await fetch(target,opts);
  if(!res.ok)STOP("HTTP_"+res.status);
  const txt=await res.text();
  if(txt.length>4000000)STOP("EXCESS_RESPONSE");
  try{return txt?JSON.parse(txt):{}}catch{STOP("INVALID_JSON")}
 };
 const result=await publishLoginSelfCheck({request,source,release,log:console.log});
 console.log("LOGIN_SELF_CHECK_RESULT "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_LOGIN_SELF_CHECK_(?:GUARD|RELEASE)_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_LOGIN_SELF_CHECK_RELEASE_UNKNOWN");
  process.exitCode=1;
 });
