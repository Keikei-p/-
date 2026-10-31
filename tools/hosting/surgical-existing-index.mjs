#!/usr/bin/env node
/**
 * Surgical, additive release of /index.html onto the existing NICO Hosting
 * live site. Never replace the existing index.html, PWA, scripts, routes or headers.
 * Strictly requires explicit --release and live version recheck immediately before
 * publishing. Dry-run is read-only.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS from a protected runner secret.
 * Firebase Hosting REST API is the only remote write path; Firestore, Auth,
 * Functions, Rules and LINE are never accessed.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const SITE="nico-factory", PROJECT="sales-management-cc116";
export const ASSET="/index.html";
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const allowedVersion=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;

export function validateManifest(oldFiles, additions, expectedCount) {
 if(!Array.isArray(oldFiles)||!Number.isSafeInteger(expectedCount)||expectedCount<1||
   oldFiles.length!==expectedCount)throw Error("SOURCE_FILE_COUNT_MISMATCH");
 const original=new Map();
 for(const f of oldFiles){
  if(typeof f.path!=="string"||!f.path.startsWith("/")||
     typeof f.hash!=="string"||!/^[0-9a-f]{64}$/i.test(f.hash)||
     original.has(f.path))throw Error("INVALID_SOURCE_MANIFEST");
  original.set(f.path,f.hash.toLowerCase());
 }
 if(!original.has("/index.html"))throw Error("LIVE_INDEX_MISSING");
 if(!original.has(ASSET))throw Error("LIVE_INDEX_MISSING");
 if(!(additions instanceof Map)||additions.size!==1||
    !additions.has(ASSET)||!/^[0-9a-f]{64}$/.test(additions.get(ASSET)))
   throw Error("ONLY_ONE_REPLACED_INDEX_ALLOWED");
 const next=new Map(original);
 for(const [k,v] of additions)next.set(k,v);
 if(next.get(ASSET)===original.get(ASSET))throw Error("NO_INDEX_CHANGE");
 for(const [k,v] of original)if(k!==ASSET&&next.get(k)!==v)
   throw Error("OTHER_EXISTING_FILE_MODIFIED");
 if(next.size!==expectedCount)throw Error("UNEXPECTED_FILE_COUNT");
 return {original,next};
}

export async function uploadSingleExistingIndex({assetBytes,request,release=false,log=console.log}){
 if(!Buffer.isBuffer(assetBytes)||assetBytes.length<500||
   !assetBytes.toString("utf8").includes("mergedPartnerRankingDay")||
   !assetBytes.toString("utf8").includes("partnerInviteInline")||
   !assetBytes.toString("utf8").includes("営業実績管理"))
   throw Error("INVALID_INDEX_ASSET");
 const gz=gzipSync(assetBytes,{mtime:0});
 const hash=createHash("sha256").update(gz).digest("hex");
 const url=s=>BASE+s;
 const latest=async()=>{
  const response=await request("GET",url("/sites/"+SITE+"/releases?pageSize=1"));
  const releases=response.releases;
  if(!Array.isArray(releases)||releases.length!==1||
     !allowedVersion.test(releases[0]?.version?.name))
   throw Error("LIVE_HOSTING_RELEASE_NOT_VERIFIABLE");
  return releases[0].version.name;
 };
 const sourceName=await latest();
 const source=await request("GET",url("/"+sourceName));
 // The live Hosting API can omit fileCount for an otherwise finalized
 // version. This field is metadata, not a source-file security proof.
 // Never accept a non-finalized version or missing original Hosting config.
 if(source.status!=="FINALIZED"||source.name!==sourceName||
    !source.config||typeof source.config!=="object")
  throw Error("BAD_LIVE_VERSION status="+String(source.status)+
    " nameMatches="+String(source.name===sourceName)+
    " hasConfig="+String(!!source.config)+
    " reportedCount="+String(source.fileCount??"absent"));
 const files=[];let pageToken="";
 do{
  const qs=new URLSearchParams({pageSize:"1000"});
  if(pageToken)qs.set("pageToken",pageToken);
  const page=await request("GET",url("/"+sourceName+"/files?"+qs));
  if(!Array.isArray(page.files))throw Error("SOURCE_FILE_LIST_UNAVAILABLE");
  files.push(...page.files);
  pageToken=page.nextPageToken||"";
  if(files.length>30000)throw Error("TOO_MANY_LIVE_ASSETS");
 }while(pageToken);
 // Require all known approved pages on the original live site. If fileCount
 // is unavailable, the complete paginated manifest, unchanged hashes,
 // stored config and final live version recheck supply the safety contract.
 const requiredLivePages=["/index.html","/partner-invite.html",
   "/partner-counts.html","/partner-workspace.html"];
 const names=new Set(files.map(file=>file.path));
 if(!requiredLivePages.every(file=>names.has(file)))
   throw Error("REQUIRED_ORIGINAL_PAGE_MISSING");
 const sourceCount=Number(source.fileCount);
 if(Number.isSafeInteger(sourceCount)&&sourceCount>0&&sourceCount!==files.length)
   throw Error("SOURCE_COUNT_METADATA_CONFLICT");
 if(!Number.isSafeInteger(sourceCount)||sourceCount<1)
   log("Source fileCount metadata absent; validating full manifest with "+files.length+" paths");
 const {next,original}=validateManifest(files,new Map([[ASSET,hash]]),files.length);
 log("Verified live version and original files: "+sourceName+" / "+original.size);
 log("Replacing ONLY existing /index.html; unchanged other assets: "+(original.size-1));
 if(!release) return {released:false,sourceName,originalCount:original.size,newHash:hash};
 if(await latest()!==sourceName)throw Error("LIVE_CHANGED_BEFORE_CREATE");
 const created=await request("POST",url("/sites/"+SITE+"/versions"),{config:source.config});
 if(!allowedVersion.test(created?.name)||created.status!=="CREATED")
  throw Error("UNEXPECTED_NEW_VERSION");
 const entries=[...next.entries()];
 let uploadUrl=null,needed=new Set();
 for(let i=0;i<entries.length;i+=800){
  const resp=await request("POST",url("/"+created.name+":populateFiles"),
   {files:Object.fromEntries(entries.slice(i,i+800))});
  // Hosting omits uploadRequiredHashes when every asset hash is already stored
  // (e.g. after a prior finalized-but-unreleased attempt). It is optional.
  if(resp===null||typeof resp!=="object"||
     (resp.uploadRequiredHashes!==undefined&&
      !Array.isArray(resp.uploadRequiredHashes)))
   throw Error("BAD_POPULATE_RESULT");
  for(const h of (resp.uploadRequiredHashes??[])){
   if(typeof h!=="string"||!/^[0-9a-f]{64}$/i.test(h))
    throw Error("BAD_REQUIRED_UPLOAD_HASH");
   needed.add(h.toLowerCase());
  }
  if(resp.uploadUrl){ if(uploadUrl&&uploadUrl!==resp.uploadUrl)throw Error("UPLOAD_URL_MISMATCH");uploadUrl=resp.uploadUrl; }
 }
 if([...needed].some(h=>h!==hash)||needed.size>1)throw Error("OLD_LIVE_BLOB_NOT_REUSABLE: abort");
 if(needed.has(hash)){
  if(typeof uploadUrl!=="string"||!uploadUrl.startsWith("https://upload-firebasehosting.googleapis.com/"))
   throw Error("UNTRUSTED_UPLOAD_URL");
  await request("POST",uploadUrl+"/"+hash,gz,"application/octet-stream");
 }
 const finalized=await request("PATCH",url("/"+created.name+"?update_mask=status"),{status:"FINALIZED"});
 if(finalized?.status!=="FINALIZED"||finalized.name!==created.name)
  throw Error("FINAL_VERSION_NOT_CONFIRMED");
 if(JSON.stringify(finalized.config)!==JSON.stringify(source.config))
  throw Error("LIVE_HOSTING_CONFIG_CHANGED");
 // The Hosting API's version.fileCount can temporarily disagree with the
 // visible final file manifest. Never publish based on metadata alone:
 // fetch every finalized path and hash, and enforce exact full equality.
 const finalFiles=[];
 let finalPageToken="";
 const finalTokens=new Set();
 do{
  if(finalTokens.has(finalPageToken))throw Error("FINAL_FILE_PAGE_LOOP");
  finalTokens.add(finalPageToken);
  const qs=new URLSearchParams({pageSize:"1000"});
  if(finalPageToken)qs.set("pageToken",finalPageToken);
  const response=await request("GET",url("/"+created.name+"/files?"+qs));
  if(!Array.isArray(response.files))throw Error("FINAL_FILE_LIST_UNAVAILABLE");
  finalFiles.push(...response.files);
  if(finalFiles.length>30000)throw Error("FINAL_TOO_MANY_FILES");
  finalPageToken=response.nextPageToken||"";
 }while(finalPageToken);
 const finalMap=new Map();
 for(const file of finalFiles){
  if(typeof file.path!=="string"||typeof file.hash!=="string"||
     !/^[0-9a-f]{64}$/i.test(file.hash)||finalMap.has(file.path))
    throw Error("FINAL_INVALID_FILE_MANIFEST");
  finalMap.set(file.path,file.hash.toLowerCase());
 }
 if(finalMap.size!==next.size)
  throw Error("FINAL_ASSET_COUNT_MISMATCH expected="+next.size+
    " api="+String(finalized.fileCount??"unreported")+
    " enumerated="+finalMap.size);
 for(const [filePath,expectedHash] of next)
  if(finalMap.get(filePath)!==expectedHash)
   throw Error("FINAL_ASSET_HASH_MISMATCH for "+filePath);
 if(Number(finalized.fileCount)!==next.size)
  log("Metadata count differs; safely validated all "+next.size+
   " finalized file paths and hashes individually");
 // Only the previously confirmed on-site configuration is permitted.
 const finalRead=await request("GET",url("/"+created.name));
 if(finalRead?.status!=="FINALIZED"||finalRead.name!==created.name||
    JSON.stringify(finalRead.config)!==JSON.stringify(source.config))
  throw Error("FINAL_VERSION_CONFIG_UNVERIFIED");
 // Most important guard: no one may have replaced live since this run began.
 if(await latest()!==sourceName)throw Error("LIVE_CHANGED_BEFORE_RELEASE");
 const released=await request("POST",url("/sites/"+SITE+"/releases?versionName="+
  encodeURIComponent(created.name)),{});
 if(released?.version?.name!==created.name)throw Error("LIVE_RELEASE_NOT_CONFIRMED");
 log("Released additive existing sales index only: "+created.name);
 return {released:true,sourceName,releaseName:released.name,newVersion:created.name,originalCount:original.size};
}

async function run(){
 // argv[0] is the Node binary and argv[1] is this script path.
 // Treat only user supplied flags as arguments (the live release previously
 // stopped at dry-run because it incorrectly rejected these two).
 const args=process.argv.slice(2);
 const release=args.includes("--release");
 if(args.some(a=>!["--dry-run","--release"].includes(a)))throw Error("UNKNOWN_ARGUMENT");
 if(args.includes("--dry-run")&&release)throw Error("CONFLICTING_FLAGS");
 if(release&&process.env.NICO_PARTNER_RELEASE_CONFIRMATION!=="CONFIRM_ADD_PARTNER_RANKING_INDEX_ONLY")
  throw Error("RELEASE_CONFIRMATION_REQUIRED");
 if(!process.env.GOOGLE_APPLICATION_CREDENTIALS)
  throw Error("GOOGLE_APPLICATION_CREDENTIALS_REQUIRED");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  if(!(url.startsWith(BASE+"/sites/"+SITE+"/")||
        url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+"/versions/")))
   throw Error("UNAPPROVED_HOSTING_ENDPOINT");
  const {access_token}=await credential.getAccessToken();
  const headers={Authorization:"Bearer "+access_token};
  if(body!==null)headers["Content-Type"]=type;
  const opts={method,headers};
  if(body!==null)opts.body=type==="application/octet-stream"?body:JSON.stringify(body);
  const result=await fetch(url,opts);
  if(!result.ok)throw Error("HOSTING_API_FAILURE "+method+" HTTP "+result.status);
  const txt=await result.text();
  return txt?JSON.parse(txt):{};
 };
 const asset=readFileSync(new URL("../../index.html",import.meta.url));
 const output=await uploadSingleExistingIndex({assetBytes:asset,request,release});
 console.log(JSON.stringify({outcome:output.released?"RELEASED":"DRY_RUN_OK",oldVersion:output.sourceName,keptOriginalFiles:output.originalCount}));
 if(output.released){
  const page=await fetch("https://"+SITE+".web.app"+ASSET,{redirect:"manual",cache:"no-store"});
  if(!page.ok||!((await page.text()).includes("partnerInviteInline")))
    throw Error("POST_DEPLOY_COUNTS_PAGE_UNVERIFIED");
  console.log("POST_DEPLOY_HTTP_OK "+ASSET);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 run().catch(e=>{console.error("STOP "+e.message);process.exitCode=1;});
}
