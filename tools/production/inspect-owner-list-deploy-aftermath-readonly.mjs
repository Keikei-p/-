#!/usr/bin/env node
/**
 * Strict GET-only postfailure forensic review. The prior single-target deploy
 * CLI returned a nonzero exit and CLI list inventory changed. This code NEVER
 * retries the deploy and never logs raw Cloud Functions metadata or secrets.
 */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {ORIGINAL} from "./inspect-original-partner-functions-readonly.mjs";
import {immutableOriginal} from "./protect-ranking-original-functions-versions.mjs";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const START="2026-11-09T08:45:41Z";
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const URLS=Object.freeze({
 v1:"https://cloudfunctions.googleapis.com/v1/"+ROOT,
 v2:"https://cloudfunctions.googleapis.com/v2/"+ROOT
});
const CODEBASE="hub-owner-correction-v3";
const OWNER_NAMES=Object.freeze(["listHubPartnerCounts","correctHubPartnerCounts"]);
const STOP=x=>{throw Error("STOP_OWNER_AFTER_FAILURE_READONLY_"+x)};
const validTime=x=>typeof x==="string"&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(x)&&
 Number.isFinite(Date.parse(x));
const object=x=>x&&typeof x==="object"&&!Array.isArray(x);
export function classifyOwnerTarget(name,body){
 if(!OWNER_NAMES.includes(name)||!object(body)||
    body.name!==ROOT+name||body.state!=="ACTIVE"||
    !validTime(body.updateTime)||
    body.labels?.["firebase-functions-codebase"]!==CODEBASE||
    !object(body.serviceConfig)||!object(body.buildConfig))
  STOP("TARGET_METADATA");
 const flag=body.serviceConfig.environmentVariables?.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED;
 if(!["enabled","disabled"].includes(flag))STOP("TARGET_FLAG_UNKNOWN");
 const min=body.serviceConfig.minInstanceCount;
 const max=body.serviceConfig.maxInstanceCount;
 if(min!=null&&Number(min)!==0)STOP("UNEXPECTED_MIN_INSTANCES");
 if(max!=null&&Number(max)>2)STOP("UNEXPECTED_MAX_INSTANCES");
 return Object.freeze({
  name: name==="listHubPartnerCounts"?"list":"correction",
  active:true,codebaseVerified:true,
  enabled:flag==="enabled",disabled:flag==="disabled",
  updatedSinceFailedDeployStart:Date.parse(body.updateTime)>=Date.parse(START)
 });
}
export async function inspectAfterOwnerListFailure({read}={}){
 if(typeof read!=="function")STOP("GET_REQUIRED");
 const targets={};
 for(const name of OWNER_NAMES){
  const res=await read(URLS.v2+name);
  if(res?.status!==200)STOP("TARGET_GET_UNAVAILABLE");
  const body=await res.json();
  targets[name]=classifyOwnerTarget(name,body);
 }
 let originalsChecked=0,originalsUpdatedSinceStart=0,originalsMissing=0;
 for(const name of ORIGINAL){
  let generations=0;
  for(const generation of ["v2","v1"]){
   const res=await read(URLS[generation]+name);
   if(res?.status===404)continue;
   if(res?.status!==200)STOP("ORIGINAL_REMOTE_ERROR");
   const body=await res.json();
   // Verify original metadata shape, generation and active state using
   // the existing immutable fingerprints, never print fingerprints/raw data.
   immutableOriginal(name,body,generation);
   generations++;originalsChecked++;
   if(Date.parse(body.updateTime)>=Date.parse(START))originalsUpdatedSinceStart++;
  }
  if(!generations)originalsMissing++;
 }
 if(originalsMissing)STOP("ORIGINAL_FUNCTION_MISSING");
 const reader=targets.listHubPartnerCounts,writer=targets.correctHubPartnerCounts;
 return Object.freeze({
  audit:"CLOUD_FUNCTIONS_API_DIRECT_GET_ONLY",
  list:reader,correction:writer,
  originalsChecked,originalsUpdatedSinceStart,
  originalSixStillPresent:true,
  sourceDeploymentStartUtc:START,
  cliInventoryWasUnstable:true,
  releaseVerifiedAsExactOne:reader.enabled&&writer.disabled&&
    !writer.updatedSinceFailedDeployStart&&originalsUpdatedSinceStart===0,
  safeToEnableCorrection:false,
  authenticatedOwnerRealAccountTested:false,
  readOnly:true,functionsDeployedByAudit:0,firestoreWrites:0,financeReads:0
 });
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("APPROVED_MAIN_ONLY");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const credential=require("firebase-admin/app").applicationDefault();
 const allowed=new Set([
  ...OWNER_NAMES.map(n=>URLS.v2+n),
  ...ORIGINAL.flatMap(n=>[URLS.v2+n,URLS.v1+n])
 ]);
 const read=async url=>{
  if(!allowed.has(url))STOP("GET_URL_NOT_ALLOWLISTED");
  const token=(await credential.getAccessToken())?.access_token;
  if(typeof token!=="string"||token.length<20)STOP("OAUTH_UNAVAILABLE");
  const res=await fetch(url,{method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token}});
  if(res.status===404)return {status:404};
  if(res.status!==200)return {status:res.status};
  const raw=await res.text();
  if(raw.length>180000)STOP("RESPONSE_TOO_LARGE");
  let json;try{json=JSON.parse(raw)}catch{STOP("JSON_UNVERIFIED")}
  return {status:200,json:async()=>json};
 };
 const report=await inspectAfterOwnerListFailure({read});
 console.log("OWNER_LIST_AFTER_FAILURE_LIVE "+JSON.stringify(report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_AFTER_FAILURE_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_AFTER_FAILURE_READONLY_UNKNOWN");
  process.exitCode=1;
 });
