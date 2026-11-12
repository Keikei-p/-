/**
 * Staged Owner ON/OFF Hosting two-asset publisher.
 *
 * This module has NO implicit network access or deployment entrypoint.
 * Any caller must independently verify human review, role/finance security,
 * backup/rollback and exact main HEAD before injecting an authenticated
 * Hosting request function with release=true.
 *
 * This is an additive Hosting-only operation. NO Firestore, Functions, Auth,
 * Rules or finance data writes. Rejects any attempt to replace live bytes.
 */
import {
 inspectLiveOwnerOnOffHosting,OWNER_ONOFF_HOSTING_BASE
} from "./inspect-owner-onoff-hosting-readonly.mjs";
import {
 ONOFF_ASSETS,planOwnerOnOffAssets,hostingAssetHash
} from "./owner-product-onoff-additive-guard.mjs";
import {gzipSync} from "node:zlib";

const SITE="nico-factory";
const BASE=OWNER_ONOFF_HOSTING_BASE;
const LATEST=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const HEX=/^[a-f0-9]{64}$/;
const ADD=Object.freeze([
 "/owner-product-publication.html",
 "/ranking/owner-product-visibility-dashboard-mount.mjs"
]);
const stop=code=>{throw Error("STOP_OWNER_ONOFF_TWO_ASSET_RELEASE_"+code);};
const same=(x,y)=>x.length===y.length&&
 x.every(a=>y.includes(a))&&new Set(x).size===x.length;
function newest(payload){
 const v=payload?.releases?.[0]?.version?.name;
 if(!Array.isArray(payload?.releases)||payload.releases.length!==1||
    !VERSION.test(v||""))stop("LATEST_UNKNOWN");
 return v;
}
async function filesOf(request,version){
 const rows=[];let token="";const seen=new Set();
 do{
  if(seen.has(token)||seen.size>=35)stop("PAGINATION");
  seen.add(token);
  const qs=new URLSearchParams({pageSize:"1000"});
  if(token)qs.set("pageToken",token);
  const response=await request("GET",BASE+"/"+version+"/files?"+qs);
  if(!Array.isArray(response?.files)||response.files.length>1000||
     rows.length+response.files.length>30000)stop("MANIFEST_SIZE");
  rows.push(...response.files);
  token=response.nextPageToken??"";
  if(typeof token!=="string"||token.length>3000)stop("PAGINATION_TOKEN");
 }while(token);
 return rows;
}
function verifyMeta(meta,version,n){
 if(meta?.name!==version||meta.status!=="FINALIZED"||
    !meta.config||typeof meta.config!=="object"||
    Array.isArray(meta.config)||!Number.isSafeInteger(Number(meta.fileCount))||
    Number(meta.fileCount)!==n)stop("LIVE_META_CHANGED");
}
function exactNewFiles(plan,releaseAllowed=false){
 if(!same(plan.newAssetPaths,ADD))stop("NOT_EXACT_TWO_NEW_FILES");
 if(plan.status!=="REVIEWED_OFFLINE_ADD_ONLY"||
    plan.proposedManifest.size!==plan.originalManifest.size+2)
   stop("NOT_AN_ADDITION");
 if(releaseAllowed!==false && releaseAllowed!==true)stop("RELEASE_FLAG");
}
function uploadTarget(created,uploadUrl){
 const prefix="https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+
  "/versions/"+created.split("/").at(-1)+"/";
 if(typeof uploadUrl!=="string"||!uploadUrl.startsWith(prefix))
  stop("UPLOAD_TARGET");
 const parsed=new URL(uploadUrl);
 if(parsed.username||parsed.password||parsed.hash||parsed.search)
  stop("UPLOAD_TARGET_QUERY");
 return uploadUrl.replace(/\/$/,"");
}
/**
 * Dry run: GET only. release:true only after ALL external security/review
 * checks are independently proven by the caller. No automatic release wiring.
 */
