#!/usr/bin/env node
/* READ ONLY failed one-shot owner correction deployment triage.
 * No Firebase write operations, no retry and NO printing raw cloud metadata.
 * This can identify whether Functions were partially created and classify
 * errors from Cloud Functions Operations, if accessible.
 */
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const NAMES=["listHubPartnerCounts","correctHubPartnerCounts"];
const STOP=x=>{throw Error("STOP_OWNER_FAILURE_TRIAGE_"+x)};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function classifyFailure(text){
 if(typeof text!=="string")return "UNKNOWN";
 if(/permission denied|permission.*required|not authorized|403|iam\.|does not have permission/i.test(text))
  return "IAM_PERMISSION";
 if(/quota|resource.exhausted|429|limit exceeded/i.test(text))
  return "QUOTA_OR_RATE_LIMIT";
 if(/billing|payment|required.*billing|no billing/i.test(text))
  return "BILLING_OR_BUDGET";
 if(/build failed|cloud build.*failed|failed to build|builder.*failed/i.test(text))
  return "BUILD_FAILURE";
 if(/artifact registry|container registry|image registry/i.test(text))
  return "ARTIFACT_REGISTRY";
 if(/service account|serviceagent|service agent/i.test(text))
  return "SERVICE_ACCOUNT_CONFIG";
 if(/already exists|already deployed|409|conflict/i.test(text))
  return "CONFLICT";
 if(/invalid argument|invalid configuration|invalid.*environment|invalid.*source|400/i.test(text))
  return "INVALID_CONFIG";
 if(/503|temporarily unavailable|internal server error|500|deadline exceeded/i.test(text))
  return "PLATFORM_TEMPORARY";
 return "UNKNOWN";
}
export function classifyFunctionInventory(data){
 if(!obj(data)||!Array.isArray(data.result)||data.result.length>500)STOP("INVENTORY");
 const found=Object.fromEntries(NAMES.map(x=>[x,[]]));
 for(const item of data.result){
  if(!obj(item))STOP("ITEM");
  const raw=item.id??item.name;
  if(typeof raw!=="string"||raw.length>500)STOP("ITEM_ID");
  const name=raw.split("/").at(-1);
  if(!NAMES.includes(name))continue;
  const matchesRegion=(item.region??item.location??item.regionId??null)===REGION;
  const matchesProject=(item.projectId??item.project??null)===PROJECT;
  const matchesCodebase=(item.codebase??item.labels?.["firebase-functions-codebase"]??null)==="hub-owner-correction-v3";
  const active=(item.state??item.status)==="ACTIVE";
  const flag=item.environmentVariables?.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED??
   item.serviceConfig?.environmentVariables?.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED??null;
  found[name].push({matchesRegion,matchesProject,matchesCodebase,active,
   flagExplicitlyDisabled:flag==="disabled",flagEnabled:flag==="enabled"});
 }
 if(NAMES.some(n=>found[n].length>1))STOP("DUPLICATE_TARGET");
 return Object.freeze({
  mode:"GET_ONLY_NO_DEPLOY",
  listHubPartnerCountsListed:found.listHubPartnerCounts.length===1,
  correctHubPartnerCountsListed:found.correctHubPartnerCounts.length===1,
  listTargetTokyoDisabled:found.listHubPartnerCounts.some(x=>
   x.matchesRegion&&x.matchesProject&&x.matchesCodebase&&x.active&&x.flagExplicitlyDisabled),
  correctTargetTokyoDisabled:found.correctHubPartnerCounts.some(x=>
   x.matchesRegion&&x.matchesProject&&x.matchesCodebase&&x.active&&x.flagExplicitlyDisabled),
  anyTargetFlagEnabled:NAMES.some(n=>found[n].some(x=>x.flagEnabled)),
  productionWrites:0,deployments:0,firestoreFinancialReads:0,
  realOwnerCorrectionAvailable:false
 });
}
export function classifyTargetOperations(data){
 if(!obj(data)||!Array.isArray(data.operations)||data.operations.length>100)
  STOP("OPERATIONS");
 const matches=[];
 for(const operation of data.operations){
  if(!obj(operation))STOP("OPERATION_ITEM");
  const target=operation.metadata?.target??operation.metadata?.resource??"";
  if(typeof target!=="string")continue;
  const name=NAMES.find(n=>target.endsWith("/functions/"+n)||target.endsWith("/"+n));
  if(!name)continue;
  const done=operation.done===true;
  matches.push({name,done,failed:done&&Boolean(operation.error),
   errorClass:done&&operation.error?classifyFailure(operation.error.message):null});
 }
 return Object.freeze({
  targetOperationsFound:matches.length,
  failuresByClass:Object.fromEntries([...new Set(matches.filter(x=>x.failed).map(x=>x.errorClass))]
   .map(key=>[key,matches.filter(x=>x.failed&&x.errorClass===key).length])),
  targetOperationStillPending:matches.some(x=>!x.done),
  targetOperationsSucceeded:matches.filter(x=>x.done&&!x.failed).length,
  noRawErrorsExposed:true
 });
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--readonly"||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    !process.env.RUNNER_TEMP)STOP("RUNTIME");
 const data=JSON.parse(readFileSync(
  path.join(process.env.RUNNER_TEMP,"nico-owner-triage.private.json"),"utf8"));
 const inventory=classifyFunctionInventory(data);
 console.log("OWNER_FAILED_RELEASE_LIVE_INVENTORY "+JSON.stringify(inventory));
 let credential;
 try{
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  credential=require("firebase-admin/app").applicationDefault();
 }catch{STOP("OAUTH_UNAVAILABLE");}
 let token;
 try{token=(await credential.getAccessToken())?.access_token;}
 catch{STOP("OAUTH_FAILED");}
 if(!token)STOP("OAUTH_FAILED");
 const url="https://cloudfunctions.googleapis.com/v2/projects/"+PROJECT+
  "/locations/"+REGION+"/operations?pageSize=50";
 let classification={operationsReadable:false,reason:"REMOTE_UNAVAILABLE"};
 try{
  const response=await fetch(url,{
   method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token},
   signal:AbortSignal.timeout(20000)});
  if(response.status===200){
   const ops=await response.json();
   classification={operationsReadable:true,...classifyTargetOperations(ops)};
  }else classification={operationsReadable:false,
   reason:response.status===403?"IAM_CANNOT_LIST":response.status===404?
    "NOT_SUPPORTED":"NON_200_GET"};
 }catch{classification={operationsReadable:false,reason:"GET_FAILED"};}
 console.log("OWNER_FAILED_RELEASE_OPERATIONS "+JSON.stringify(classification));
 console.log("READ_ONLY_NO_RETRY_NO_BUSINESS_DATA_WRITES");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_OWNER_FAILURE_TRIAGE_[A-Z_]+$/.test(e?.message??"")?
   e.message:"STOP_OWNER_FAILURE_TRIAGE_UNKNOWN");
  process.exitCode=1;
 });
}
