/**
 * PR #731: reviewed FOUR-file replacement plan for the existing Owner setup.
 * A historical add-only publisher cannot upgrade these already-live URLs.
 * This module DOES NOT deploy, update Firestore, or authorize a backend switch.
 */
import {SOURCES,blobSha,uploadSha} from "./owner-setup-additive-guard.mjs";

export const OWNER_ONLY_REPLACEMENTS=Object.freeze({
 "owner-partner-setup.html":"8cb4ad80c3c03658d1fb070339614cf2f5617d7b",
 "ranking/owner-partner-setup-mount.mjs":"9a167a2cc5e8c76ff22812fd3279cc047ca25f3b",
 "ranking/owner-product-visibility-panel.mjs":"c85aa14170ac4448b143ece873b4bc22079db05a",
 "ranking/owner-reviewed-sku-mapping-panel.mjs":"de06efe5e50bd6221f9c226c3ff994f632c9dcfd"
});
const REQUIRED=Object.freeze([
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/owner-partner-admin.html"
]);
const stop=reason=>{throw Error("STOP_OWNER_ONLY_SETUP_REPLACEMENT_"+reason);};
const record=x=>x&&typeof x==="object"&&!Array.isArray(x);
const keys=x=>Object.keys(x).sort().join("|");

export function planOwnerOnlySetupReplacement({
 liveFiles,historicalSources,candidateSources
}={}){
 if(!Array.isArray(liveFiles)||liveFiles.length<16||
    liveFiles.length>20000||!record(historicalSources)||
    !record(candidateSources)||keys(historicalSources)!==keys(SOURCES)||
    keys(candidateSources)!==keys(OWNER_ONLY_REPLACEMENTS))
  stop("INPUT");
 const old=new Map();
 for(const row of liveFiles){
  if(!record(row)||typeof row.path!=="string"||
     !/^\/[A-Za-z0-9./_-]{1,300}$/.test(row.path)||
     typeof row.hash!=="string"||
     !/^[a-f0-9]{64}$/i.test(row.hash)||old.has(row.path))
   stop("MANIFEST");
  old.set(row.path,row.hash.toLowerCase());
 }
 if(REQUIRED.some(x=>!old.has(x)))stop("ORIGINAL_APP_MISSING");
 for(const [name,sha] of Object.entries(SOURCES)){
  const historical=historicalSources[name];
  if(typeof historical!=="string"||blobSha(historical)!==sha||
     old.get("/"+name)!==uploadSha(historical))
   stop("LIVE_OWNER_SOURCE_DRIFT");
 }
 for(const [name,sha] of Object.entries(OWNER_ONLY_REPLACEMENTS)){
  const code=candidateSources[name];
  if(typeof code!=="string"||code.length<80||code.length>150000||
     blobSha(code)!==sha)
   stop("CURRENT_SOURCE_UNREVIEWED");
  if(/(?:firebase-firestore\.js|\bgetFirestore\s*\(|\bsetDoc\s*\(|\bwriteBatch\s*\()/i.test(code))
   stop("DIRECT_FINANCIAL_STORE_ACCESS");
 }
 const page=candidateSources["owner-partner-setup.html"];
 const mount=candidateSources["ranking/owner-partner-setup-mount.mjs"];
 if(!page.includes("mountOwnerPartnerSetup")||
    !page.includes('projectId:"sales-management-cc116"')||
    !page.includes('getFunctions(app,"asia-northeast1")')||
    !mount.includes('httpsCallable(functions,"getPartnerWorkspace")')||
    !mount.includes("ownerSetupCompaniesOnly:true")||
    mount.includes("createOwnerRankingConsentPanel")||
    mount.includes("saveConsent(")||mount.includes("rankingApprovals"))
  stop("OWNER_ONLY_ENTRY_NOT_VERIFIED");
 const next=new Map(old),changed=[];
 for(const name of Object.keys(OWNER_ONLY_REPLACEMENTS)){
  const path="/"+name;
  if(!old.has(path))stop("REPLACEMENT_PATH_ABSENT");
  const digest=uploadSha(candidateSources[name]);
  if(digest===old.get(path))stop("NO_CHANGE_PATH");
  next.set(path,digest);
  changed.push(path);
 }
 if(changed.length!==4||next.size!==old.size||
    [...old].some(([path,hash])=>
     !changed.includes(path)&&next.get(path)!==hash))
  stop("UNEXPECTED_ASSET_CHANGE");
 return Object.freeze({
  originalManifest:old,
  proposedManifest:next,
  changedPaths:Object.freeze(changed),
  unchangedAssetCount:old.size-4,
  replacementAssetCount:4,
  allOtherAssetsPreserved:true,
  // This pure manifest proof cannot assert the deployed callable supports
  // ownerSetupCompaniesOnly. An actual authenticated Owner GET is required.
  backendOwnerOnlyGetVerified:false,
  realOwnerAccountVerified:false,
  releaseApproved:false,
  safeToPublish:false,
  productionWrites:0
 });
}
