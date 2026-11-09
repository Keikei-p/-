#!/usr/bin/env node
/** Read-only inventory of a possibly PARTIALLY DEPLOYED isolated owner
 * correction Function release. Never logs credentials, function metadata,
 * target URLs, environment variable values or private user records.
 */
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const PROJECT="sales-management-cc116",REGION="asia-northeast1",CODEBASE="hub-owner-correction-v3";
const NAMES=Object.freeze(["listHubPartnerCounts","correctHubPartnerCounts"]);
const STOP=x=>{throw Error("STOP_OWNER_CORRECTION_LIVE_INVENTORY_"+x);};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function classifyLiveOwnerCorrectionInventory(data){
 if(!object(data)||!Array.isArray(data.result)||data.result.length>500||
  data.nextPageToken||data.result.some(x=>!object(x)))
  STOP("UNVERIFIED_RESPONSE");
 const rows=Object.fromEntries(NAMES.map(n=>[n,[]]));
 for(const f of data.result){
  const raw=f.id??f.name;
  if(typeof raw!=="string"||raw.length>500)STOP("UNTRUSTED_ID");
  const found=raw.match(/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/);
  const name=found?.[3]??(!raw.includes("/")?raw:null);
  if(!NAMES.includes(name))continue;
  const project=f.projectId??f.project??found?.[1];
  const region=f.region??f.location??f.regionId??found?.[2];
  const codebase=f.codebase??f.labels?.["firebase-functions-codebase"];
  const state=f.state??f.status;
  const platform=f.platform??f.generation;
  const flags=f.environmentVariables??f.serviceConfig?.environmentVariables;
  rows[name].push({
   correctProject:project===PROJECT,correctRegion:region===REGION,
   correctCodebase:codebase===CODEBASE,
   active:state==="ACTIVE",gen2:typeof platform==="string"&&
    /(?:gcfv2|gen2|2nd)/i.test(platform),
   flagKnown:object(flags)&&Object.hasOwn(flags,"HUB_OWNER_COUNT_CORRECTION_V3_ENABLED"),
   enabled:object(flags)&&flags.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled",
   disabled:object(flags)&&flags.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="disabled"
  });
 }
 const functions={};
 for(const name of NAMES){
  const arr=rows[name],good=arr.length===1&&arr[0].correctProject&&
   arr[0].correctRegion&&arr[0].correctCodebase&&arr[0].active&&arr[0].gen2;
  functions[name]={
   listed:arr.length>0,
   entries:arr.length,
   exactTokyoGen2ActiveReviewedCodebase:good,
   flagKnown:good&&arr[0].flagKnown,
   explicitlyDisabled:good&&arr[0].disabled,
   unexpectedlyEnabled:arr.some(x=>x.enabled)
  };
 }
 const bothReady=NAMES.every(name=>functions[name].exactTokyoGen2ActiveReviewedCodebase);
 const bothDisabled=bothReady&&NAMES.every(name=>functions[name].explicitlyDisabled);
 return Object.freeze({
  project:PROJECT,mode:"FIREBASE_FUNCTIONS_LIST_READONLY",
  functions,
  partialDeploy:NAMES.some(n=>functions[n].listed)&&!NAMES.every(n=>functions[n].listed),
  bothFunctionsActiveGen2:bothReady,
  bothFunctionsExplicitlyDisabled:bothDisabled,
  safeToClaimLiveCorrections:false,
  canSkipRealOwnerAccountAndFinanceSecurityVerification:false,
  productionFunctionsDeployedByAudit:0,
  firestoreDocumentsRead:0,firestoreDocumentsWritten:0,
  hostingWrites:0,ruleWrites:0
 });
}
async function main(){
 if(process.argv.length!==3||process.env.GITHUB_ACTIONS!=="true"||
  process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
  process.env.GITHUB_REF!=="refs/heads/main"||
  process.env.FIREBASE_PROJECT_ID!==PROJECT||
  !process.env.RUNNER_TEMP||
  path.dirname(path.resolve(process.argv[2]))!==path.resolve(process.env.RUNNER_TEMP))
  STOP("UNAPPROVED_RUNNER");
 let data;
 try{data=JSON.parse(readFileSync(process.argv[2],"utf8"));}
 catch{STOP("BAD_PRIVATE_JSON");}
 const result=classifyLiveOwnerCorrectionInventory(data);
 console.log("OWNER_CORRECTION_LIVE_METADATA "+JSON.stringify(result));
 if(result.partialDeploy)console.log("STOP_OWNER_FUNCTIONS_PARTIALLY_DEPLOYED");
 if(!result.bothFunctionsExplicitlyDisabled)
  console.log("BLOCK_OWNER_CORRECTION_WRITE_NOT_VERIFIED_SAFE");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_CORRECTION_LIVE_INVENTORY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_CORRECTION_LIVE_INVENTORY_UNKNOWN");
  process.exitCode=1;
 });
