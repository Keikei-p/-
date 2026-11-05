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

// Independent Firestore allow grants are OR-combined. A broad OR at the top
// of a read/write predicate must never be approved by a substring match.
function hasTopLevelOr(expr){
 let depth=0,quote='',escape=false;
 for(let i=0;i<expr.length;i++){
  const ch=expr[i];
  if(quote){
   if(escape)escape=false;
   else if(ch==='\\')escape=true;
   else if(ch===quote)quote='';
   continue;
  }
  if(ch==='"'||ch==="'"){quote=ch;continue;}
  if(ch==='('){depth++;continue;}
  if(ch===')'){depth--;if(depth<0)return true;continue;}
  if(depth===0&&ch==='|'&&expr[i+1]==='|')return true;
 }
 return depth!==0||Boolean(quote);
}
function verifyFinanceHelper(source){
 const matches=[...source.matchAll(/function\s+isInternalFinanceReader\(companyId\)\s*\{([^}]*)\}/g)];
 if(matches.length!==1)block('MISSING_SERVER_PARTNER_GUARD');
 const helper=matches[0][1].replace(/\s+/g,'');
 if(!/^return(?:noSecondaryPartnerWorkspace\(\)&&)?companyId!=null&&/.test(helper)||
    (source.includes('function noSecondaryPartnerWorkspace()')&&
     !helper.startsWith('returnnoSecondaryPartnerWorkspace()&&'))||
    helper.includes('||')||hasTopLevelOr(matches[0][1]))block('MISSING_SERVER_PARTNER_GUARD');
 for(const condition of [
  "get(companyPath(companyId)).data.get('companyKind','internal')=='internal'",
  "get(userPath(request.auth.uid)).data.get('accessKind','internal')=='internal'",
  "get(memberPath(companyId,request.auth.uid)).data.get('accessKind','internal')=='internal'"
 ])if(!helper.includes(condition))block('MISSING_SERVER_PARTNER_GUARD');
 for(const marker of [
  "get(userPath(request.auth.uid)).data.get('memberType','internal')",
  "get(memberPath(companyId,request.auth.uid)).data.get('memberType','internal')"
 ]){
  if(!helper.includes(marker+"in['internal','direct','member','managed']")||
     !helper.includes(marker+"!='partner'")||
     !helper.includes(marker+"!='cooperator'"))
   block('MISSING_SERVER_PARTNER_GUARD');
 }
}

export function checkFinanceRulesBeforeDeploy(source){
 if(typeof source!=="string"||!/^rules_version = '2';/m.test(source))
   block("UNKNOWN_RULES");
 verifyFinanceHelper(source);
 for(const group of roots){
   const body=ruleBody(source,group);
   const condition=checkAction(body,"read",group);
   // Exactly these two established internal principals may read raw
   // monetary documents. Static checks must not approve "|| true" inside
   // the owner clause or an additional manager/employee grant.
   const normalized=condition.replace(/\s+/g,'');
   const prefix='resource.data.companyId!=null&&isInternalFinanceReader(resource.data.companyId)&&(';
   const m='isCompanyMaster(resource.data.companyId)';
   const o='isCompanyOwner(resource.data.companyId)';
   const recognized=normalized===prefix+m+'||'+o+')'||
     normalized===prefix+o+'||'+m+')';
   // Require the restrictive AND before any owner/leader OR branch.
   if(!recognized||hasTopLevelOr(condition)||/sameCompany\s*\(/.test(condition)||
      !/^\s*resource\.data\.companyId\s*!=\s*null\s*&&\s*isInternalFinanceReader\(resource\.data\.companyId\)\s*&&\s*\(\s*isCompany(?:Master|Owner)\(/.test(condition)||
      !/isCompanyOwner\(resource\.data\.companyId\)|isCompanyMaster\(resource\.data\.companyId\)/.test(condition))
     block("RAW_READ_"+group);
   // A separate Firestore allow get/list OR-grant can bypass allow read.
   const list=[...body.matchAll(/allow\s+list\s*:\s*if\s*([\s\S]*?);/g)];
   if(list.length)block("ADDITIVE_LIST_"+group);
   const gets=[...body.matchAll(/allow\s+get\s*:\s*if\s*([\s\S]*?);/g)];
   if(gets.length>1||(gets.length===1&&
      !(group==="records"&&
       !hasTopLevelOr(gets[0][1])&&
       gets[0][1].trim().endsWith("!exists(/databases/$(database)/documents/records/$(recordId))")&&
       (!source.includes("function noSecondaryPartnerWorkspace()")||
        /^\s*noSecondaryPartnerWorkspace\(\)\s*&&/.test(gets[0][1])))))
     block("ADDITIVE_GET_"+group);
   const create=checkAction(body,"create",group);
   if(hasTopLevelOr(create)||!/^\s*isInternalFinanceReader\(request\.resource\.data\.companyId\)\s*&&\s*\(/.test(create))
     block("RAW_CREATE_"+group);
   if(group==="recordCorrections"){
     if(!/allow update,\s*delete:\s*if false;/.test(body))
       block("CORRECTION_IMMUTABILITY");
   }else{
     const update=checkAction(body,"update",group);
     if(hasTopLevelOr(update)||!/^\s*isInternalFinanceReader\(resource\.data\.companyId\)\s*&&\s*\(/.test(update))
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
