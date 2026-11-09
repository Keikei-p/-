import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

/**
 * Strict offline preflight: ADD ONE new, reviewed, authenticated count-only
 * Owner HTML page to the already verified 17-asset Firebase Hosting release.
 * Existing 17 paths and all hashes remain identical. NO data/cloud writes.
 */
export const SITE="nico-factory";
export const PROJECT="sales-management-cc116";
export const NEW_PATH="/owner-partner-counts-readonly.html";
export const BASE_VERSION="sites/nico-factory/versions/34842c6a26d62382";
export const NEW_SOURCE_SHA="95602110f5d5531fb5b4d0f53b5fd30883c87b32";
const OLD=Object.freeze({
 "/owner-partner-admin.html":"8ac03f833b27706b256d9218742c343bb3e040ff",
 "/owner-partner-admin-assets/mobile-bootstrap.mjs":"8533ac6b02f7768189444c9bfb8cc11cea7b28e7",
 "/owner-partner-admin-assets/owner-client.mjs":"3df123912de87d3212c173997465c721f5b9e54e",
 "/owner-partner-admin-assets/owner-ui.mjs":"7c10e98da34339aa26b5fdc0ac89798b57c01016"
});
const CANONICAL=Object.freeze([
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/finance-boundary-check.html"
]);
const HASH=/^[a-f0-9]{64}$/;
const STOP=code=>{throw Error("STOP_OWNER_COUNT_ADDONE_"+code)};
export function gitBlob(input){
 const bytes=Buffer.from(input,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
}
export function hostingBytes(source){
 return gzipSync(Buffer.from(source,"utf8"),{mtime:0});
}
export function hostingHash(source){
 return createHash("sha256").update(hostingBytes(source)).digest("hex");
}
export function planOwnerCountAddOne({version,liveFiles,oldSources,candidate}={}){
 if(version!==BASE_VERSION)STOP("BASE_VERSION_CHANGED");
 if(typeof candidate!=="string"||gitBlob(candidate)!==NEW_SOURCE_SHA||
    candidate.length<1000||candidate.length>150000||
    !candidate.includes("listHubPartnerCounts")||
    !candidate.includes("getPartnerWorkspace")||
    !candidate.includes("onAuthStateChanged")||
    !candidate.includes('const LIST_KEYS=Object.freeze(')||
    /(?:httpsCallable\(functions,"correctHubPartnerCounts"|signInWithEmailAndPassword\s*\(|setDoc\s*\(|updateDoc\s*\(|deleteDoc\s*\()/.test(candidate))
  STOP("CANDIDATE_NOT_REVIEWED");
 if(!oldSources||typeof oldSources!=="object"||
    Array.isArray(oldSources)||Object.keys(oldSources).length!==4||
    Object.keys(oldSources).some(p=>!Object.hasOwn(OLD,p)))
  STOP("SOURCE_MAP_UNVERIFIED");
 if(!Array.isArray(liveFiles)||liveFiles.length!==17)
  STOP("UNEXPECTED_BASE_MANIFEST_SIZE");
 const map=new Map();
 for(const f of liveFiles){
  if(typeof f?.path!=="string"||!f.path.startsWith("/")||
     typeof f.hash!=="string"||!HASH.test(f.hash.toLowerCase())||
     map.has(f.path))STOP("LIVE_MANIFEST_INVALID");
  map.set(f.path,f.hash.toLowerCase());
 }
 if(map.has(NEW_PATH)||CANONICAL.some(p=>!map.has(p)))STOP("COLLISION_OR_CANONICAL_MISSING");
 for(const [p,expected] of Object.entries(OLD)){
  if(typeof oldSources[p]!=="string"||gitBlob(oldSources[p])!==expected||
     map.get(p)!==hostingHash(oldSources[p]))
   STOP("EXISTING_OWNER_PORTAL_DRIFT");
 }
 const next=new Map(map),digest=hostingHash(candidate);
 if(map.has(NEW_PATH))STOP("PATH_COLLISION");
 next.set(NEW_PATH,digest);
 if(next.size!==18||[...map].some(([p,h])=>next.get(p)!==h))
  STOP("OTHER_LIVE_ASSET_CHANGED");
 return Object.freeze({
  status:"REVIEWED_ADD_ONE_ONLY",
  sourceVersion:version,
  previousCount:17,nextCount:18,
  newPath:NEW_PATH,newHash:digest,
  originalManifest:map,proposedManifest:next,
  uploadBytes:hostingBytes(candidate),releaseApproved:false
 });
}
