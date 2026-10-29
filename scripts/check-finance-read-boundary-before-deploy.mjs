#!/usr/bin/env node
/**
 * LOCAL STATIC RELEASE STOP-GATE. NEVER deploys, connects, writes, or deletes.
 * This is a NECESSARY check, never SUFFICIENT approval for production rules.
 *
 * Refuses broad same-company finance reads, independent additive get/list
 * permissions and non-internal finance writer paths. Older app versions must
 * first migrate to a protected count-only server API before deploying rules.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const roots=["products","records","recordCorrections","revenueGoals"];
const block=code=>{throw Error("FINANCE_RELEASE_BLOCK_"+code);};
function ruleBody(source,group){
 const needle="match /"+group+"/{";
 const start=source.indexOf(needle);
 if(start<0||source.indexOf(needle,start+needle.length)>=0)block("MISSING_OR_DUPLICATE_"+group);
 const end=source.indexOf("\n    match /",start+needle.length);
 return source.slice(start,end<0?undefined:end);
}
function checkAction(body,verb,group){
 const found=[...body.matchAll(new RegExp("allow\\s+"+verb+"\\s*:\\s*if\\s*([\\s\\S]*?);","g"))];
 if(found.length!==1)block("ACTION_"+group+"_"+verb);
 return found[0][1];
}
export function checkFinanceRulesBeforeDeploy(source){
 if(typeof source!=="string"||!/^rules_version = '2';/m.test(source))
   block("UNKNOWN_RULES");
 const helper=source.slice(source.indexOf("function isInternalFinanceReader(companyId)"));
 if(!helper.startsWith("function isInternalFinanceReader(companyId)")||
   !helper.includes("companyKind")||!helper.includes("accessKind")||
   !helper.includes("memberType")||
   !helper.includes("!= 'partner'"))
   block("MISSING_SERVER_PARTNER_GUARD");
 for(const group of roots){
   const body=ruleBody(source,group);
   const condition=checkAction(body,"read",group);
   // Require the restrictive AND before any owner/leader OR branch.
   if(/sameCompany\s*\(/.test(condition)||
      !/^\s*resource\.data\.companyId\s*!=\s*null\s*&&\s*isInternalFinanceReader\(resource\.data\.companyId\)\s*&&\s*\(\s*isCompany(?:Master|Owner)\(/.test(condition)||
      !/isCompanyOwner\(resource\.data\.companyId\)|isCompanyMaster\(resource\.data\.companyId\)/.test(condition))
     block("RAW_READ_"+group);
   // A separate Firestore allow get/list OR-grant can bypass allow read.
   const list=[...body.matchAll(/allow\s+list\s*:\s*if\s*([\s\S]*?);/g)];
   if(list.length)block("ADDITIVE_LIST_"+group);
   const gets=[...body.matchAll(/allow\s+get\s*:\s*if\s*([\s\S]*?);/g)];
   if(gets.length>1||(gets.length===1&&
      !(group==="records"&&
       gets[0][1].includes("!exists(")&&
       gets[0][1].includes("records/$(recordId)"))))
     block("ADDITIVE_GET_"+group);
   const create=checkAction(body,"create",group);
   if(!/^\s*isInternalFinanceReader\(request\.resource\.data\.companyId\)\s*&&\s*\(/.test(create))
     block("RAW_CREATE_"+group);
   if(group==="recordCorrections"){
     if(!/allow update,\s*delete:\s*if false;/.test(body))
       block("CORRECTION_IMMUTABILITY");
   }else{
     const update=checkAction(body,"update",group);
     if(!/^\s*isInternalFinanceReader\(resource\.data\.companyId\)\s*&&\s*\(/.test(update))
       block("RAW_UPDATE_"+group);
     const deletion=checkAction(body,"delete",group);
     if(deletion.trim()!=="false")block("RAW_DELETE_"+group);
   }
 }
 return {staticShapeValid:true,productionDeploymentApproved:false,
   emulatorVerificationRequired:true,liveBackupRestorationRequired:true};
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]&&process.argv[1]===self){
 try{
   const src=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
   const checked=checkFinanceRulesBeforeDeploy(src);
   if(!checked.staticShapeValid)throw Error("unknown");
   console.log("STATIC SHAPE PASS. Still requires verified backup, emulator, owner approval.");
 }catch{
   // Never reveal source rules or customer/account data in CI logs.
   console.error("BLOCK: direct financial collection read/write rules unsafe or unverified. No Firebase operations performed.");
   process.exitCode=2;
 }
}