export async function prepareOwnerOnOffTwoAssetRelease({
 request,sources,release=false,releaseAuthorized=false,log=()=>{},
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
 if(typeof request!=="function"||typeof log!=="function"||
    typeof release!=="boolean"||typeof releaseAuthorized!=="boolean"||
    typeof sleep!=="function")
   stop("INPUT");
 if(release&&releaseAuthorized!==true)stop("INDEPENDENT_APPROVAL_MISSING");
 const GET=url=>request("GET",url);
 const inspected=await inspectLiveOwnerOnOffHosting({
  readOnlyGet:GET,sources
 });
 const original=inspected.version;
 const meta=await GET(BASE+"/"+original);
 const liveFiles=await filesOf(request,original);
 verifyMeta(meta,original,liveFiles.length);
 const plan=planOwnerOnOffAssets({liveFiles,sources});
 exactNewFiles(plan);
 if(inspected.version!==original||!same(inspected.newAssetPaths,plan.newAssetPaths))
  stop("INVENTORY_DRIFT");
 if(newest(await GET(LATEST))!==original)stop("RACE_BEFORE_PLAN");
 const preflight=Object.freeze({
  baseVersion:original,originalFilesPreserved:liveFiles.length,
  newPaths:Object.freeze([...ADD]),existingFilesReplaced:0,
  firestoreWrites:0,functionsWrites:0,rulesWrites:0,
  released:false
 });
 log("OWNER_ONOFF_TWO_ASSET_PREFLIGHT "+JSON.stringify(preflight));
 if(!release)return preflight;

 // A successful dry-run is NOT authorization for an unchecked later run.
 if(newest(await GET(LATEST))!==original)stop("RACE_BEFORE_CREATE");
 const created=await request("POST",BASE+"/sites/"+SITE+"/versions",
  {config:meta.config});
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED"||
    created.name===original)stop("NEW_VERSION_UNVERIFIED");
 const entries=[...plan.proposedManifest.entries()];
 const necessary=new Set();let url=null;
 for(let offset=0;offset<entries.length;offset+=800){
  const payload={files:Object.fromEntries(entries.slice(offset,offset+800))};
  const outcome=await request("POST",BASE+"/"+created.name+":populateFiles",payload);
  // Protobuf JSON omits empty repeated fields: all hashes may already
  // exist in Hosting storage after an earlier unpublished version. Omission
  // is NOT permission to skip verifying each finalized file hash below.
  if(!outcome||typeof outcome!=="object"||Array.isArray(outcome)||
     (outcome.uploadRequiredHashes!=null&&
      !Array.isArray(outcome.uploadRequiredHashes))||
     (outcome.uploadRequiredHashes==null&&
      typeof outcome.uploadUrl!=="string"))
   stop("UPLOAD_INVENTORY_UNKNOWN");
  log("OWNER_ONOFF_POPULATE_RESPONSE "+JSON.stringify({
   hashListPresent:Array.isArray(outcome.uploadRequiredHashes),
   uploadTargetPresent:typeof outcome.uploadUrl==="string",
   requiredCount:outcome.uploadRequiredHashes?.length??0
  }));
  if(outcome.uploadUrl!=null){
   const candidate=uploadTarget(created.name,outcome.uploadUrl);
   if(url!==null&&url!==candidate)stop("UPLOAD_URL_CHANGED");
   url=candidate;
  }
  for(const hash of outcome.uploadRequiredHashes??[]){
   if(typeof hash!=="string"||!HEX.test(hash)||
      !ADD.some(path=>hostingAssetHash(sources[path])===hash))
    stop("UPLOAD_EXISTING_OR_UNKNOWN");
   necessary.add(hash);
  }
 }
 if(necessary.size>0&&url===null)stop("UPLOAD_URL_MISSING");
 for(const hash of necessary){
  const path=ADD.find(path=>hostingAssetHash(sources[path])===hash);
  const body=gzipSync(Buffer.from(sources[path],"utf8"),{mtime:0});
  await request("POST",url+"/"+hash,body,"application/octet-stream");
 }
 const finalized=await request("PATCH",BASE+"/"+created.name+"?update_mask=status",
  {status:"FINALIZED"});
 if(finalized?.name!==created.name||finalized.status!=="FINALIZED"||
    JSON.stringify(finalized.config)!==JSON.stringify(meta.config))
  stop("FINALIZE_CHANGED_CONFIG");
 const verified=await filesOf(request,created.name);
 const finalMap=new Map();
 for(const asset of verified){
  if(typeof asset?.path!=="string"||typeof asset.hash!=="string"||
     finalMap.has(asset.path)||!HEX.test(asset.hash.toLowerCase()))
   stop("FINAL_MANIFEST_SHAPE");
  finalMap.set(asset.path,asset.hash.toLowerCase());
 }
 if(finalMap.size!==plan.proposedManifest.size||
    [...plan.proposedManifest].some(([path,hash])=>finalMap.get(path)!==hash))
  stop("FINAL_MANIFEST_MISMATCH");
 // Firebase calculates the finalized version fileCount asynchronously.
 // Only READ the same version again. No second create/upload/finalize attempt.
 // Never publish unless this fresh server metadata agrees with every hash.
 let stable=false;
 for(let attempt=0;attempt<8;attempt++){
  const fresh=await GET(BASE+"/"+created.name);
  if(fresh?.name!==created.name)stop("FINAL_IDENTITY_CHANGED");
  if(JSON.stringify(fresh.config)!==JSON.stringify(meta.config))
   stop("FINAL_CONFIG_CHANGED");
  if(!["CREATED","FINALIZED"].includes(fresh.status))
   stop("FINAL_STATUS_UNEXPECTED");
  const actual=Number(fresh.fileCount);
  // The new version's complete file manifest has already been read back and
  // each path/hash matched exactly. Firebase Hosting may omit the optional
  // output-only fileCount even when status is FINALIZED. Do not require it,
  // but NEVER tolerate a returned count that differs from that manifest.
  const countKnown=fresh.fileCount!=null;
  const countMatches=!countKnown||
    (Number.isSafeInteger(actual)&&actual===finalMap.size);
  if(fresh.status==="FINALIZED"&&countMatches){
   if(!countKnown)log("OWNER_ONOFF_FINALIZED_FULL_MANIFEST_VERIFIED_COUNT_OMITTED");
   stable=true;break;
  }
  log("OWNER_ONOFF_FINALIZED_META_PENDING "+JSON.stringify({
   attempt:attempt+1,statusFinalized:fresh.status==="FINALIZED",
   fileCountPresent:countKnown,
   fileCountMatches:countKnown?countMatches:null
  }));
  if(attempt<7)await sleep(1250);
 }
 if(!stable)stop("FINAL_METADATA_NOT_STABLE");
 if(newest(await GET(LATEST))!==original)stop("RACE_BEFORE_PUBLISH");
 const published=await request("POST",BASE+"/sites/"+SITE+"/releases?versionName="+
  encodeURIComponent(created.name),{});
 if(published?.version?.name!==created.name)stop("PUBLISH_RESPONSE_MISMATCH");
 if(newest(await GET(LATEST))!==created.name)stop("PUBLISHED_VERSION_UNVERIFIED");
 // This confirms Hosting only, NOT authenticated Owner switches or finance
 // Rules. The feature flag remains the independent server-release gate.
 const result=Object.freeze({...preflight,
  released:true,createdVersion:created.name,hostingFilesAdded:2
 });
 log("OWNER_ONOFF_TWO_ASSET_PUBLISHED "+JSON.stringify(result));
 return result;
}
