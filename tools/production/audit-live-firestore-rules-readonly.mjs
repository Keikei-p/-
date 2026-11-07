#!/usr/bin/env node
/**
 * READ ONLY: compare the rule source of the LIVE default Firestore Rules
 * release to the repository's currently reviewed firestore.rules.
 * Does NOT call Firestore, read user documents, publish rules or use an
 * impersonated user. Two metadata GETs ONLY and no credentials in logs.
 * An exact source match is NOT an authenticated partner GET/LIST proof.
 */
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PROJECT="sales-management-cc116";
export const RELEASE_URL="https://firebaserules.googleapis.com/v1/projects/"+
 PROJECT+"/releases/cloud.firestore";
const RULESET_PREFIX="https://firebaserules.googleapis.com/v1/";
const MATCH_SHA="d9f4df6a2ac0f8b5720534a2461ec66b94379190";
const halt=code=>{throw Error("STOP_NICO_LIVE_RULES_READONLY_"+code)};
const shape=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
export function gitBlob(source){
 if(typeof source!=="string")halt("INVALID_SOURCE");
 const x=Buffer.from(source,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+x.length+"\0"))
  .update(x).digest("hex");
}
function expectedRulesetUrl(response){
 const ruleset=response?.rulesetName;
 if(!shape(response)||response.name!=="projects/"+PROJECT+
    "/releases/cloud.firestore"||
    typeof ruleset!=="string"||
    !new RegExp("^projects/"+PROJECT+
      "/rulesets/[a-zA-Z0-9_-]{6,256}$").test(ruleset))
   halt("RELEASE_UNVERIFIED");
 return RULESET_PREFIX+ruleset;
}
function closedFinanceSource(source){
 // This is a secondary static check; emulator tests enforce actual
 // permissions for every role and query below.
 if(typeof source!=="string"||source.length<5000||
    !source.includes("rules_version = '2'")||
    !source.includes("function isCompanyMember(companyId)")||
    !source.includes("get('companyKind', 'internal') == 'internal'")||
    !source.includes("get('accessKind', 'internal') == 'internal'")||
    !source.includes("in ['internal', 'direct', 'member', 'managed']"))
   return false;
 for(const collection of ["products","records","recordCorrections","revenueGoals"]){
  const mark="match /"+collection+"/{";
  const ix=source.indexOf(mark);
  if(ix<0||source.indexOf(mark,ix+mark.length)>=0)return false;
  const section=source.slice(ix,source.indexOf("\n    match /",ix+10)<0?
   undefined:source.indexOf("\n    match /",ix+10));
  if(!/allow read:\s*if resource\.data\.companyId != null[\s\S]*?&& sameCompany\(resource\.data\.companyId\)/.test(section))
   return false;
 }
 return true;
}
const getJson=async(read,url)=>{
 let res;
 try{res=await read(url)}catch{halt("GET_UNVERIFIED")}
 if(!res||[401,403,404].includes(res.status))halt("READ_PERMISSION_OR_RELEASE_UNAVAILABLE");
 if(res.status!==200)halt("HTTP_UNVERIFIED");
 try{return await res.json()}catch{halt("JSON_UNVERIFIED")}
};
export async function auditLiveFirestoreRules({read,reviewedSource}={}){
 if(typeof read!=="function"||gitBlob(reviewedSource)!==MATCH_SHA)
  halt("REVIEWED_RULES_CHANGED");
 const release=await getJson(read,RELEASE_URL);
 const url=expectedRulesetUrl(release);
 const ruleset=await getJson(read,url);
 if(!shape(ruleset)||
    RULESET_PREFIX+ruleset.name!==url||
    !shape(ruleset.source)||
    !Array.isArray(ruleset.source.files)||
    ruleset.source.files.length!==1||
    typeof ruleset.source.files[0]?.content!=="string"||
    ruleset.source.files[0].content.length>250000)
  halt("RULESET_UNVERIFIED");
 const live=ruleset.source.files[0].content;
 const exactMatch=gitBlob(live)===MATCH_SHA;
 const safe=closedFinanceSource(live);
 // Never return or print source, user data, exact ruleset names, service
 // account IDs, project numbers or external response bodies.
 return Object.freeze({
  project:PROJECT,mode:"LIVE_FIRESTORE_RULES_METADATA_GET_ONLY",
  releaseReadable:true,sourceReadable:true,
  exactReviewedSource:exactMatch,
  liveFinanceBoundaryMarkers:safe,
  liveRulesMatchReviewedAndTested:exactMatch&&safe,
  testedAgainstSyntheticEmulatorOnly:true,
  realPartnerGetListProven:false,
  userDataReads:0,productionWrites:0,deploys:0
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  halt("WRONG_CONTEXT");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg?.projects?.default!==PROJECT)halt("WRONG_PROJECT");
 const reviewedSource=readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");
 if(gitBlob(reviewedSource)!==MATCH_SHA)halt("REVIEWED_RULES_CHANGED");
 let credential;
 try{
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  credential=require("firebase-admin/app").applicationDefault();
 }catch{halt("OAUTH_LIBRARY")}
 const read=async url=>{
  if(url!==RELEASE_URL&&!/^https:\/\/firebaserules\.googleapis\.com\/v1\/projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]{6,256}$/.test(url))
   halt("OTHER_ENDPOINT");
  const token=(await credential.getAccessToken())?.access_token;
  if(typeof token!=="string"||!token)halt("MISSING_TOKEN");
  return fetch(url,{method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token}});
 };
 const report=await auditLiveFirestoreRules({read,reviewedSource});
 console.log("NICO_LIVE_RULES_SOURCE_AUDIT "+JSON.stringify(report));
 if(!report.liveRulesMatchReviewedAndTested)halt("LIVE_DRIFT_BLOCK_RELEASE");
 console.log("NICO_LIVE_RULES_MATCH_EMULATOR_SOURCE_REAL_ACCOUNT_STILL_UNVERIFIED");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_NICO_LIVE_RULES_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_NICO_LIVE_RULES_READONLY_UNVERIFIED");
  process.exitCode=1;
 });
}
