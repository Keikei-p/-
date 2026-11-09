#!/usr/bin/env node
/**
 * Sanitized, READ-ONLY ranking Function inventory from firebase functions:list.
 * Called only inside the existing audited GitHub Actions inventory workflow.
 * Never prints raw function metadata, environment variable values, tokens,
 * service accounts, configuration, endpoints or personal/company data.
 */
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const FUNCTION="getVerifiedJointCountRanking";
export const CODEBASE="ranking-owner-approvals";
const STOP=code=>{throw Error("STOP_RANKING_CLI_METADATA_"+code);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const resource=/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/;
export function classifyRankingMetadata(input){
 if(!obj(input)||!Array.isArray(input.result)||
    input.result.length>500||input.nextPageToken||
    input.result.some(item=>!obj(item)))STOP("UNVERIFIED_INVENTORY");
 const matches=[];
 for(const row of input.result){
  const raw=row.id??row.name;
  if(typeof raw!=="string"||raw.length<1||raw.length>500)
   STOP("UNTRUSTED_FUNCTION_ID");
  const parsed=raw.match(resource);
  const name=parsed?.[3]??(raw.includes("/")?null:raw);
  if(name!==FUNCTION)continue;
  const project=row.projectId??row.project??parsed?.[1]??null;
  const region=row.region??row.location??row.regionId??parsed?.[2]??null;
  const codebase=row.codebase??row.labels?.["firebase-functions-codebase"]??null;
  const platform=row.platform??row.generation??null;
  const state=row.state??row.status??null;
  const flags=row.environmentVariables??row.serviceConfig?.environmentVariables??null;
  // A name alone, an unspecified project, or missing region is never proof
  // of a valid production deployment.
  const validProject=project===PROJECT;
  const validRegion=region===REGION;
  const validCodebase=codebase===CODEBASE;
  const active=state==="ACTIVE";
  const gen2=typeof platform==="string"&&/(?:gcfv2|gen2|2nd)/i.test(platform);
  const featureKnown=obj(flags)&&Object.hasOwn(flags,"NICO_JOINT_COUNT_RANKING_ENABLED");
  matches.push({validProject,validRegion,validCodebase,active,gen2,
   flagKnown:Boolean(featureKnown),
   flagEnabled:Boolean(featureKnown&&flags.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled")});
 }
 const valid=matches.filter(x=>x.validProject&&x.validRegion&&x.validCodebase&&x.active&&x.gen2);
 const explicitlyDisabled=matches.length===1&&valid.length===1&&
  matches[0].flagKnown&&!matches[0].flagEnabled;
 return Object.freeze({
  project:PROJECT,
  functionName:FUNCTION,
  mode:"FIREBASE_CLI_METADATA_GET_ONLY",
  listed:matches.length>0,
  matchingInventoryRows:matches.length,
  exactRegionActiveGen2Codebase:valid.length===1&&matches.length===1,
  featureFlagKnown:matches.length===1&&matches[0].flagKnown,
  featureFlagExplicitlyDisabled:explicitlyDisabled,
  featureFlagEnabled:matches.some(x=>x.flagEnabled),
  safeToClaimDisabledDeployment:explicitlyDisabled,
  safeToClaimLiveRankings:false,
  serverFinanceAccessProven:false,
  realAccountCountCorrectionProven:false,
  originalFunctionInvocations:0,
  firestoreDocumentWrites:0,
  firebaseDeploys:0
 });
}
async function main(){
 const file=process.argv[2];
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.RUNNER_TEMP||
    process.argv.length!==3||
    path.dirname(path.resolve(file))!==path.resolve(process.env.RUNNER_TEMP))
  STOP("GITHUB_READONLY_MAIN_ONLY");
 let data;
 try{data=JSON.parse(readFileSync(file,"utf8"));}
 catch{STOP("BAD_PRIVATE_METADATA_JSON");}
 const result=classifyRankingMetadata(data);
 console.log("JOINT_RANKING_LIVE_METADATA "+JSON.stringify(result));
 console.log(result.listed?
  "JOINT_RANKING_FUNCTION_LISTED_METADATA_ONLY":
  "BLOCK_JOINT_RANKING_FUNCTION_NOT_LISTED");
 if(result.featureFlagEnabled)
  console.log("STOP_RANKING_FLAG_ENABLED_REQUIRES_REAL_ACCOUNT_SECURITY_PROOF");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{
  console.error(/^STOP_RANKING_CLI_METADATA_[A-Z0-9_]+$/.test(err?.message||"")?
   err.message:"STOP_RANKING_CLI_METADATA_UNVERIFIED");
  process.exitCode=1;
 });
