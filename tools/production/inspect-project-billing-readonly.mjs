#!/usr/bin/env node
/**
 * Project-scoped Cloud Billing metadata GET only.
 * DOES NOT verify the yen amount, trial eligibility, unspent credits, or
 * zero future charges. Never requests or prints a billing account identifier.
 * No billing modifications, budget writes, Functions invocations or deploy.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PROJECT="sales-management-cc116";
export const BILLING_INFO_URL="https://cloudbilling.googleapis.com/v1/projects/"+PROJECT+"/billingInfo";
const stop=x=>{throw Error("STOP_NICO_BILLING_READONLY_"+x)};

export async function inspectProjectBilling(read){
 if(typeof read!=="function")stop("READ_REQUIRED");
 let response;
 try{response=await read(BILLING_INFO_URL)}catch{stop("REMOTE_UNVERIFIED")}
 if(!response||![200,401,403,404].includes(response.status))
  stop("HTTP_UNVERIFIED");
 if(response.status===401||response.status===403)
  return Object.freeze({
   project:PROJECT,
   mode:"PROJECT_BILLING_METADATA_GET_ONLY",
   billingMetadataReadable:false,
   billingEnabled:null,
   trialCreditBalanceVerified:false,
   trialExpiryVerified:false,
   noRecurringChargeGuaranteed:false,
   releaseCostGatePassed:false,
   reason:"BILLING_GET_PERMISSION_DENIED",
   productionWrites:0
  });
 if(response.status===404)stop("PROJECT_OR_BILLING_RESOURCE_UNVERIFIED");
 let data;
 try{data=await response.json()}catch{stop("JSON_UNVERIFIED")}
 if(!data||typeof data!=="object"||Array.isArray(data)||
    data.name!=="projects/"+PROJECT+"/billingInfo"||
    typeof data.billingEnabled!=="boolean"||
    (data.billingAccountName!==undefined&&
     (typeof data.billingAccountName!=="string"||
      !/^billingAccounts\/[A-Za-z0-9_-]+$/.test(data.billingAccountName))))
  stop("BILLING_RESPONSE_INVALID");
 return Object.freeze({
  project:PROJECT,
  mode:"PROJECT_BILLING_METADATA_GET_ONLY",
  billingMetadataReadable:true,
  billingEnabled:data.billingEnabled,
  linkedBillingAccount:Boolean(data.billingAccountName),
  trialCreditBalanceVerified:false,
  trialExpiryVerified:false,
  noRecurringChargeGuaranteed:false,
  releaseCostGatePassed:false,
  reason:"CREDITS_AND_FUTURE_CHARGES_NOT_VERIFIABLE_BY_THIS_API",
  productionWrites:0
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
   stop("WRONG_CONTEXT");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg?.projects?.default!==PROJECT)stop("WRONG_PROJECT");
 let credential;
 try{
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  credential=require("firebase-admin/app").applicationDefault();
 }catch{stop("OAUTH_LIBRARY")}
 const read=async url=>{
  if(url!==BILLING_INFO_URL)stop("OTHER_ENDPOINT");
  const token=(await credential.getAccessToken())?.access_token;
  if(!token)stop("MISSING_TOKEN");
  return fetch(url,{
   method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token}
  });
 };
 const result=await inspectProjectBilling(read);
 console.log("NICO_BILLING_METADATA_SAFE "+JSON.stringify(result));
 if(!result.releaseCostGatePassed)console.log("BLOCK_RECURRING_CHARGES_NOT_GUARANTEED");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_NICO_BILLING_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_NICO_BILLING_READONLY_UNVERIFIED");
  process.exitCode=1;
 });
}
