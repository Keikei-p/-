#!/usr/bin/env node
/**
 * The sole approved Hosting change: old Owner entry HTML -> main Owner-only entry.
 * Preserve the exact existing 32 other immutable file digests and Hosting config.
 * No Auth, Rules, Functions, finance, Firestore, Artifact Registry or IAM mutations.
 */
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {SOURCES,uploadSha} from "./owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS} from "./owner-only-setup-replacement-guard.mjs";
import {planOwnerEntryOneFile} from "./owner-entry-one-file-guard.mjs";
import {readPublishedOwnerSetupSources} from "../production/inspect-owner-setup-release-chain-readonly.mjs";

const PROJECT="sales-management-cc116",SITE="nico-factory";
const API="https://firebasehosting.googleapis.com/v1beta1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const stop=x=>{throw Error("STOP_OWNER_ONE_HTML_RELEASE_"+x);};
const URLS=Object.freeze({latest:API+"/sites/"+SITE+"/releases?pageSize=1"});
function versionName(doc){
 const rows=doc?.releases;
 const name=rows?.[0]?.version?.name;
 if(!Array.isArray(rows)||rows.length!==1||!VERSION.test(name||""))stop("ACTIVE_VERSION_UNKNOWN");
 return name;
}
async function manifest(request,name){
 const files=[],seen=new Set();let token="",pages=0;
 do{
  if(++pages>50||seen.has(token))stop("MANIFEST_PAGING");
  seen.add(token);
  const p=new URLSearchParams({pageSize:"1000"});
  if(token)p.set("pageToken",token);
  const result=await request("GET",API+"/"+name+"/files?"+p);
  if(!Array.isArray(result?.files)||result.files.length>1000||
     files.length+result.files.length>20000)stop("MANIFEST_INVALID");
  files.push(...result.files);
  token=result.nextPageToken||"";
  if(typeof token!=="string"||token.length>3000)stop("MANIFEST_TOKEN");
 }while(token);
 return files;
}
function exactManifest(rows,expected){
 const map=new Map();
 for(const file of rows){
  if(typeof file?.path!=="string"||typeof file.hash!=="string"||
     map.has(file.path))stop("NEW_MANIFEST_INVALID");
  map.set(file.path,file.hash.toLowerCase());
 }
 if(map.size!==expected.size||
   [...expected].some(([file,hash])=>map.get(file)!==hash))
  stop("NEW_MANIFEST_DRIFT");
}
export async function releaseOwnerEntryOneFile({request,historicalSources,candidateSources,
 release=false,log=()=>{},publicGet}={}){
 if(typeof request!=="function"||typeof release!=="boolean"||typeof log!=="function"||
    (release&&typeof publicGet!=="function"))
  stop("ARGUMENTS");
 const latest=async()=>versionName(await request("GET",URLS.latest));
 const original=await latest();
 const meta=await request("GET",API+"/"+original);
 if(meta?.name!==original||meta.status!=="FINALIZED"||
    !meta.config||typeof meta.config!=="object"||Array.isArray(meta.config))
  stop("LIVE_CONFIG_UNVERIFIED");
 const files=await manifest(request,original);
 if(meta.fileCount!=null&&Number(meta.fileCount)!==files.length)
  stop("LIVE_MANIFEST_FILECOUNT");
 const plan=planOwnerEntryOneFile({liveFiles:files,historicalSources,candidateSources});
 if(plan.changedPaths.length!==1||plan.existingFilesPreserved!==32)
  stop("SOURCE_SCOPE");
 log("OWNER_ONE_HTML_LIVE_PREFLIGHT "+JSON.stringify({
  fileCount:files.length,oneHtmlOnly:true,remaining32Preserved:true,
  existingCurrentJs:3,productionDocumentWrites:0,backendLoginNotProven:true
 }));
 if(!release)return Object.freeze({
  released:false,reviewedManifest:true,
  liveAssets:files.length,preserved:32,changed:0,
  ownerLoginVerified:false,documentWrites:0
 });
 if(await latest()!==original)stop("OTHER_RELEASE_BEFORE_CREATE");
 const created=await request("POST",API+"/sites/"+SITE+"/versions",{config:meta.config});
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  stop("CREATED_VERSION_NOT_VERIFIED");
 const payloads=Object.fromEntries(plan.proposedManifest);
 const populated=await request("POST",API+"/"+created.name+":populateFiles",{files:payloads});
 if(!populated||!Array.isArray(populated.uploadRequiredHashes))
  stop("UPLOAD_REQUIREMENTS_UNVERIFIED");
 if(populated.uploadRequiredHashes.length>1||
    populated.uploadRequiredHashes.some(sha=>sha!==plan.newHtmlHash))
  stop("UNREVIEWED_UPLOAD_REQUIRED");
 if(populated.uploadRequiredHashes.length){
  const url=populated.uploadUrl;
  const prefix="https://upload-firebasehosting.googleapis.com/upload/sites/"+
   SITE+"/versions/"+created.name.split("/").at(-1)+"/";
  if(typeof url!=="string"||!url.startsWith(prefix))
   stop("UPLOAD_ORIGIN_UNVERIFIED");
  await request("POST",url.replace(/\/$/,"")+"/"+plan.newHtmlHash,
   null,"application/octet-stream",candidateSources["owner-partner-setup.html"]);
 }
 const finalized=await request("PATCH",API+"/"+created.name+"?update_mask=status",{
  status:"FINALIZED"
 });
 if(finalized?.name!==created.name||finalized.status!=="FINALIZED"||
    JSON.stringify(finalized.config)!==JSON.stringify(meta.config))
  stop("FINALIZED_CONFIG_CHANGED");
 exactManifest(await manifest(request,created.name),plan.proposedManifest);
 if(await latest()!==original)stop("OTHER_RELEASE_BEFORE_PUBLISH");
 let didPublish=false;
 try{
  const published=await request("POST",API+"/sites/"+SITE+"/releases?versionName="+
   encodeURIComponent(created.name),{});
  didPublish=true;
  if(published?.version?.name!==created.name)stop("PUBLISH_RESPONSE");
  if(await latest()!==created.name)stop("PUBLISHED_VERSION_CHANGED");
  exactManifest(await manifest(request,created.name),plan.proposedManifest);
  let visible=false;
  for(let i=0;i<6;i++){
   try{if(await publicGet()===candidateSources["owner-partner-setup.html"]){visible=true;break;}}catch{}
   if(i<5)await new Promise(resolve=>setTimeout(resolve,3000));
  }
  if(!visible)stop("PUBLIC_OWNER_ENTRY_NOT_VERIFIED");
 }catch(e){
  // Restore the previous immutable Hosting version only if our release is still live.
  {
   let current=null;
   try{current=await latest();}catch{}
   if(current===created.name){
    try{
     await request("POST",API+"/sites/"+SITE+"/releases?versionName="+
      encodeURIComponent(original),{});
     if(await latest()!==original)stop("ROLLBACK_NOT_ACTIVE");
     log("OWNER_ONE_HTML_PREVIOUS_VERSION_RESTORED");
    }catch{stop("POST_PUBLISH_ROLLBACK_UNVERIFIED");}
   }
  }
  throw e;
 }
 log("OWNER_ONE_HTML_RELEASE_PASS "+JSON.stringify({
  released:true,changedPaths:["/owner-partner-setup.html"],
  preservedAssets:32,allOtherHashesExact:true,
  originalConfigPreserved:true,documentWrites:0,
  functionsRulesAuthUntouched:true,realOwnerLoginStillNeedsTest:true
 }));
 return Object.freeze({
  released:true,previousVersion:original,newVersion:created.name,
  documentWrites:0,preservedAssets:32,realOwnerLoginVerified:false
 });
}
function allowed(method,uri,type){
 let url;try{url=new URL(uri);}catch{stop("INVALID_URL");}
 const host=url.origin==="https://firebasehosting.googleapis.com"&&
  url.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=url.origin==="https://upload-firebasehosting.googleapis.com"&&
  url.pathname.startsWith("/upload/sites/"+SITE+"/versions/");
 if(!host&&!upload)stop("URL_OUT_OF_SCOPE");
 if(upload&&(method!=="POST"||type!=="application/octet-stream"))stop("UPLOAD_METHOD");
 if(!upload&&method!=="GET"&&method!=="POST"&&method!=="PATCH")
  stop("METHOD");
 if(!upload&&method==="PATCH"&&url.search!=="?update_mask=status")
  stop("PATCH_UNREVIEWED");
 if(!upload&&method==="POST"&&!(/\/versions$/.test(url.pathname)||
    /:populateFiles$/.test(url.pathname)||/\/releases$/.test(url.pathname)))
  stop("POST_UNREVIEWED");
 return url.href;
}
async function main(){
 const argv=process.argv.slice(2);
 if(argv.length!==1||!["--inspect","--release"].includes(argv[0])||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)stop("RUNTIME_SCOPE");
 const release=argv[0]==="--release";
 if(release&&process.env.NICO_OWNER_ONE_HTML_APPROVAL!=="APPROVE_ONE_REVIEWED_OWNER_HTML_ONLY")
  stop("RELEASE_APPROVAL");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const candidateSources=Object.fromEntries(Object.keys(OWNER_ONLY_REPLACEMENTS)
  .map(file=>[file,readFileSync(path.join(root,file),"utf8")]));
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const credential=require("firebase-admin/app").applicationDefault();
 const request=async(method,uri,body=null,type="application/json",raw=null)=>{
  const target=allowed(method,uri,type);
  const token=(await credential.getAccessToken())?.access_token;
  if(typeof token!=="string"||token.length<30)stop("MISSING_AUTH");
  const headers={Authorization:"Bearer "+token};
  const init={method,headers,redirect:"error",cache:"no-store"};
  if(body!==null||raw!==null){
   headers["Content-Type"]=type;
   init.body=raw!==null?Buffer.from(raw,"utf8"):JSON.stringify(body);
  }
  const resp=await fetch(target,init);
  if(!resp.ok)stop("HOSTING_HTTP_"+resp.status);
  const payload=await resp.text();
  if(payload.length>12000000)stop("RESULT_TOO_LARGE");
  try{return payload?JSON.parse(payload):{};}catch{stop("HOSTING_JSON");}
 };
 const publicGet=async()=>{
  const uri="https://nico-factory.web.app/owner-partner-setup.html?owner_release="+Date.now();
  const response=await fetch(uri,{method:"GET",cache:"no-store",redirect:"error",headers:{"Cache-Control":"no-cache"}});
  if(response.status!==200)stop("PUBLIC_OWNER_HTML_HTTP");
  const text=await response.text();
  if(text.length>150000)stop("PUBLIC_OWNER_HTML_TOO_LARGE");
  return text;
 };
 await releaseOwnerEntryOneFile({
  request,historicalSources:readPublishedOwnerSetupSources(),
  candidateSources,release,log:console.log,publicGet
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_(?:ONE_HTML_RELEASE|ENTRY_ONE_FILE)_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_ONE_HTML_RELEASE_UNVERIFIED");
  process.exitCode=1;
 });
