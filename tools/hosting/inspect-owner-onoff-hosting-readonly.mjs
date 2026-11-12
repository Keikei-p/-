/**
 * STAGING / READ-ONLY ONLY: inspect the actual Firebase Hosting release for
 * Owner product visibility before proposing an additive two-asset deployment.
 * GET requests only; no writes to Hosting, Rules, Functions, Firestore or Auth.
 * Protect every current live path/hash and configuration, including unrelated
 * releases made after the historical 17-file baseline.
 */
import {planOwnerOnOffAssets,ONOFF_ASSETS} from "./owner-product-onoff-additive-guard.mjs";

export const OWNER_ONOFF_HOSTING_SITE="nico-factory";
export const OWNER_ONOFF_HOSTING_BASE="https://firebasehosting.googleapis.com/v1beta1";
const BASE=OWNER_ONOFF_HOSTING_BASE;
const SITE=OWNER_ONOFF_HOSTING_SITE;
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const FILENAME=/^\/[A-Za-z0-9._/-]+$/;
const HASH=/^[a-f0-9]{64}$/;
const missingPaths=Object.freeze([
 "/owner-product-publication.html",
 "/ranking/owner-product-visibility-dashboard-mount.mjs"
]);
const stop=reason=>{throw Error("STOP_OWNER_ONOFF_HOSTING_PREFLIGHT_"+reason);};
function checkedVersion(payload){
 const releases=payload?.releases;
 if(!Array.isArray(releases)||releases.length!==1||
    !VERSION.test(releases[0]?.version?.name||""))
   stop("LATEST_RELEASE_UNVERIFIED");
 return releases[0].version.name;
}
function checkedMeta(meta,name){
 if(meta?.name!==name||meta.status!=="FINALIZED"||
   !meta.config||typeof meta.config!=="object"||
   Array.isArray(meta.config)||
   typeof meta.fileCount!=="number"||
   !Number.isSafeInteger(meta.fileCount)||meta.fileCount<2||meta.fileCount>30000)
  stop("LATEST_CONFIG_UNVERIFIED");
}
function queryFilesUrl(version,token=""){
 const q=new URLSearchParams({pageSize:"1000"});
 if(token)q.set("pageToken",token);
 return BASE+"/"+version+"/files?"+q;
}
async function allFiles(readOnlyGet,version){
 const found=[],tokens=new Set();
 let next="";
 do{
  if(tokens.has(next)||tokens.size>=35)stop("PAGE_CYCLE");
  tokens.add(next);
  const page=await readOnlyGet(queryFilesUrl(version,next));
  if(!Array.isArray(page?.files)||page.files.length>1000||
     found.length+page.files.length>30000)stop("PAGE_SHAPE");
  for(const f of page.files){
   if(typeof f?.path!=="string"||!FILENAME.test(f.path)||
      f.path.includes("..")||typeof f.hash!=="string"||
      !HASH.test(f.hash.toLowerCase()))stop("FILE_SHAPE");
   found.push({path:f.path,hash:f.hash.toLowerCase()});
  }
  next=page.nextPageToken??"";
  if(typeof next!=="string"||next.length>3000)stop("TOKEN_SHAPE");
 }while(next);
 if(!found.length)stop("EMPTY_MANIFEST");
 return found;
}
function samePaths(a,b){
 return a.length===b.length&&
  a.every(path=>b.includes(path))&&
  new Set(a).size===a.length;
}
/**
 * The supplied request callback must be GET-only and already authenticated by
 * the trusted CI service identity. Browser-provided data is never accepted.
 */
export async function inspectLiveOwnerOnOffHosting({readOnlyGet,sources}={}){
 if(typeof readOnlyGet!=="function")stop("READER_MISSING");
 const latestUrl=BASE+"/sites/"+SITE+"/releases?pageSize=1";
 const initial=checkedVersion(await readOnlyGet(latestUrl));
 const meta=await readOnlyGet(BASE+"/"+initial);
 checkedMeta(meta,initial);
 const live=await allFiles(readOnlyGet,initial);
 if(live.length!==meta.fileCount)stop("FILE_COUNT_MISMATCH");
 const plan=planOwnerOnOffAssets({liveFiles:live,sources});
 const wanted=Object.keys(ONOFF_ASSETS);
 const ready=plan.newAssetPaths.length===0;
 if(!ready&&!samePaths(plan.newAssetPaths,missingPaths))
  stop("NOT_EXACTLY_TWO_MISSING");
 if(!samePaths(wanted.filter(path=>!plan.newAssetPaths.includes(path)),
    wanted.filter(path=>!missingPaths.includes(path)))&&!ready)
  stop("EXISTING_DEPENDENCY_MISMATCH");
 // Refuse to attest to a plan whose live version changed during the scan.
 if(checkedVersion(await readOnlyGet(latestUrl))!==initial)
  stop("CONCURRENT_HOSTING_RELEASE");
 return Object.freeze({
  scope:"OWNER_PRODUCT_ONOFF_GET_ONLY",
  version:initial,
  existingAssetCount:plan.existingAssetsPreserved,
  matchingPublishedDependencies:ready?5:3,
  newAssetPaths:plan.newAssetPaths,
  preservedExistingAssetCount:plan.originalManifest.size,
  releaseReady:false,
  approvedToActivateCallables:false,
  firestoreWrites:0,
  hostingWrites:0
 });
}
