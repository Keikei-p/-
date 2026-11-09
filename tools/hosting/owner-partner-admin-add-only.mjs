#!/usr/bin/env node
/**
 * Add exactly four reviewed, count-only, one-login Owner portal assets to
 * the CURRENT Firebase Hosting version. The entire existing live manifest,
 * config, index, and partner pages are copied unchanged. No data/RULES/Fn API.
 */
import {readFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {prepareHubPortal,REVIEWED} from "../production/prepare-hub-owner-portal-static.mjs";
const SITE="nico-factory",PROJECT="sales-management-cc116";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const RELEASES=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const HASH=/^[a-f0-9]{64}$/;
const stop=x=>{throw Error("STOP_ADD_ONLY_OWNER_PORTAL_"+x);};
const canonical=new Set(["/index.html","/partner-workspace.html",
 "/partner-invite.html","/partner-counts.html","/finance-boundary-check.html"]);
const sha=data=>createHash("sha256").update(data).digest("hex");
const exactPaths=new Set([
 "/owner-partner-admin.html",
 "/owner-partner-admin-assets/mobile-bootstrap.mjs",
 "/owner-partner-admin-assets/owner-client.mjs",
 "/owner-partner-admin-assets/owner-ui.mjs"
]);
export function verifyAddOnlyManifest(files,newHashes){
 if(!Array.isArray(files)||files.length<5||files.length>30000||
   !(newHashes instanceof Map)||newHashes.size!==exactPaths.size||
   [...newHashes.keys()].some(k=>!exactPaths.has(k))||
   [...newHashes.values()].some(v=>typeof v!=="string"||!HASH.test(v)))
  stop("MANIFEST_INPUT");
 const original=new Map();
 for(const file of files){
  if(typeof file?.path!=="string"||!file.path.startsWith("/")||
     typeof file.hash!=="string"||!HASH.test(file.hash.toLowerCase())||
     original.has(file.path))stop("INVALID_LIVE_FILE");
  original.set(file.path,file.hash.toLowerCase());
 }
 if([...canonical].some(p=>!original.has(p)))stop("CANONICAL_ASSETS_MISSING");
 if([...exactPaths].some(p=>original.has(p)))stop("ALREADY_PUBLISHED_OR_PATH_COLLISION");
 const next=new Map([...original,...newHashes]);
 if(next.size!==original.size+4)stop("UNEXPECTED_MANIFEST_SIZE");
 for(const [p,h] of original)if(next.get(p)!==h)stop("CHANGED_EXISTING_ASSET");
 return Object.freeze({original,next});
}
async function readFiles(req,version){
 const list=[];let page="";const visited=new Set();
 do{
  if(visited.has(page))stop("REPEATED_PAGE_TOKEN");
  visited.add(page);
  const qs=new URLSearchParams({pageSize:"1000"});
  if(page)qs.set("pageToken",page);
  const result=await req("GET",BASE+"/"+version+"/files?"+qs);
  if(!Array.isArray(result?.files))stop("FILE_LIST_UNAVAILABLE");
  list.push(...result.files);
  if(list.length>30000)stop("TOO_MANY_ASSETS");
  page=result.nextPageToken||"";
 }while(page);
 return list;
}
export async function publishAddOnlyPortal({assets,request,release=false,log=()=>{}}){
 if(!assets||typeof assets!=="object"||Array.isArray(assets)||
   Object.keys(assets).length!==4||typeof request!=="function"||
   [...exactPaths].some(p=>typeof assets[p.slice(1)]!=="string"))
  stop("UNREVIEWED_ASSETS");
 const prepared=new Map();
 for(const [name,body] of Object.entries(assets)){
  const target="/"+name;
  if(!exactPaths.has(target)||body.length<100||body.length>120000)stop("ASSET_INVALID");
  const bytes=gzipSync(Buffer.from(body,"utf8"),{mtime:0});
  prepared.set(target,Object.freeze({hash:sha(bytes),bytes}));
 }
 const latest=async()=>{
  const result=await request("GET",RELEASES);
  if(!Array.isArray(result?.releases)||result.releases.length!==1||
     !VERSION.test(result.releases[0]?.version?.name))
   stop("NO_VERIFIED_LIVE_RELEASE");
  return result.releases[0].version.name;
 };
 const sourceName=await latest();
 const source=await request("GET",BASE+"/"+sourceName);
 if(source?.name!==sourceName||source.status!=="FINALIZED"||
   !source.config||typeof source.config!=="object")
  stop("LIVE_CONFIG_UNVERIFIED");
 const files=await readFiles(request,sourceName);
 if(source.fileCount!=null&&source.fileCount!==""&&
    Number(source.fileCount)!==files.length)
  stop("LIVE_MANIFEST_COUNT_UNVERIFIED");
 const manifest=verifyAddOnlyManifest(files,new Map(
  [...prepared].map(([name,part])=>[name,part.hash])
 ));
 log("OWNER_PORTAL_ADD_ONLY_PREFLIGHT "+JSON.stringify({
  oldFilesPreserved:manifest.original.size,newFiles:4,
  noReplacedPaths:true,productionDataWrites:0
 }));
 if(!release)return Object.freeze({released:false,oldFiles:manifest.original.size,
  reviewedNewAssets:4});
 if(await latest()!==sourceName)stop("LIVE_CHANGED_BEFORE_CREATE");
 const created=await request("POST",BASE+"/sites/"+SITE+"/versions",{config:source.config});
 if(!VERSION.test(created?.name)||created.status!=="CREATED")
  stop("NEW_VERSION_UNVERIFIED");
 const all=[...manifest.next.entries()],needed=new Set(),uploads=[];
 for(let i=0;i<all.length;i+=800){
  const body={files:Object.fromEntries(all.slice(i,i+800))};
  const result=await request("POST",BASE+"/"+created.name+":populateFiles",body);
  if(!result||typeof result!=="object"||
    result.uploadRequiredHashes!=null&&!Array.isArray(result.uploadRequiredHashes))
   stop("POPULATE_UNVERIFIED");
  if(result.uploadUrl)uploads.push(result.uploadUrl);
  for(const hash of result.uploadRequiredHashes||[]){
   if(typeof hash!=="string"||!HASH.test(hash.toLowerCase()))stop("INVALID_UPLOAD_HASH");
   needed.add(hash.toLowerCase());
  }
 }
 const uniqueUploads=new Set(uploads);
 if(uniqueUploads.size>1)stop("UNEXPECTED_UPLOAD_SERVERS");
 const uploadUrl=uploads[0]||"";
 const eligible=new Map([...prepared.values()].map(p=>[p.hash,p.bytes]));
 if([...needed].some(h=>!eligible.has(h)))stop("OLD_LIVE_BLOBS_NOT_REUSABLE");
 if(needed.size&&(!uploadUrl.startsWith(
    "https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+"/versions/")))
  stop("UPLOAD_HOST_UNVERIFIED");
 for(const hash of needed)
  await request("POST",uploadUrl+"/"+hash,eligible.get(hash),"application/octet-stream");
 const finalized=await request("PATCH",BASE+"/"+created.name+"?update_mask=status",
  {status:"FINALIZED"});
 if(finalized?.status!=="FINALIZED"||finalized.name!==created.name||
   JSON.stringify(finalized.config)!==JSON.stringify(source.config))
  stop("FINALIZED_CONFIG_UNVERIFIED");
 const finalFiles=await readFiles(request,created.name);
 const final=new Map();
 for(const f of finalFiles){
  if(typeof f.path!=="string"||!f.path.startsWith("/")||
     typeof f.hash!=="string"||!HASH.test(f.hash.toLowerCase())||
     final.has(f.path))stop("BAD_FINAL_MANIFEST");
  final.set(f.path,f.hash.toLowerCase());
 }
 if(final.size!==manifest.next.size||
   [...manifest.next].some(([p,h])=>final.get(p)!==h))
  stop("FINAL_MANIFEST_NOT_EXACT");
 const reread=await request("GET",BASE+"/"+created.name);
 if(reread?.status!=="FINALIZED"||reread.name!==created.name||
   JSON.stringify(reread.config)!==JSON.stringify(source.config))
  stop("FINAL_VERSION_UNVERIFIED");
 if(await latest()!==sourceName)stop("CONCURRENT_HOSTING_RELEASE");
 const published=await request("POST",
  BASE+"/sites/"+SITE+"/releases?versionName="+encodeURIComponent(created.name),{});
 if(published?.version?.name!==created.name)stop("LIVE_RELEASE_UNVERIFIED");
 log("OWNER_PORTAL_ADDED_FOUR_ASSETS_PRESERVED_"+manifest.original.size);
 return Object.freeze({released:true,oldFiles:manifest.original.size,newFiles:4});
}
async function main(){
 if(!["--dry-run","--release"].includes(process.argv[2])||
    process.argv.length!==3||process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  stop("RUN_CONTEXT_UNAPPROVED");
 const release=process.argv[2]==="--release";
 if(release&&process.env.NICO_OWNER_PORTAL_RELEASE_CONFIRMATION!==
    "CONFIRM_ADD_FOUR_NEW_COUNT_ONLY_ASSETS_ONLY")
  stop("EXPLICIT_RELEASE_APPROVAL_MISSING");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const source=Object.fromEntries(Object.keys(REVIEWED).map(p=>
  [p,readFileSync(path.join(root,p),"utf8")]));
 const assets=prepareHubPortal(source);
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credentials=applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  if(!["GET","POST","PATCH"].includes(method)||
     !(url.startsWith(BASE+"/sites/"+SITE+"/")||
       url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+"/versions/")))
   stop("HOSTING_URL_UNTRUSTED");
  const token=(await credentials.getAccessToken()).access_token;
  if(typeof token!=="string"||token.length<20)stop("OAUTH_UNAVAILABLE");
  const opts={method,headers:{Authorization:"Bearer "+token}};
  if(body!==null){
   opts.headers["Content-Type"]=type;
   opts.body=type==="application/octet-stream"?body:JSON.stringify(body);
  }
  const response=await fetch(url,{...opts,redirect:"error"});
  if(!response.ok)stop("HOSTING_HTTP_"+response.status);
  const txt=await response.text();
  return txt?JSON.parse(txt):{};
 };
 const report=await publishAddOnlyPortal({assets,request,release,log:console.log});
 console.log("OWNER_PORTAL_HOSTING "+JSON.stringify(report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_ADD_ONLY_OWNER_PORTAL_[A-Z0-9_]+$/.test(e?.message||"")?
    e.message:"STOP_ADD_ONLY_OWNER_PORTAL_UNKNOWN");
  process.exitCode=1;
 });
