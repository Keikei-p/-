import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

/**
 * Read-only, offline-only release review of exactly TWO already-existing
 * Firebase Hosting assets. Never makes network requests or deploys.
 * Protected existing add-only workflow/verified source must stay unchanged.
 */
const STOP=code=>{throw Error("STOP_OWNER_PORTAL_TWO_ASSETS_"+code)};
const HASH=/^[a-f0-9]{64}$/;
const PATHS=Object.freeze({
 html:"/owner-partner-admin.html",
 bootstrap:"/owner-partner-admin-assets/mobile-bootstrap.mjs",
 client:"/owner-partner-admin-assets/owner-client.mjs",
 ui:"/owner-partner-admin-assets/owner-ui.mjs"
});
const CANDIDATE=Object.freeze({
 html:"8ac03f833b27706b256d9218742c343bb3e040ff",
 bootstrap:"8533ac6b02f7768189444c9bfb8cc11cea7b28e7",
 client:"3df123912de87d3212c173997465c721f5b9e54e",
 ui:"7c10e98da34339aa26b5fdc0ac89798b57c01016"
});
const REVIEWED=Object.freeze({
 html:"f6609e6664ec11f629ea57751295abe18cb1dc2a",
 bootstrap:"fe8fa6779093a19cdc4c678acf85df348a61f76a",
 client:"3df123912de87d3212c173997465c721f5b9e54e",
 ui:"7c10e98da34339aa26b5fdc0ac89798b57c01016"
});
export const PROTECTED_ASSET_PATHS=Object.freeze({...PATHS});
const CANONICAL=Object.freeze([
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/finance-boundary-check.html"
]);
const sourceHash=x=>{
 const data=Buffer.from(x,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");
};
const hostingHash=x=>createHash("sha256")
 .update(gzipSync(Buffer.from(x,"utf8"),{mtime:0})).digest("hex");
const exactKeys=(obj,names)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&
 Object.keys(obj).length===names.length&&
 names.every(k=>typeof obj[k]==="string");
const strictSource=(assets,pins)=>{
 if(!exactKeys(assets,Object.keys(PATHS)))STOP("SOURCE_KEY_SET");
 for(const key of Object.keys(PATHS))
  if(assets[key].length<100||assets[key].length>120000||
     sourceHash(assets[key])!==pins[key])STOP("SOURCE_HASH_"+key.toUpperCase());
};
export function planTwoAssetOwnerPortalReplacement({liveFiles,previous,candidate}={}){
 strictSource(previous,REVIEWED);
 strictSource(candidate,CANDIDATE);
 if(candidate.client!==previous.client||candidate.ui!==previous.ui)
  STOP("UNREVIEWED_DEPENDENCY_REPLACEMENT");
 if(candidate.html===previous.html||candidate.bootstrap===previous.bootstrap)
  STOP("EXPECTED_CHANGE_MISSING");
 if(!candidate.html.includes("const HUB_OWNER_CORRECTION_READY=false")||
    !candidate.html.includes("classifyOwnerWorkspaceError(error)")||
    !candidate.html.includes("countOnlyRegisteredCompanies(response,day)")||
    !candidate.html.includes('getAuth(app)')||
    !candidate.html.includes('getPartnerWorkspace')||
    !candidate.bootstrap.includes('export function classifyOwnerWorkspaceError(error)')||
    !candidate.bootstrap.includes('from "./owner-client.mjs"')||
    !candidate.bootstrap.includes('from "./owner-ui.mjs"')||
    /\b(?:signInWithEmailAndPassword|createUserWithEmailAndPassword|deleteUser|setDoc|updateDoc|writeBatch|localStorage|sessionStorage)\s*\(/.test(candidate.html))
  STOP("CANDIDATE_CONTRACT");
 if(!Array.isArray(liveFiles)||liveFiles.length<9||liveFiles.length>30000)
  STOP("LIVE_MANIFEST");
 const previousMap=new Map();
 for(const row of liveFiles){
  if(typeof row?.path!=="string"||!row.path.startsWith("/")||
     typeof row.hash!=="string"||!HASH.test(row.hash.toLowerCase())||
     previousMap.has(row.path))STOP("INVALID_LIVE_FILE");
  previousMap.set(row.path,row.hash.toLowerCase());
 }
 if(CANONICAL.some(p=>!previousMap.has(p)))STOP("CANONICAL_FILE_MISSING");
 for(const [key,path] of Object.entries(PATHS)){
  if(previousMap.get(path)!==hostingHash(previous[key]))
   STOP("LIVE_SOURCE_DRIFT_"+key.toUpperCase());
 }
 const next=new Map(previousMap);
 for(const key of ["html","bootstrap"])next.set(PATHS[key],hostingHash(candidate[key]));
 if(next.size!==previousMap.size)STOP("UNEXPECTED_MANIFEST_LENGTH");
 const changed=[...next].filter(([path,hash])=>previousMap.get(path)!==hash).map(([path])=>path);
 if(changed.length!==2||changed[0]!==PATHS.html||
    changed[1]!==PATHS.bootstrap){
  // A Hosting inventory may be ordered arbitrarily. Compare sets below.
  if(changed.length!==2||!changed.includes(PATHS.html)||!changed.includes(PATHS.bootstrap))
   STOP("SCOPE_UNVERIFIED");
 }
 if([...previousMap].some(([path,hash])=>
    !changed.includes(path)&&next.get(path)!==hash))
  STOP("UNRELATED_FILE_CHANGED");
 return Object.freeze({
  status:"REVIEWED_OFFLINE_ONLY",
  releaseApproved:false,
  hostedOriginalFilesPreserved:previousMap.size-2,
  changedPaths:Object.freeze([...changed].sort()),
  originalManifest:previousMap,
  proposedManifest:next,
  payloads:Object.freeze({
   [PATHS.html]:candidate.html,[PATHS.bootstrap]:candidate.bootstrap
  })
 });
}
