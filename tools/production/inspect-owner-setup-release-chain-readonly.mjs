#!/usr/bin/env node
/**
 * LIVE READ ONLY. One release-chain snapshot, from actual Cloud Functions v2
 * metadata, published Firebase Hosting immutable hashes and sanitized SKU
 * publication audit. No original counts, products, prices, user records,
 * financial collections, Auth users or any cloud writes.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {NEW,EXPECTED_FLAGS,PROJECT,REGION}
 from "./owner-setup-six-release-scope.mjs";
import {SOURCES,uploadSha,blobSha}
 from "../hosting/owner-setup-additive-guard.mjs";
import {inspectSkuPublication}
 from "./inspect-live-sku-publication-readonly.mjs";

const STOP=code=>{throw Error("STOP_OWNER_SETUP_CHAIN_"+code);};
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const HOSTING_VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const isObj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const keys=x=>Object.keys(x);
export function classifyFunctions(rows){
 if(!Array.isArray(rows)||rows.length>1000)STOP("FUNCTION_INVENTORY_INCOMPLETE");
 const relevant=new Map(),seen=new Set();
 for(const item of rows){
  if(!isObj(item)||typeof item.name!=="string"||
     seen.has(item.name))STOP("FUNCTION_METADATA_UNTRUSTED");
  seen.add(item.name);
  if(NEW.some(n=>item.name===ROOT+n))relevant.set(item.name.slice(ROOT.length),item);
 }
 let deployed=0,ready=0;
 for(const name of NEW){
  const item=relevant.get(name);
  if(!item)continue;
  deployed++;
  if(item.state==="ACTIVE"&&
     item.buildConfig?.entryPoint===name&&
     item.buildConfig?.runtime==="nodejs22"&&
     typeof item.serviceConfig?.uri==="string"&&
     item.serviceConfig.uri.startsWith("https://")&&
     isObj(item.serviceConfig.environmentVariables)&&
     Object.entries(EXPECTED_FLAGS).every(([key,value])=>
      item.serviceConfig.environmentVariables[key]===value))
   ready++;
 }
 const ranking=rows.filter(x=>x?.name===ROOT+"getVerifiedJointCountRanking");
 if(ranking.length>1||ranking.some(x=>
    x.serviceConfig?.environmentVariables?.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"))
  STOP("JOINT_RANKING_UNEXPECTEDLY_ENABLED");
 return Object.freeze({
  sixOwnerFunctionsDeployed:deployed,
  sixOwnerFunctionsActiveWithReviewedFlags:ready,
  sixOwnerFunctionsReady:deployed===6&&ready===6,
  sixOwnerFunctionsAbsent:deployed===0,
  jointRankingDisabled:true
 });
}
export function classifyHosting(releases,version,files,sources){
 const name=releases?.releases?.[0]?.version?.name;
 if(!Array.isArray(releases?.releases)||releases.releases.length!==1||
    !HOSTING_VERSION.test(name||"")||
    !isObj(version)||version.name!==name||version.status!=="FINALIZED"||
    !isObj(version.config)||
    !Array.isArray(files)||files.length<5||files.length>30000||
    !isObj(sources)||keys(sources).length!==11||
    keys(sources).some(k=>!Object.hasOwn(SOURCES,k)))
   STOP("HOSTING_MANIFEST_UNVERIFIED");
 if(version.fileCount!=null&&Number(version.fileCount)!==files.length)
  STOP("HOSTING_COUNT_DRIFT");
 const map=new Map();
 for(const x of files){
  if(!isObj(x)||typeof x.path!=="string"||
     !/^\/[A-Za-z0-9./_-]{1,300}$/.test(x.path)||
     typeof x.hash!=="string"||!/^[a-f0-9]{64}$/i.test(x.hash)||
     map.has(x.path))STOP("HOSTING_FILE_INVALID");
  map.set(x.path,x.hash.toLowerCase());
 }
 for(const mandatory of ["/index.html","/partner-workspace.html",
   "/partner-invite.html","/owner-partner-admin.html","/partner-counts.html"]){
  if(!map.has(mandatory))STOP("HOSTING_CANONICAL_MISSING");
 }
 let present=0,matched=0;
 for(const [file,sha] of Object.entries(SOURCES)){
  const data=sources[file];
  if(typeof data!=="string"||blobSha(data)!==sha)
   STOP("HOSTING_REVIEWED_SOURCE_CHANGED");
  const actual=map.get("/"+file);
  if(actual!==undefined){
   present++;
   if(actual===uploadSha(data))matched++;
  }
 }
 return Object.freeze({
  ownerSetupHostingAssetsPresent:present,
  ownerSetupHostingAssetsExactMatch:matched,
  ownerSetupPageReady:present===11&&matched===11,
  ownerSetupAssetsAllAbsent:present===0,
  liveHostingConfigRead:true,
  originalCanonicalAssetsPresent:true
 });
}
export function readinessBoard({functions,hosting,publication}={}){
 if(!isObj(functions)||!isObj(hosting)||!isObj(publication)||
    publication.project!==PROJECT||
    publication.mode!=="LIVE_READ_ONLY_NO_DEPLOY"||
    publication.productionDocumentWrites!==0||
    !Array.isArray(publication.blockingReasons)||publication.safeToEnableNewRanking!==false)
  STOP("INPUT_NOT_AUDITED");
 const blockers=[];
 if(!functions.sixOwnerFunctionsReady){
  blockers.push(functions.sixOwnerFunctionsAbsent?
   "DEPLOY_SIX_OWNER_SETTINGS":"OWNER_FUNCTIONS_PARTIAL_OR_MISCONFIGURED");
 }
 if(!hosting.ownerSetupPageReady){
  blockers.push(hosting.ownerSetupAssetsAllAbsent?
   "PUBLISH_OWNER_SETUP_ELEVEN":"HOSTING_PARTIAL_OR_MISMATCH");
 }
 for(const b of publication.blockingReasons){
  if(!/^[A-Z0-9_]{3,90}$/.test(b))STOP("BLOCKER_UNTRUSTED");
  blockers.push(b);
 }
 blockers.push("REAL_PARTNER_COUNT_SAVE_NOT_PROVED");
 blockers.push("REAL_PARTNER_FINANCE_GET_LIST_DENIAL_NOT_PROVED");
 const nextStep=!functions.sixOwnerFunctionsReady?
   (functions.sixOwnerFunctionsAbsent?"DISPATCH_OWNER_SIX_MANUAL":"STOP_RECONCILE_OWNER_FUNCTIONS"):
   !hosting.ownerSetupPageReady?
   (hosting.ownerSetupAssetsAllAbsent?"DISPATCH_OWNER_ELEVEN_MANUAL":"STOP_RECONCILE_HOSTING"):
   !publication.ownerPublicationCatalogReady||
     !publication.allEnabledPartnerSkuMapped||
     !publication.reciprocalOwnerRankConsentReady?
     "OWNER_AND_PARTNER_CONFIGURE_EXPLICIT_CONSENT":
     "REAL_ACCOUNT_FINANCE_DENY_AND_COUNT_SAVE_TEST";
 return Object.freeze({
  project:PROJECT,mode:"LIVE_READ_ONLY_NO_DEPLOY",
  sixOwnerFunctionsDeployed:functions.sixOwnerFunctionsDeployed,
  sixOwnerFunctionsActiveWithReviewedFlags:
   functions.sixOwnerFunctionsActiveWithReviewedFlags,
  sixOwnerFunctionsReady:functions.sixOwnerFunctionsReady,
  ownerSetupHostingAssetsPresent:hosting.ownerSetupHostingAssetsPresent,
  ownerSetupHostingAssetsExactMatch:hosting.ownerSetupHostingAssetsExactMatch,
  ownerSetupPageReady:hosting.ownerSetupPageReady,
  partnerCompaniesApprovedForCountSharing:publication.activeApprovedPartnerCount,
  partnerCompaniesWithMappedRankCategories:publication.mappedPartnerCount,
  ownerPublicCatalogReady:publication.ownerPublicationCatalogReady,
  allEnabledPartnerSkuMapped:publication.allEnabledPartnerSkuMapped,
  reciprocalOwnerRankConsentReady:publication.reciprocalOwnerRankConsentReady,
  nextStep,blockingReasons:blockers,
  realPartnerCountSaveVerified:false,
  realPartnerFinanceGetListDeniedVerified:false,
  safeToEnableJointRanking:false,
  productionDocumentWrites:0,productionFunctionsDeploys:0,
  productionHostingReleases:0,productionRulesWrites:0
 });
}
async function main(){
 if(process.argv.length!==2||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
   STOP("UNAPPROVED_EXECUTION");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg.projects?.default!==PROJECT)STOP("PROJECT_ID");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getFirestore}=require("firebase-admin/firestore");
 const cred=applicationDefault();
 initializeApp({credential:cred,projectId:PROJECT});
 const read=async url=>{
  const allowedFunctions="https://cloudfunctions.googleapis.com/v2/projects/"+
   PROJECT+"/locations/"+REGION+"/functions?pageSize=1000";
  const allowedHosting="https://firebasehosting.googleapis.com/v1beta1/sites/nico-factory/";
  if(url!==allowedFunctions&&!url.startsWith(allowedHosting))STOP("URL_UNREVIEWED");
  const token=(await cred.getAccessToken())?.access_token;
  if(!token)STOP("AUTH_TOKEN_MISSING");
  const response=await fetch(url,{method:"GET",redirect:"error",
   cache:"no-store",headers:{Authorization:"Bearer "+token}});
  if(response.status!==200)STOP("EXTERNAL_READ_FAILED");
  const body=await response.json();
  if(!isObj(body))STOP("EXTERNAL_READ_FORMAT");
  return body;
 };
 const fn=await read("https://cloudfunctions.googleapis.com/v2/projects/"+
  PROJECT+"/locations/"+REGION+"/functions?pageSize=1000");
 if(!Array.isArray(fn.functions??[])||fn.nextPageToken)
  STOP("FUNCTION_LIST_PAGINATION");
 const f=classifyFunctions(fn.functions??[]);
 const release=await read("https://firebasehosting.googleapis.com/v1beta1/sites/nico-factory/releases?pageSize=1");
 const name=release?.releases?.[0]?.version?.name;
 if(!HOSTING_VERSION.test(name||""))STOP("HOSTING_VERSION_NAME");
 const version=await read("https://firebasehosting.googleapis.com/v1beta1/"+name);
 const files=[];let next="",pages=0;const used=new Set();
 do{
  if(++pages>60||used.has(next))STOP("FILE_PAGINATION");
  used.add(next);
  const query=new URLSearchParams({pageSize:"1000"});
  if(next)query.set("pageToken",next);
  const block=await read("https://firebasehosting.googleapis.com/v1beta1/"+
   name+"/files?"+query);
  if(!Array.isArray(block.files)||block.files.length>1000||
     block.files.length+files.length>30000)STOP("FILE_LIST_INCOMPLETE");
  files.push(...block.files);
  next=block.nextPageToken||"";
  if(typeof next!=="string"||next.length>3000)STOP("FILE_PAGE_TOKEN");
 }while(next);
 const sourceRoot=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const sources=Object.fromEntries(keys(SOURCES).map(file=>[
  file,readFileSync(path.join(sourceRoot,file),"utf8")]));
 const h=classifyHosting(release,version,files,sources);
 const published=await inspectSkuPublication(getFirestore());
 const report=readinessBoard({functions:f,hosting:h,publication:published});
 console.log("NICO_OWNER_SETUP_CHAIN_READINESS "+JSON.stringify(report));
 for(const b of report.blockingReasons)console.log("BLOCK_"+b);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_OWNER_SETUP_CHAIN_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_SETUP_CHAIN_UNVERIFIED");
  process.exitCode=1;
 });
}
