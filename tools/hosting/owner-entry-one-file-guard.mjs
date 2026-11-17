/** 
 * A narrowly-scoped Firebase Hosting migration: replace only the old Owner
 * entry HTML. The other three current Owner JS panels are ALREADY live.
 * This is a pure immutable-manifest planner. It cannot deploy or approve use.
 */
import {SOURCES,blobSha,uploadSha} from "./owner-setup-additive-guard.mjs";
import {OWNER_ONLY_REPLACEMENTS} from "./owner-only-setup-replacement-guard.mjs";

export const LIVE_CURRENT_OWNER_JS=Object.freeze([
 "ranking/owner-partner-setup-mount.mjs",
 "ranking/owner-product-visibility-panel.mjs",
 "ranking/owner-reviewed-sku-mapping-panel.mjs"
]);
const ENTRY="owner-partner-setup.html";
const REQUIRED=Object.freeze([
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/owner-partner-admin.html"
]);
const stop=reason=>{throw Error("STOP_OWNER_ENTRY_ONE_FILE_"+reason);};
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const sameKeys=(x,y)=>Object.keys(x).sort().join("|")===Object.keys(y).sort().join("|");

export function planOwnerEntryOneFile({liveFiles,historicalSources,candidateSources}={}){
 if(!Array.isArray(liveFiles)||liveFiles.length!==33||
    !isObj(historicalSources)||!isObj(candidateSources)||
    !sameKeys(historicalSources,SOURCES)||
    !sameKeys(candidateSources,OWNER_ONLY_REPLACEMENTS))
  stop("INPUT_SCOPE");
 const present=new Map();
 for(const f of liveFiles){
  if(!isObj(f)||typeof f.path!=="string"||
     !/^\/[A-Za-z0-9./_-]{1,300}$/.test(f.path)||
     typeof f.hash!=="string"||!/^[a-f0-9]{64}$/i.test(f.hash)||
     present.has(f.path))stop("LIVE_MANIFEST_INVALID");
  present.set(f.path,f.hash.toLowerCase());
 }
 if(REQUIRED.some(path=>!present.has(path)))stop("ORIGINAL_APP_NOT_PRESENT");
 for(const [name,sha] of Object.entries(SOURCES)){
  if(typeof historicalSources[name]!=="string"||blobSha(historicalSources[name])!==sha)
   stop("HISTORICAL_SOURCE_TAMPERED");
  const alreadyNew=LIVE_CURRENT_OWNER_JS.includes(name);
  const source=alreadyNew?candidateSources[name]:historicalSources[name];
  if(alreadyNew&&blobSha(source)!==OWNER_ONLY_REPLACEMENTS[name])
   stop("CURRENT_LIVE_JS_TAMPERED");
  if(present.get("/"+name)!==uploadSha(source))
   stop("CURRENT_DEPLOYED_OWNER_ASSET_DRIFT");
 }
 for(const [name,sha] of Object.entries(OWNER_ONLY_REPLACEMENTS)){
  const src=candidateSources[name];
  if(typeof src!=="string"||src.length<80||src.length>150000||
     blobSha(src)!==sha)stop("CURRENT_CANDIDATE_SOURCE_TAMPERED");
  if(/(?:firebase-firestore\.js|\bgetFirestore\s*\(|\bsetDoc\s*\(|\bupdateDoc\s*\(|\bwriteBatch\s*\()/i.test(src))
   stop("FINANCIAL_DIRECT_ACCESS");
 }
 const page=candidateSources[ENTRY],mount=candidateSources[LIVE_CURRENT_OWNER_JS[0]];
 if(!page.includes("mountOwnerPartnerSetup")||
    !page.includes('projectId:"sales-management-cc116"')||
    !page.includes('getFunctions(app,"asia-northeast1")')||
    !mount.includes('httpsCallable(functions,"getPartnerWorkspace")')||
    !mount.includes("ownerSetupCompaniesOnly:true")||
    mount.includes("createOwnerRankingConsentPanel")||
    mount.includes("saveConsent("))stop("OWNER_ENTRY_NOT_REVIEWED");
 const previous=present.get("/"+ENTRY),nextHash=uploadSha(page);
 if(previous===nextHash)stop("ALREADY_DEPLOYED");
 const proposed=new Map(present);proposed.set("/"+ENTRY,nextHash);
 if(proposed.size!==present.size||[...present].some(([name,hash])=>
    name!=="/"+ENTRY&&proposed.get(name)!==hash))stop("UNEXPECTED_ASSET_CHANGE");
 return Object.freeze({
  originalManifest:present,proposedManifest:proposed,
  oldHtmlHash:previous,newHtmlHash:nextHash,
  changedPaths:Object.freeze(["/"+ENTRY]),
  existingFilesPreserved:32,liveFileCount:33,
  currentOwnerJsPublishedAndMatched:3,
  historicalOwnerAssetsMatched:8,
  unrelatedAssetsUnmodified:true,
  // This offline manifest checker never proves a live authenticated Owner GET.
  realOwnerAuthenticatedGetVerified:false,
  liveHostingUpdated:false,
  liveDocumentWrites:0
 });
}
