#!/usr/bin/env node
/**
 * Production Firebase Rules release audit: ONLY authenticated management API GETs.
 * Reports which exact reviewed Rules text is ACTIVE on the default database.
 * NEVER logs Rules source, release identifiers, IAM, auth credentials or financial
 * documents. Does not call Firestore or the Rules test API or modify releases.
 */
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {proposeSecondaryFinanceFence} from "../../security/secondary-finance-read-fence.mjs";
const PROJECT="sales-management-cc116";
const HOST="https://firebaserules.googleapis.com/v1/";
const PREFIX="projects/"+PROJECT+"/";
const DEFAULT=PREFIX+"releases/cloud.firestore";
const DEFAULT_NAMED=PREFIX+"releases/cloud.firestore/(default)";
const RULESET=new RegExp("^projects/"+PROJECT+"/rulesets/[A-Za-z0-9_-]{1,180}$");
const STOP=code=>{throw Error("STOP_LIVE_FIRESTORE_RULES_"+code);};
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const sha=x=>createHash("sha256").update(x,"utf8").digest("hex");
const reply=async response=>{
 if(!response||response.status!==200)STOP("READ_DENIED_OR_UNKNOWN");
 try{return await response.json();}catch{STOP("INVALID_JSON");}
};
export async function inspectLiveFirestoreRules(read,mainRules){
 if(typeof read!=="function"||typeof mainRules!=="string"||
    !mainRules.includes("service cloud.firestore")||mainRules.length>256000)
  STOP("INVALID_AUDIT_INPUT");
 // Candidate is generated only from an immutable, pinned repository Rules blob.
 let candidate;
 try{candidate=proposeSecondaryFinanceFence(mainRules);}
 catch{STOP("CANDIDATE_SOURCE_UNVERIFIED");}
 let releaseResult;
 try{releaseResult=await read(HOST+DEFAULT);}catch{STOP("RELEASE_UNAVAILABLE");}
 if(releaseResult?.status===404){
  try{releaseResult=await read(HOST+DEFAULT_NAMED);}catch{STOP("RELEASE_UNAVAILABLE");}
 }
 const release=await reply(releaseResult);
 if(!isObj(release)||![DEFAULT,DEFAULT_NAMED].includes(release.name)||
    typeof release.rulesetName!=="string"||!RULESET.test(release.rulesetName))
  STOP("UNRECOGNIZED_RELEASE");
 let rulesResponse;
 try{rulesResponse=await read(HOST+release.rulesetName);}
 catch{STOP("RULESET_UNAVAILABLE");}
 const ruleset=await reply(rulesResponse);
 if(!isObj(ruleset)||ruleset.name!==release.rulesetName||
    !isObj(ruleset.source)||!Array.isArray(ruleset.source.files)||
    ruleset.source.files.length!==1)STOP("UNVERIFIABLE_RULESET_FILES");
 const file=ruleset.source.files[0];
 if(!isObj(file)||typeof file.content!=="string"||
    file.content.length<100||file.content.length>256000)
  STOP("UNVERIFIABLE_RULESET_SOURCE");
 // Byte exact comparison; never normalize source in order to claim equality.
 const digest=sha(file.content);
 const main=digest===sha(mainRules);
 const secondary=digest===sha(candidate);
 return Object.freeze({
  project:PROJECT,
  mode:"FIREBASE_RULES_RELEASE_AND_RULESET_GET_ONLY",
  defaultFirestoreReleaseFound:true,
  exactlyOneSourceFile:true,
  deployedSourceExactlyMatchesReviewedMain:main,
  deployedSourceExactlyMatchesSecondaryFenceCandidate:secondary,
  deployedSourceUnexpected:!main&&!secondary,
  // A matching source cannot prove which identity fields existing users have.
  productionPartnerIdentityMarkersVerified:false,
  productionPartnerFinanceGetListDeniedProven:false,
  safeToEnableJointRanking:false,
  safeToApplyFinanceRules:false,
  firebaseRulesWrites:0,
  firestoreReads:0,
  firestoreWrites:0,
  functionInvocations:0
 });
}
async function main(){
 if(process.argv.length!==2||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.RUNNER_TEMP||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("UNAPPROVED_RUNNER");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg.projects?.default!==PROJECT)STOP("WRONG_FIREBASE_PROJECT");
 const source=readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");
 let creds;
 try{
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  creds=require("firebase-admin/app").applicationDefault();
 }catch{STOP("MISSING_READ_IDENTITY");}
 const allowed=url=>url===HOST+DEFAULT||url===HOST+DEFAULT_NAMED||
  (typeof url==="string"&&url.startsWith(HOST+PREFIX+"rulesets/")&&
   RULESET.test(url.slice(HOST.length)));
 const read=async url=>{
  if(!allowed(url))STOP("UNAPPROVED_URL");
  const token=(await creds.getAccessToken())?.access_token;
  if(typeof token!=="string"||token.length<20)STOP("MISSING_OAUTH");
  return fetch(url,{method:"GET",cache:"no-store",redirect:"error",
   headers:{Authorization:"Bearer "+token}});
 };
 const result=await inspectLiveFirestoreRules(read,source);
 console.log("LIVE_FIRESTORE_RULESET_CLASSIFICATION "+JSON.stringify(result));
 if(result.deployedSourceUnexpected)
  console.log("BLOCK_LIVE_FIRESTORE_RULES_UNREVIEWED_SOURCE");
 else if(result.deployedSourceExactlyMatchesReviewedMain)
  console.log("LIVE_RULES_MATCH_REVIEWED_MAIN_NO_REAL_ACCOUNT_PROOF");
 else if(result.deployedSourceExactlyMatchesSecondaryFenceCandidate)
  console.log("LIVE_RULES_MATCH_SECONDARY_CANDIDATE_REAL_ACCOUNT_PROOF_REQUIRED");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{
  console.error(/^STOP_LIVE_FIRESTORE_RULES_[A-Z0-9_]+$/.test(err?.message||"")?
   err.message:"STOP_LIVE_FIRESTORE_RULES_UNKNOWN");
  process.exitCode=1;
 });
