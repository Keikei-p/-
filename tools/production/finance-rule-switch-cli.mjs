#!/usr/bin/env node
/**
 * GitHub Actions-only adapter for the exact-source staged Rules release.
 * Never accepts arbitrary project, URL, or Ruleset name from parameters.
 */
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {switchFinanceRules,PROJECT} from "./activate-staged-finance-rules.mjs";
import {classifyInventory} from "./inspect-four-count-cli-region-readonly.mjs";
import {inspect} from "./inspect-firestore-backups-readonly.mjs";
const abort=x=>{throw Error("STOP_FINANCE_SWITCH_CLI_"+x);};
const modes=["inspect","apply","rollback"];
const authorize=(mode)=>{
 if(!modes.includes(mode)||process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    !process.env.RUNNER_TEMP)abort("UNREVIEWED_RUNTIME");
 const expected=mode==="rollback"?"CONFIRM_ROLLBACK_TO_REVIEWED_FINANCE_BASELINE":
  mode==="apply"?"CONFIRM_ACTIVATE_STAGED_FINANCE_FENCE":"INSPECT_ONLY";
 if(process.env.NICO_FINANCE_RULES_CONFIRMATION!==expected)
  abort("APPROVAL_MISSING");
};
async function run(){
 const mode=process.argv[2];
 if(process.argv.length!==3)abort("ARGUMENT");
 authorize(mode);
 // Emergency rollback must not depend on the Functions API or firebase CLI.
 // Inspect/apply retain the full four-Function inventory gate.
 let ready=false;
 if(mode!=="rollback"){
  const scope=process.env.NICO_FUNCTION_INVENTORY_PATH;
  if(!scope||path.dirname(path.resolve(scope))!==path.resolve(process.env.RUNNER_TEMP))
   abort("INVENTORY_NOT_RUNNER_TEMP");
  const live=classifyInventory(JSON.parse(readFileSync(scope,"utf8")));
  ready=true;
  for(const f of Object.values(live.functions)){
   if(f.entries!==1||f.inTargetRegion!==1||f.activeState!==1||
      f.expectedCodebase!==1||f.workspaceFlagEnabled!==1||
      f.gen2Listed!==1||f.otherProject!==0)ready=false;
  }
 }
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 const getToken=async()=>(await credential.getAccessToken()).access_token;
 const request=async(method,resource,body)=>{
  if(!["GET","PATCH"].includes(method))abort("INVALID_HTTP_METHOD");
  const endpoint="https://firebaserules.googleapis.com/v1/"+resource;
  if(!/^https:\/\/firebaserules\.googleapis\.com\/v1\/projects\/sales-management-cc116\/(?:releases\/cloud\.firestore|rulesets\/[A-Za-z0-9_-]+)$/.test(endpoint))
   abort("UNEXPECTED_ENDPOINT");
  const token=await getToken();
  if(!token)abort("TOKEN_MISSING");
  const r=await fetch(endpoint,{
   method,redirect:"error",headers:{
    Authorization:"Bearer "+token,"Content-Type":"application/json"
   },body:method==="PATCH"?JSON.stringify(body):undefined
  });
  if(!r.ok)abort("RULES_HTTP_"+r.status);
  return r.json();
 };
 const backup=mode==="apply"?await inspect({getToken}):null;
 const output=await switchFinanceRules({
  mode,request,functionsReady:ready,backup,
  operatorApproval:true,
  ownerBeforeAttested:process.env.NICO_OWNER_BEFORE_PROOF==="OWNER_FINANCE_LOGIN_READ_VERIFIED",
  partnerCountsBeforeAttested:process.env.NICO_PARTNER_COUNTS_BEFORE_PROOF==="PARTNER_COUNTS_SAVE_CORRECT_VERIFIED"
 });
 // No PII, user IDs, email, Rules bodies, tokens or monetary data in output.
 console.log("NICO_RULES_SWITCH "+JSON.stringify(output));
 if(mode==="apply")
  console.log("ACTION_REQUIRED_POST_SWITCH_REAL_PARTNER_GET_LIST_DENIAL_AND_OWNER_READ_PLUS_COUNT_SAVE");
 else if(mode==="rollback")
  console.log("ROLLBACK_RULES_READBACK_CONFIRMED_NO_DOCUMENT_WRITES");
 else console.log("INSPECT_ONLY_NO_PRODUCTION_RULES_WRITE");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 run().catch(e=>{
  console.error(/^STOP_FINANCE_(?:RULES_CUTOVER|SWITCH_CLI)_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_FINANCE_RULES_SWITCH_UNVERIFIED");
  process.exitCode=1;
 });
