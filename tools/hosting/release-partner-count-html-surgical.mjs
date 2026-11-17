#!/usr/bin/env node
/**
 * Single, immutable, reviewed Partner workspace HTML Hosting replacement.
 * Every other existing Hosting file and the full configuration are preserved.
 * No Firestore/Auth/Cloud Functions or Security Rules write capability.
 */
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {blobSha,uploadSha,uploadBytes}
 from "./owner-setup-additive-guard.mjs";

export const ASSET="/partner-workspace.html";
export const SITE="nico-factory";
const PROJECT="sales-management-cc116";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const HISTORY=Object.freeze([
 // Exact current published partner workspace page from reviewed main.
 "d8262633f35cf0f015de44c9a223c4289f8d2a6b"
]);
const stop=code=>{throw Error("STOP_PARTNER_COUNT_HTML_"+code)};
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function planSinglePartnerCountHtmlRelease({files,oldHashes,newHash,indexHash}={}){
 if(!Array.isArray(files)||files.length<20||files.length>30000||
    !Array.isArray(oldHashes)||oldHashes.length!==HISTORY.length||
    oldHashes.some(x=>typeof x!=="string"||!/^[0-9a-f]{64}$/.test(x))||
    typeof newHash!=="string"||!/^[0-9a-f]{64}$/.test(newHash)||
    typeof indexHash!=="string"||!/^[0-9a-f]{64}$/.test(indexHash))
  stop("UNVERIFIED_INPUT");
 const old=new Map();
 for(const row of files){
  if(!isObj(row)||typeof row.path!=="string"||
     !/^\/[A-Za-z0-9_.\/-]{1,300}$/.test(row.path)||
     typeof row.hash!=="string"||!/^[0-9a-f]{64}$/i.test(row.hash)||
     old.has(row.path))stop("INVALID_HOSTING_MANIFEST");
  old.set(row.path,row.hash.toLowerCase());
 }
 for(const required of ["/index.html","/partner-workspace.html",
  "/partner-invite.html","/partner-counts.html","/owner-partner-setup.html",ASSET])
  if(!old.has(required))stop("REQUIRED_HOSTING_FILE_MISSING");
 if(old.get("/index.html")!==indexHash)stop("EXISTING_SALES_APP_INDEX_CHANGED");
 const current=old.get(ASSET),already=current===newHash;
 if(!already&&!oldHashes.includes(current))stop("UNREVIEWED_OLD_PARTNER_HTML_HASH");
 const next=new Map(old);
 next.set(ASSET,newHash);
 if(next.size!==old.size||[...old].some(([p,hash])=>
     p!==ASSET&&next.get(p)!==hash))stop("CHANGED_UNRELATED_FILE");
 return Object.freeze({already,oldCount:old.size,oldHash:current,
  newHash,next});
}
async function execute({request,oldText,newText,indexText,release}={}){
 if(typeof request!=="function"||!Array.isArray(oldText)||
    oldText.length!==HISTORY.length||oldText.some(x=>typeof x!=="string")||
    typeof newText!=="string"||typeof indexText!=="string"||
    typeof release!=="boolean")stop("INVALID_DEPENDENCIES");
 if(blobSha(newText)!=="8dfac0b62102f60f84e703afe5d7bc56a1127973")
  stop("NEW_PARTNER_HTML_HASH_DRIFT");
 const latest=async()=>{
  const r=await request("GET",BASE+"/sites/"+SITE+"/releases?pageSize=1");
  const name=r?.releases?.[0]?.version?.name;
  if(!Array.isArray(r?.releases)||r.releases.length!==1||!VERSION.test(name||""))
   stop("LIVE_RELEASE_UNTRUSTED");
  return name;
 };
 const currentVersion=await latest();
 const cfg=await request("GET",BASE+"/"+currentVersion);
 if(!isObj(cfg)||cfg.name!==currentVersion||cfg.status!=="FINALIZED"||
    !isObj(cfg.config))stop("CURRENT_VERSION_INVALID");
 const originalFiles=[],seenTokens=new Set();let nextToken="",pages=0;
 do{
  if(++pages>30||seenTokens.has(nextToken))stop("PAGINATION_LOOP");
  seenTokens.add(nextToken);
  const qs=new URLSearchParams({pageSize:"1000"});
  if(nextToken)qs.set("pageToken",nextToken);
  const resp=await request("GET",BASE+"/"+currentVersion+"/files?"+qs);
  if(!Array.isArray(resp?.files)||resp.files.length>1000)stop("FILE_LIST_INVALID");
  originalFiles.push(...resp.files);
  nextToken=resp.nextPageToken||"";
  if(typeof nextToken!=="string"||nextToken.length>3000)stop("PAGE_TOKEN_INVALID");
 }while(nextToken);
 if(cfg.fileCount!=null&&cfg.fileCount!==""&&
    Number(cfg.fileCount)!==originalFiles.length)
  stop("FILECOUNT_DIFFERS_FROM_FULL_MANIFEST");
 // If Hosting omits fileCount, trust only the exact last reviewed production
 // version's fully enumerated 33-file manifest. Never guess newer versions.
 if((cfg.fileCount===undefined||cfg.fileCount===null||cfg.fileCount==="")&&
    (currentVersion!=="sites/nico-factory/versions/5858ba2ccd51ef74"||
     originalFiles.length!==33))
  stop("UNKNOWN_VERSION_WITHOUT_FILECOUNT");
 const liveAsset=originalFiles.find(row=>row?.path===ASSET);
 if(process.env.NICO_PARTNER_HASH_DIAGNOSTIC_ONLY==="true"){
  if(!liveAsset||typeof liveAsset.hash!=="string"||
     !/^[0-9a-f]{64}$/i.test(liveAsset.hash))
   stop("LIVE_PARTNER_HASH_INVALID");
  console.log("PARTNER_COUNT_HTML_READONLY_CURRENT "+JSON.stringify({
   version:currentVersion,path:ASSET,
   sha256:liveAsset.hash.toLowerCase(),fileCount:originalFiles.length,
   writeScope:"NONE"
  }));
 }
 const planned=planSinglePartnerCountHtmlRelease({files:originalFiles,
  oldHashes:oldText.map(uploadSha),newHash:uploadSha(newText),
  indexHash:uploadSha(indexText)});
 console.log("PARTNER_COUNT_HTML_MANIFEST "+JSON.stringify({
  sourceVersion:currentVersion,filesPreserved:planned.oldCount,
  priorSourceReviewed:!planned.already,alreadyPublished:planned.already,
  writeScope:release?"EXACT_ONE_PANEL":"NONE"
 }));
 if(planned.already||!release)return {released:false,already:planned.already,
  sourceVersion:currentVersion};
 if(await latest()!==currentVersion)stop("LIVE_VERSION_MOVED_PRE_CREATE");
 const created=await request("POST",BASE+"/sites/"+SITE+"/versions",
  {config:cfg.config});
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  stop("CREATE_UNEXPECTED");
 let uploadUrl=null;const needed=new Set();
 const entries=[...planned.next.entries()];
 for(let i=0;i<entries.length;i+=800){
  const part=await request("POST",BASE+"/"+created.name+":populateFiles",
   {files:Object.fromEntries(entries.slice(i,i+800))});
  if(!isObj(part)||!Array.isArray(part.uploadRequiredHashes??[]))
   stop("POPULATE_RESPONSE");
  for(const value of part.uploadRequiredHashes??[]){
   if(!/^[0-9a-f]{64}$/i.test(value))stop("UPLOAD_HASH_INVALID");
   needed.add(value.toLowerCase());
  }
  if(part.uploadUrl){
   if(typeof part.uploadUrl!=="string"||
      !part.uploadUrl.startsWith(
       "https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+"/versions/")||
      uploadUrl&&uploadUrl!==part.uploadUrl)stop("UPLOAD_URL_INVALID");
   uploadUrl=part.uploadUrl;
  }
 }
 if([...needed].some(x=>x!==planned.newHash)||needed.size>1)
  stop("OLDER_LIVE_BLOB_NOT_REUSABLE");
 if(needed.size===1){
  if(!uploadUrl)stop("UPLOAD_URL_MISSING");
  await request("POST",uploadUrl+"/"+planned.newHash,
   uploadBytes(newText),"application/octet-stream");
 }
 const final=await request("PATCH",
  BASE+"/"+created.name+"?update_mask=status",{status:"FINALIZED"});
 if(final?.name!==created.name||final.status!=="FINALIZED"||
    JSON.stringify(final.config)!==JSON.stringify(cfg.config))
  stop("FINALIZATION_INVALID");
 const all=[];let token="",page=0;const used=new Set();
 do{
  if(++page>30||used.has(token))stop("FINAL_MANIFEST_LOOP");
  used.add(token);
  const query=new URLSearchParams({pageSize:"1000"});
  if(token)query.set("pageToken",token);
  const body=await request("GET",BASE+"/"+created.name+"/files?"+query);
  if(!Array.isArray(body?.files))stop("FINAL_MANIFEST_MISSING");
  all.push(...body.files);token=body.nextPageToken||"";
 }while(token);
 if(all.length!==planned.next.size)stop("FINAL_FILES_COUNT");
 const observed=new Map();
 for(const row of all){
  if(typeof row.path!=="string"||typeof row.hash!=="string"||
     observed.has(row.path))stop("FINAL_FILE_DUPLICATE");
  observed.set(row.path,row.hash.toLowerCase());
 }
 for(const [p,hash] of planned.next)
  if(observed.get(p)!==hash)stop("FINAL_ASSET_HASH_MISMATCH");
 if(await latest()!==currentVersion)stop("LIVE_VERSION_MOVED_PRE_RELEASE");
 const posted=await request("POST",BASE+"/sites/"+SITE+"/releases?versionName="+
  encodeURIComponent(created.name),{});
 if(posted?.version?.name!==created.name)stop("RELEASE_NOT_CONFIRMED");
 console.log("PARTNER_COUNT_HTML_HOSTING_RELEASED "+created.name+
  " PRESERVED_ASSETS="+String(planned.oldCount-1));
 return {released:true,already:false,version:created.name};
}
export {execute as runSurgicalPartnerCountHtmlRelease};
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==1||!["--dry-run","--release"].includes(args[0])||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PARTNER_COUNT_HTML_RELEASE!=="CONFIRM_SINGLE_PARTNER_WORKSPACE_HTML_ONLY"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  stop("UNAPPROVED_EXECUTION");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const oldText=HISTORY.map(sha=>{
  const data=execFileSync("git",["cat-file","blob",sha],
   {cwd:root,encoding:"utf8",maxBuffer:200000,stdio:["ignore","pipe","pipe"]});
  if(blobSha(data)!==sha)stop("OLD_SOURCE_DRIFT");
  return data;
 });
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const cred=applicationDefault();
 const request=async(method,url,body=null,kind="application/json")=>{
  if(!(url.startsWith(BASE+"/sites/"+SITE+"/")||
       url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+"/versions/")))
   stop("EXTERNAL_URL_NOT_APPROVED");
  const token=(await cred.getAccessToken())?.access_token;
  if(!token)stop("NO_AUTH");
  const headers={Authorization:"Bearer "+token};
  if(body!==null)headers["Content-Type"]=kind;
  const response=await fetch(url,{method,headers,redirect:"error",
   body:body===null?undefined:kind==="application/octet-stream"?
    body:JSON.stringify(body)});
  if(!response.ok)stop("HOSTING_API_HTTP_"+response.status);
  const raw=await response.text();
  return raw?JSON.parse(raw):{};
 };
 const result=await execute({request,oldText,
  newText:readFileSync(path.join(root,ASSET.slice(1)),"utf8"),
  indexText:readFileSync(path.join(root,"index.html"),"utf8"),
  release:args[0]==="--release"});
 console.log("PARTNER_COUNT_HTML_OUTCOME "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(/^STOP_PARTNER_COUNT_HTML_[A-Z0-9_]+$/.test(e?.message||"")?
  e.message:"STOP_PARTNER_COUNT_HTML_FAILED");process.exitCode=1});
