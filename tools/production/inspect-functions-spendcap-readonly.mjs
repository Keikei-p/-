#!/usr/bin/env node
/**
 * GET-only production Cloud Billing Functions spend-cap inventory.
 * Does not create, update, lift, enforce or delete budgets, and cannot
 * guarantee zero bills. Budget names, billing IDs, amounts and auth tokens
 * never enter the sanitized report or diagnostics.
 *
 * An enforced Cloud Run functions spend cap may pause EXISTING services
 * (including sales/LINE), so it is NOT a deployment authorization.
 *
 * Official underlying Cloud Run service identifier documented at:
 * https://docs.cloud.google.com/billing/docs/how-to/budget-api-spend-cap
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
export const PROJECT="sales-management-cc116";
export const PROJECT_NUMBER="904932511564";
export const SERVICE="services/152E-C115-5142";
export const BILLING_INFO="https://cloudbilling.googleapis.com/v1/projects/"+PROJECT+"/billingInfo";
const API="https://billingbudgets.googleapis.com/v1/";
const ACCOUNT=/^billingAccounts\/[0-9A-Fa-f-]{10,50}$/;
const stop=x=>{throw Error("STOP_NICO_SPENDCAP_READONLY_"+x);};
const safe=()=>({
 project:PROJECT,mode:"CLOUD_BILLING_SPEND_CAP_GET_ONLY",
 budgetInventoryReadable:false,spendCapConfigured:false,
 spendCapEnforced:false,spendCapLifted:false,
 spendCapOnlyAppliesToCloudRunService:false,
 projectServiceSpendCapVerified:false,allFourFunctionsDeployed:false,
 spendCapIsHardGuarantee:false,
 mayPauseExistingSalesAndLineFunctions:true,
 releaseAuthorized:false,productionWrites:0
});
function responseBody(res){
 return res?.json?.().catch(()=>stop("UNTRUSTED_RESPONSE"));
}
async function readJson(read,url){
 let res;
 try{res=await read(url);}
 catch{stop("NETWORK_UNVERIFIED");}
 if(!res||typeof res.status!=="number")stop("TRANSPORT_INVALID");
 if([401,403].includes(res.status))return {denied:true};
 if(res.status!==200)stop("API_STATUS_UNVERIFIED");
 const data=await responseBody(res);
 if(!data||typeof data!=="object"||Array.isArray(data))
  stop("API_JSON_UNVERIFIED");
 return {data};
}
export async function inspectSpendCap(read){
 if(typeof read!=="function")stop("READ_REQUIRED");
 const base=safe();
 const billing=await readJson(read,BILLING_INFO);
 if(billing.denied)return Object.freeze({...base,reason:"BILLING_METADATA_READ_DENIED"});
 const data=billing.data;
 if(data.name!=="projects/"+PROJECT+"/billingInfo"||
    typeof data.billingEnabled!=="boolean")stop("BILLING_IDENTITY");
 if(data.billingEnabled!==true||!ACCOUNT.test(data.billingAccountName||""))
  return Object.freeze({...base,reason:"NO_VERIFIED_BILLING_ACCOUNT"});
 const account=data.billingAccountName;
 const found=[];
 let next="";
 const tokens=new Set();
 for(let page=0;page<3;page++){
  const url=API+account+"/budgets?pageSize=100"+
   (next?"&pageToken="+encodeURIComponent(next):"");
  const res=await readJson(read,url);
  if(res.denied)return Object.freeze({...base,reason:"BUDGET_LIST_PERMISSION_DENIED"});
  const b=res.data;
  if(b.budgets!==undefined&&(!Array.isArray(b.budgets)||b.budgets.length>100))
   stop("BUDGET_LIST_SCHEMA");
  for(const item of b.budgets||[]){
   if(!item||typeof item!=="object"||Array.isArray(item))
    stop("BUDGET_ROW_SCHEMA");
   const scope=item.budgetFilter||{};
   // Require exactly the target project and Cloud Run service, monthly,
   // credits excluded, and verified spendCap state. A budget for all
   // products, all projects, or an alerts-only budget is NOT sufficient.
   if(!Array.isArray(scope.projects)||scope.projects.length!==1||
      scope.projects[0]!=="projects/"+PROJECT_NUMBER||
      !Array.isArray(scope.services)||scope.services.length!==1||
      scope.services[0]!==SERVICE||scope.calendarPeriod!=="MONTH"||
      scope.creditTypesTreatment!=="EXCLUDE_ALL_CREDITS")
    continue;
   const state=item.spendCap?.outputState;
   if(!["CONFIGURED","ENFORCED","LIFTED"].includes(state))
    continue;
   found.push(state);
  }
  if(b.nextPageToken===undefined||b.nextPageToken==="")return Object.freeze({
   ...base,budgetInventoryReadable:true,
   spendCapConfigured:found.includes("CONFIGURED"),
   spendCapEnforced:found.includes("ENFORCED"),
   spendCapLifted:found.includes("LIFTED"),
   spendCapOnlyAppliesToCloudRunService:found.length>0,
   projectServiceSpendCapVerified:found.length>0,
   reason:found.length?"MATCHING_SERVICE_CAP_OBSERVED_NOT_HARD_CAP":
    "NO_MATCHING_CONFIGURED_SERVICE_CAP"
  });
  if(typeof b.nextPageToken!=="string"||b.nextPageToken.length>1000||
     tokens.has(b.nextPageToken))stop("PAGINATION_UNTRUSTED");
  tokens.add(b.nextPageToken);next=b.nextPageToken;
 }
 // Never return a partial inventory as a verified budget result.
 stop("PAGINATION_LIMIT");
}
async function main(){
 if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  stop("WRONG_ENV");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg?.projects?.default!==PROJECT)stop("WRONG_PROJECT");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 let provider;
 try{provider=require("firebase-admin/app").applicationDefault();}
 catch{stop("NO_READONLY_IDENTITY");}
 const get=async url=>{
  if(url!==BILLING_INFO&&!url.startsWith(API+"billingAccounts/"))
   stop("UNAPPROVED_URL");
  const token=(await provider.getAccessToken())?.access_token;
  if(!token)stop("NO_TOKEN");
  return fetch(url,{method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token}});
 };
 const result=await inspectSpendCap(get);
 console.log("NICO_FUNCTIONS_SPENDCAP_READONLY "+JSON.stringify(result));
 console.log("NO_BUDGET_MODIFICATIONS_NO_FUNCTION_DEPLOY_NO_FINANCE_WRITES");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_NICO_SPENDCAP_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_NICO_SPENDCAP_READONLY_UNVERIFIED");
  process.exitCode=1;
 });
}
