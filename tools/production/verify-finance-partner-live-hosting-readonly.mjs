#!/usr/bin/env node
/**
 * GET ONLY. Independently reconciles the exact previous 30-file Hosting
 * version, the current 31-file version, the new approved one-file hash and
 * eventual public CDN bytes. No Firebase functions, Auth, Rules, Firestore,
 * account records, finance, products or counts are accessed.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {uploadSha} from "../hosting/owner-setup-additive-guard.mjs";
const OLD="sites/nico-factory/versions/ef2d401cabc4ba8e";
const NEW="sites/nico-factory/versions/bd2bedba406f133d";
const NAME="/finance-partner-boundary-check.html";
const BASE="https://firebasehosting.googleapis.com/v1beta1/";
const SITE="https://nico-factory.web.app";
const PROJECT="sales-management-cc116";
const STOP=code=>{throw Error("STOP_PARTNER_FINANCE_LIVE_READONLY_"+code);};
const validPath=x=>typeof x==="string"&&/^\/[A-Za-z0-9./_-]{1,300}$/.test(x);
const validHash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/i.test(x);
export function assessManifest({oldFiles,newFiles,liveVersion,expectedNewHash}={}){
 if(!Array.isArray(oldFiles)||!Array.isArray(newFiles)||
    oldFiles.length!==30||newFiles.length!==31||
    liveVersion!==NEW||!validHash(expectedNewHash))
   STOP("SCOPE_OR_COUNT_DRIFT");
 const index=rows=>{
  const m=new Map();
  for(const row of rows){
   if(!validPath(row?.path)||!validHash(row?.hash)||m.has(row.path))
    STOP("INVALID_OR_DUPLICATE_PATH");
   m.set(row.path,row.hash.toLowerCase());
  }
  return m;
 };
 const old=index(oldFiles),next=index(newFiles);
 for(const key of ["/index.html","/partner-invite.html","/partner-counts.html",
  "/partner-workspace.html","/finance-boundary-check.html","/owner-partner-setup.html"])
  if(!old.has(key))STOP("PROTECTED_OLD_ASSET_MISSING");
 if(old.has(NAME)||next.size!==old.size+1||next.get(NAME)!==expectedNewHash)
  STOP("NEW_ONLY_ASSET_NOT_PROVED");
 for(const [key,sha] of old){
  if(next.get(key)!==sha)STOP("PREEXISTING_ASSET_CHANGED");
 }
 if([...next.keys()].some(x=>!old.has(x)&&x!==NAME))
  STOP("OTHER_NEW_ASSET_UNEXPECTED");
 return Object.freeze({
  originalHostingAssetsUnchanged:30,
  approvedNewAssets:1,
  newAssetExactReviewedHash:true,
  originalFinanceDiagnosticUnchanged:true,
  productionFirestoreWrites:0,productionAuthChanges:0,
  productionFunctionChanges:0,productionRulesChanges:0
 });
}
async function main(){
 if(process.argv.length!==2||
   process.env.GITHUB_ACTIONS!=="true"||
   process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
   process.env.GITHUB_REF!=="refs/heads/main"||
   process.env.FIREBASE_PROJECT_ID!==PROJECT||
   process.env.NICO_HOSTING_AUDIT_MODE!=="GET_ONLY"||
   !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("UNAPPROVED_EXECUTION");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const cred=require("firebase-admin/app").applicationDefault();
 const get=async url=>{
  if(!url.startsWith(BASE)||!/^https:\/\/firebasehosting[.]googleapis[.]com\/v1beta1\/(?:sites\/nico-factory\/releases\?pageSize=1|sites\/nico-factory\/versions\/(?:ef2d401cabc4ba8e|bd2bedba406f133d)(?:\/files\?pageSize=1000(?:&pageToken=[A-Za-z0-9_-]{1,3000})?)?)$/.test(url))
   STOP("UNAPPROVED_URL");
  const token=(await cred.getAccessToken())?.access_token;
  if(!token)STOP("TOKEN_UNAVAILABLE");
  const reply=await fetch(url,{method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token}});
  if(reply.status!==200)STOP("HOSTING_GET_FAILED");
  const doc=await reply.json();
  if(!doc||typeof doc!=="object"||Array.isArray(doc))STOP("JSON_UNEXPECTED");
  return doc;
 };
 const release=await get(BASE+"sites/nico-factory/releases?pageSize=1");
 const latest=release?.releases?.[0]?.version?.name;
 if(!Array.isArray(release.releases)||release.releases.length!==1||
   latest!==NEW)STOP("CURRENT_VERSION_CHANGED");
 const fetchFiles=async name=>{
  const v=await get(BASE+name);
  if(v?.name!==name||v.status!=="FINALIZED"||typeof v.config!=="object")
   STOP("VERSION_UNFINALIZED");
  const rows=[];let token="",pages=0;
  const visited=new Set();
  do{
   if(visited.has(token)||++pages>60)STOP("PAGE_REPEAT_OR_OVERFLOW");
   visited.add(token);
   const url=BASE+name+"/files?pageSize=1000"+
     (token?"&pageToken="+encodeURIComponent(token):"");
   const page=await get(url);
   if(!Array.isArray(page.files)||page.files.length>1000||rows.length+page.files.length>30000)
    STOP("FILE_LIST_INVALID");
   rows.push(...page.files);
   token=page.nextPageToken||"";
   if(typeof token!=="string"||token.length>3000)STOP("PAGE_TOKEN_INVALID");
  }while(token);
  return rows;
 };
 const current=await fetchFiles(NEW),before=await fetchFiles(OLD);
 const sourceRoot=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const asset=readFileSync(path.join(sourceRoot,NAME.slice(1)));
 const oldAsset=readFileSync(path.join(sourceRoot,"finance-boundary-check.html"));
 if(!asset.toString("utf8").includes("Array.isArray(ownerHandoff.partnerIds)")||
    !asset.toString("utf8").includes("getIdToken(true)")||
    !asset.toString("utf8").includes("mask.fieldPaths")||
    !oldAsset.toString("utf8").includes("getPartnerWorkspace"))
  STOP("REVIEWED_ASSET_CHANGED");
 const manifest=assessManifest({
  oldFiles:before,newFiles:current,liveVersion:latest,
  expectedNewHash:uploadSha(asset.toString("utf8"))
 });
 const bytesMatch=async(file,expected)=>{
  for(let attempt=0;attempt<12;attempt++){
   try{
    const url=SITE+file+"?verify="+process.env.GITHUB_SHA.slice(0,12)+"-"+attempt;
    const r=await fetch(url,{method:"GET",cache:"no-store",redirect:"error",
     headers:{"Cache-Control":"no-cache"}});
    if(r.status===200&&Buffer.from(await r.arrayBuffer()).equals(expected))
     return true;
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  return false;
 };
 const newLive=await bytesMatch(NAME,asset);
 const oldLive=await bytesMatch("/finance-boundary-check.html",oldAsset);
 if(!newLive||!oldLive)STOP("PUBLIC_CDN_BYTE_MISMATCH");
 for(const route of ["/","/partner-workspace.html","/partner-counts.html",
     "/owner-partner-setup.html"]){
  const reply=await fetch(SITE+route+"?verify="+process.env.GITHUB_SHA.slice(0,12),
    {method:"GET",cache:"no-store",redirect:"error"});
  if(reply.status!==200)STOP("ORIGINAL_ROUTE_UNAVAILABLE");
 }
 console.log("NICO_PARTNER_FINANCE_DIAGNOSTIC_LIVE_VERIFIED "+JSON.stringify({
  project:PROJECT,originalAssetCount:manifest.originalHostingAssetsUnchanged,
  newAssets:manifest.approvedNewAssets,
  liveNewAssetByteMatched:true,
  liveOriginalFinanceDiagnosticByteMatched:true,
  allOtherHostingAssetsPreserved:true,
  productionFirestoreWrites:0,productionAuthChanges:0,
  productionFunctionChanges:0,productionRulesChanges:0,
  realPartnerFinanceGetListDeniedVerified:false,
  safeToEnableJointRanking:false
 }));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(err=>{
  console.error(/^STOP_PARTNER_FINANCE_LIVE_READONLY_[A-Z0-9_]+$/.test(err?.message||"")?
    err.message:"STOP_PARTNER_FINANCE_LIVE_READONLY_UNVERIFIED");
  process.exitCode=1;
 });
}
