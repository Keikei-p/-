#!/usr/bin/env node
/**
 * Production Rules-only release audit for a non-master Owner archive/restore.
 * No Firestore document reads or writes; Rules management API GET only.
 */
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {
  readDeployedOwnerArchiveRules,
  verifyScopedArchiveRules
} from "./audit-owner-archive-rules-release.mjs";

const PROJECT="sales-management-cc116";
const BEFORE="85ba8d0f86c693b79fc669ddb87c541c1f58d0bf";
const REVIEWED="6f20244475ba62fc15178a49b9ce6c8d4095cd60";
const RULE_OLD="1ce70f0183b57e94f34a85a0b38a70019932f5ea";
const RULE_NEW="6d3f165791188394d473417414e34208cd56bae6";
const PREFIX="https://firebaserules.googleapis.com/v1/projects/"+PROJECT+"/";
const fail=code=>{throw Error("STOP_NONMASTER_OWNER_ARCHIVE_"+code);};

function git(...args){return execFileSync("git",args,{encoding:"utf8",maxBuffer:300000}).trim();}
export function scopeReviewedSecondaryOwnerRules(before,after){
  verifyScopedArchiveRules(before,after);
  const products="match /products/{productId} {";
  const next="match /records/{recordId} {";
  const b=before.slice(before.indexOf(products),before.indexOf(next,before.indexOf(products)));
  const a=after.slice(after.indexOf(products),after.indexOf(next,after.indexOf(products)));
  const oldStart=b.indexOf("      allow update: if resource.data.companyId != null");
  const newStart=a.indexOf("      // Evaluate the narrow reversible Owner-only active toggle FIRST.");
  const deleteAt="      // Historical business documents are retained:";
  const oldEnd=b.indexOf(deleteAt,oldStart),newEnd=a.indexOf(deleteAt,newStart);
  if(oldStart<0||newStart<0||oldEnd<0||newEnd<0||
     before===after||b.slice(0,oldStart)!==a.slice(0,newStart)||
     b.slice(oldEnd)!==a.slice(newEnd)||
     !a.includes("      allow delete: if false;")||
     !a.includes("hasOnly(['active', 'updatedAt'])")||
     !a.includes("isCompanyOwner(resource.data.companyId)")||
     !a.includes("isCompanyMaster(resource.data.companyId)")||
     !a.includes("canManageProducts(resource.data.companyId)")||
     !a.includes("'name', 'revenue', 'cashbackOptions', 'pricingOptions'"))
    fail("CHANGED_OUTSIDE_REVIEWED_OWNER_ACTIVE_UPDATE");
  const rule=a.slice(newStart,newEnd);
  const cheap=rule.indexOf("request.resource.data.diff(resource.data).affectedKeys()");
  const owner=rule.indexOf("isCompanyOwner(resource.data.companyId)");
  const general=rule.indexOf("canManageProducts(resource.data.companyId)");
  if(!(0<=cheap&&cheap<owner&&owner<general))
    fail("CHEAP_ACTIVE_DIFF_NOT_EVALUATED_FIRST");
  return Object.freeze({nonProductRulesIdentical:true,otherProductRulesIdentical:true,
    ownerUpdateOnlyActiveAndUpdatedAt:true,physicalDeleteForbidden:true});
}
export function checkDeployedSecondaryOwnerRules({phase,live,previous,next}={}){
  if(!["--before","--after"].includes(phase)||
      typeof live!=="string"||typeof previous!=="string"||typeof next!=="string")
    fail("BAD_PHASE");
  const scoped=scopeReviewedSecondaryOwnerRules(previous,next);
  if(live!==(phase==="--before"?previous:next))
    fail(phase==="--before"?"LIVE_RULES_PREIMAGE_DRIFT":"POST_RULES_NOT_DEPLOYED_EXACT");
  return {phase,project:PROJECT,liveRulesVerified:true,...scoped,
    productionSalesDocumentWrites:0,hostingWrites:0,authChanges:0};
}
async function main(){
  const phase=process.argv[2];
  if(process.argv.length!==3||process.env.GITHUB_ACTIONS!=="true"||
     process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
     process.env.GITHUB_REF!=="refs/heads/main"||
     process.env.FIREBASE_PROJECT_ID!==PROJECT||
     !process.env.GOOGLE_APPLICATION_CREDENTIALS)
    fail("RUNTIME_APPROVAL");
  if(JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8")).projects.default!==PROJECT)
    fail("FIREBASE_PROJECT_DRIFT");
  const before=execFileSync("git",["show",BEFORE+":firestore.rules"],{
    encoding:"utf8",maxBuffer:300000});
  const after=readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");
  if(git("rev-parse",BEFORE+":firestore.rules")!==RULE_OLD||
     git("rev-parse",REVIEWED+":firestore.rules")!==RULE_NEW||
     git("hash-object","firestore.rules")!==RULE_NEW)
    fail("GIT_REVIEWED_RULES_DRIFT");
  scopeReviewedSecondaryOwnerRules(before,after);
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {applicationDefault}=require("firebase-admin/app");
  const credential=applicationDefault();
  const get=async url=>{
    if(!url.startsWith(PREFIX)||url.includes("?"))fail("NON_RULES_API");
    const token=(await credential.getAccessToken()).access_token;
    return fetch(url,{method:"GET",redirect:"error",
      headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(20000)});
  };
  const live=await readDeployedOwnerArchiveRules({get});
  const inspected=checkDeployedSecondaryOwnerRules({phase,live,previous:before,next:after});
  console.log("NICO_NONMASTER_OWNER_ARCHIVE_RULES "+JSON.stringify(inspected));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{const message=e?.message||"";
   console.error(/^STOP_NONMASTER_OWNER_ARCHIVE_[A-Z_]+$/.test(message)?
     message:"STOP_NONMASTER_OWNER_ARCHIVE_UNVERIFIABLE");process.exitCode=1;});
