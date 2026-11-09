#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createRequire} from "node:module";
import {planTwoAssetOwnerPortalReplacement}
 from "../hosting/owner-portal-two-assets-replacement-guard.mjs";

/**
 * Hosting GET-only audit. It never publishes, edits, removes or populates
 * a Hosting version. In PRs only synthetic tests run (no credentials).
 */
const BASE="https://firebasehosting.googleapis.com/v1beta1";
const SITE="nico-factory",PROJECT="sales-management-cc116";
const RELEASE=BASE+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const STOP=code=>{throw Error("STOP_OWNER_PORTAL_LIVE_READONLY_"+code)};
const oldPaths=Object.freeze({
 html:"staging/hub-owner-management/owner-partner-admin.html",
 bootstrap:"staging/partner-owner-correction-v3/mobile-bootstrap.mjs",
 client:"staging/partner-owner-correction-v3/owner-client.mjs",
 ui:"staging/partner-owner-correction-v3/owner-ui.mjs"
});
const newPaths=Object.freeze({
 html:"staging/owner-workspace-errors-v1/owner-partner-admin.html",
 bootstrap:"staging/owner-workspace-errors-v1/mobile-bootstrap.mjs",
 client:"staging/owner-workspace-errors-v1/owner-client.mjs",
 ui:"staging/owner-workspace-errors-v1/owner-ui.mjs"
});
export function reviewedLocalAssets(root){
 if(typeof root!=="string"||!path.isAbsolute(root))STOP("SOURCE_ROOT");
 const read=paths=>Object.fromEntries(Object.entries(paths).map(
  ([k,p])=>[k,readFileSync(path.join(root,p),"utf8")]
 ));
 return Object.freeze({previous:read(oldPaths),candidate:read(newPaths)});
}
const releaseName=r=>{
 if(!Array.isArray(r?.releases)||r.releases.length!==1||
    !VERSION.test(r.releases[0]?.version?.name||""))STOP("RELEASE_UNAVAILABLE");
 return r.releases[0].version.name;
};
export async function inspectLiveOwnerPortal({request,previous,candidate}={}){
 if(typeof request!=="function")STOP("REQUEST_REQUIRED");
 const oldName=releaseName(await request("GET",RELEASE));
 const version=await request("GET",BASE+"/"+oldName);
 if(version?.name!==oldName||version.status!=="FINALIZED"||
    !version.config||typeof version.config!=="object")
  STOP("LIVE_VERSION_UNVERIFIED");
 const files=[];
 let token="",pages=0;
 const seen=new Set();
 do{
  if(++pages>100||seen.has(token))STOP("PAGINATION_UNVERIFIED");
  seen.add(token);
  const q=new URLSearchParams({pageSize:"1000"});
  if(token)q.set("pageToken",token);
  const data=await request("GET",BASE+"/"+oldName+"/files?"+q);
  if(!Array.isArray(data?.files)||data.files.length>1000)STOP("FILE_LIST_UNVERIFIED");
  files.push(...data.files);
  if(files.length>30000)STOP("TOO_MANY_FILES");
  token=data.nextPageToken||"";
  if(typeof token!=="string"||token.length>3000)STOP("PAGE_TOKEN_UNVERIFIED");
 }while(token);
 if(version.fileCount!=null&&Number(version.fileCount)!==files.length)
  STOP("FILE_COUNT_CHANGED");
 // Refuse a concurrent Hosting release even for this zero-write diagnosis.
 if(releaseName(await request("GET",RELEASE))!==oldName)
  STOP("CONCURRENT_RELEASE");
 const proposal=planTwoAssetOwnerPortalReplacement({
  liveFiles:files,previous,candidate
 });
 return Object.freeze({
  verified:"HOSTING_MANIFEST_MATCHES_REVIEWED_OLD_PORTAL",
  releaseApproved:false,
  modifiedLiveFiles:0,
  filesInspected:files.length,
  proposedReplacementCount:proposal.changedPaths.length,
  proposedPaths:proposal.changedPaths
 });
}
const safeHost=u=>{
 let parsed;
 try{parsed=new URL(u)}catch{STOP("URL_INVALID")}
 if(parsed.origin!==BASE.replace("/v1beta1","")||
    !parsed.pathname.startsWith("/v1beta1/sites/"+SITE+"/")||
    !parsed.searchParams.keys().every(k=>["pageSize","pageToken"].includes(k))||
    parsed.username||parsed.password||parsed.hash)STOP("UNAPPROVED_URL");
 return parsed.href;
};
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("CI_CONTEXT_UNAPPROVED");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const assets=reviewedLocalAssets(root);
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 const request=async(method,url)=>{
  if(method!=="GET")STOP("METHOD_NOT_READONLY");
  const target=safeHost(url);
  const token=(await credential.getAccessToken()).access_token;
  if(typeof token!=="string"||token.length<20)STOP("OAUTH_UNAVAILABLE");
  const response=await fetch(target,{
   method:"GET",redirect:"error",
   headers:{Authorization:"Bearer "+token}
  });
  if(!response.ok)STOP("HOSTING_GET_STATUS_"+response.status);
  const raw=await response.text();
  if(raw.length>4_000_000)STOP("RESPONSE_TOO_LARGE");
  try{return JSON.parse(raw)}catch{STOP("JSON_UNVERIFIED")}
 };
 const result=await inspectLiveOwnerPortal({request,...assets});
 console.log("OWNER_PORTAL_LIVE_READONLY "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{
  console.error(/^STOP_OWNER_PORTAL_(LIVE_READONLY|TWO_ASSETS)_[A-Z0-9_]+$/.test(error?.message||"")?
   error.message:"STOP_OWNER_PORTAL_LIVE_READONLY_UNKNOWN");
  process.exitCode=1;
 });
