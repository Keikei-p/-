#!/usr/bin/env node
/**
 * ONE-TIME, READ-ONLY retrospective audit for Nov 9 manual Function release.
 * The deploy CLI exited nonzero after Firebase actually created the new OFF
 * Function. Original version baseline was erased on workflow cleanup, so do
 * NOT falsely claim byte-identical pre/post fingerprints. Instead prove the
 * narrower fact: the six original deployed Function resources' updateTime
 * preceded the recorded dispatch start, and they are still ACTIVE.
 *
 * Cloud Functions GET v1/v2 metadata only. No Firestore, Cloud Run writes,
 * Function invocations, IAM updates, deployments or credentials in output.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {ORIGINAL} from "./inspect-original-partner-functions-readonly.mjs";
import {immutableOriginal} from "./protect-ranking-original-functions-versions.mjs";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const RANKING="getVerifiedJointCountRanking";
const START="2026-11-09T03:27:20Z"; // GitHub Actions run #42556489880 created_at.
const BASE="https://cloudfunctions.googleapis.com/";
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const STOP=code=>{throw Error("STOP_RANKING_RETROSPECTIVE_"+code);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const date=x=>typeof x==="string"&&
 /^20\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(x)&&
 Number.isFinite(Date.parse(x));
const endpoint=(generation,name)=>BASE+generation+"/"+ROOT+name;
const allowed=new Set([
 ...ORIGINAL.flatMap(name=>["v2","v1"].map(v=>endpoint(v,name))),
 endpoint("v2",RANKING)
]);
const json=async response=>{
 try{return await response.json();}catch{STOP("UNREADABLE_METADATA");}
};
export async function auditRetrospectiveReadOnly(read,{dispatchStart=START}={}){
 if(typeof read!=="function"||!date(dispatchStart))STOP("BAD_AUDIT_INPUT");
 const first=Date.parse(dispatchStart);
 const versions={};
 for(const name of ORIGINAL){
  let present=0;
  const known=[];
  for(const generation of ["v2","v1"]){
   const url=endpoint(generation,name);
   let response;
   try{response=await read(url);}catch{STOP("REMOTE_UNAVAILABLE");}
   if(response?.status===404)continue;
   if(response?.status!==200)STOP("ORIGINAL_METADATA_READ_DENIED");
   const body=await json(response);
   // Existing fail-close guard validates deployment identity/state/runtime
   // and fingerprints fields without logging the raw metadata.
   immutableOriginal(name,body,generation);
   if(!date(body.updateTime)||Date.parse(body.updateTime)>first)
    STOP("ORIGINAL_UPDATED_AFTER_DISPATCH_START");
   present++;
   known.push(generation);
  }
  if(present===0)STOP("ORIGINAL_MISSING");
  versions[name]=known;
 }
 let response;
 try{response=await read(endpoint("v2",RANKING));}
 catch{STOP("RANKING_REMOTE_UNAVAILABLE");}
 if(response?.status!==200)STOP("RANKING_NOT_ACTIVE");
 const ranking=await json(response);
 const variables=ranking?.serviceConfig?.environmentVariables;
 if(!obj(ranking)||ranking.name!==ROOT+RANKING||
    ranking.state!=="ACTIVE"||!obj(ranking.buildConfig)||
    !obj(ranking.serviceConfig)||
    !obj(variables)||
    variables.NICO_JOINT_COUNT_RANKING_ENABLED!=="disabled")
  STOP("RANKING_NOT_VERIFIED_EXPLICIT_OFF");
 if(!date(ranking.createTime)||Date.parse(ranking.createTime)<first)
  STOP("RANKING_CREATION_TIME_UNVERIFIED");
 return Object.freeze({
  project:PROJECT,mode:"EXACT_CLOUD_FUNCTIONS_METADATA_GET_ONLY",
  dispatchRun:42556489880,
  originalSixPresentAndActive:true,
  originalSixMetadataUpdateBeforeDispatch:true,
  originalSixGenerationCount:Object.values(versions).reduce((sum,v)=>sum+v.length,0),
  rankingExistsActiveGen2ExplicitOff:true,
  // The original release's ephemeral pre-deploy hashes were not retained.
  originalVersionsByteIdenticalBeforeAndAfterProven:false,
  originalIamPolicyUnchangedProven:false,
  rankingAuthenticatedUserFlowProven:false,
  publicRankingReleaseAuthorized:false,
  financeRulesProtectionProven:false,
  firestoreWrites:0,
  productionDeploys:0,
  functionInvocations:0
 });
}
async function main(){
 if(process.argv.length!==2||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("RUNNER_CONTEXT_UNVERIFIED");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg?.projects?.default!==PROJECT)STOP("FIREBASE_PROJECT_MISMATCH");
 let credentials;
 try{
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  credentials=require("firebase-admin/app").applicationDefault();
 }catch{STOP("CREDENTIAL_LIBRARY_UNAVAILABLE");}
 const read=async url=>{
  if(!allowed.has(url))STOP("UNAPPROVED_ENDPOINT");
  const token=(await credentials.getAccessToken())?.access_token;
  if(typeof token!=="string"||token.length<20)STOP("MISSING_TOKEN");
  return fetch(url,{method:"GET",cache:"no-store",redirect:"error",
   headers:{Authorization:"Bearer "+token}});
 };
 const result=await auditRetrospectiveReadOnly(read);
 console.log("RANKING_RETROSPECTIVE_METADATA "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{
  console.error(/^STOP_RANKING_RETROSPECTIVE_[A-Z0-9_]+$/.test(err?.message||"")?
   err.message:"STOP_RANKING_RETROSPECTIVE_UNKNOWN");
  process.exitCode=1;
 });
