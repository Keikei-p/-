#!/usr/bin/env node
/**
 * Post-2026-11-02 production BOUNDARY VERIFY ONLY.
 * No production mutations, no Ruleset POST/PATCH, no deletes, no hosting.
 * Public CI output intentionally excludes document paths, IDs, names,
 * credentials, source Rules and all price/revenue/financial field values.
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collect, auditSummary, fingerprint, validateSafeCall} from '../readonly-backup/backup.mjs';
import {inspect} from './inspect-firestore-backups-readonly.mjs';
import {CANDIDATE} from './release-partner-boundary.mjs';

const PROJECT='sales-management-cc116';
const RULES='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
const RELEASE=RULES+'/releases/cloud.firestore';
const BACKUPS='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/locations/-/backups';
const RULESET=/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/;
const normalized=x=>x.replace(/\r\n/g,'\n').trim();
const sha=x=>createHash('sha256').update(normalized(x)).digest('hex');
const stop=x=>{throw Error('STOP_'+x);};

export function permitted(method,url,body){
 if(method==='GET'&&body===undefined&&url===RELEASE)return true;
 if(method==='GET'&&body===undefined&&url===BACKUPS)return true;
 if(method==='GET'&&body===undefined&&
    url.startsWith('https://firebaserules.googleapis.com/v1/')&&
    RULESET.test(url.slice('https://firebaserules.googleapis.com/v1/'.length)))return true;
 return validateSafeCall(method,url,body);
}
const ensure=predicate=>{if(!predicate)stop('BOUNDARY_NOT_VERIFIED');};
export async function audit({request,backup=inspect,inventory=collect,clock=()=>Date.now()}={}){
 if(typeof request!=='function')stop('MISSING_READ_ONLY_TRANSPORT');
 async function get(method,url,body){
  if(!permitted(method,url,body))stop('NON_READ_ONLY_REQUEST');
  const result=await request(method,url,body);
  if(!result||typeof result!=='object')stop('INVALID_READ_RESPONSE');
  return result;
 }
 const live=await get('GET',RELEASE);
 if(!RULESET.test(live.rulesetName||''))stop('UNKNOWN_RULESET');
 const readRules=async name=>{
  if(!RULESET.test(name||''))stop('UNKNOWN_RULESET');
  const res=await get('GET','https://firebaserules.googleapis.com/v1/'+name);
  if(res.source?.files?.length!==1||res.source.files[0].name!=='firestore.rules'||
     typeof res.source.files[0].content!=='string')stop('UNEXPECTED_RULES_FORMAT');
  return res.source.files[0].content;
 };
 ensure(sha(await readRules(live.rulesetName))===CANDIDATE);
 const available=await backup();
 const age=clock()-Date.parse(available.latestReadySnapshot);
 if(!Number.isSafeInteger(available.readyBackups)||available.readyBackups<1)
  stop('NO_READY_BACKUP');
 if(!Number.isFinite(age)||age<0||age>48*3600*1000)stop('READY_BACKUP_TOO_OLD');
 const before=await inventory(get,{maxDocuments:10000});
 const first=auditSummary(before);
 // Keep the original data untouched. Report count mismatches only as
 // aggregate diagnostics AFTER a second read establishes document stability.
 const digest=fingerprint(before);
 // The same typed fields, histories, CB/prices and identities must remain
 // unchanged throughout this read-only verification. Legitimate concurrent
 // sales may make this fail; NEVER roll back or overwrite those sales.
 const after=await inventory(get,{maxDocuments:10000});
 if(fingerprint(after)!==digest)stop('LIVE_DATA_CHANGED_DURING_AUDIT');
 const latest=await get('GET',RELEASE);
 if(latest.rulesetName!==live.rulesetName)stop('RULESET_CHANGED_DURING_AUDIT');
 ensure(sha(await readRules(latest.rulesetName))===CANDIDATE);
 return Object.freeze({
  project:PROJECT,readOnly:true,productionDocumentWrites:0,productionRuleWrites:0,
  currentRulesVerified:true,rulesSha256:CANDIDATE,
  readyBackups:available.readyBackups,backupWithin48Hours:true,
  fullTypedInventoryStable:true,documentsVerified:first.totalDocuments,
  originalRecordDocuments:first.groupCounts.records,
  originalCorrectionDocuments:first.groupCounts.recordCorrections,
  partnerWorkspaceLedgerDocuments:before.documents.filter(x=>/^companies\/[^/]+\/(?:partnerWorkEntries|partnerAdditionalCountEntries|partnerAdditionalCountAudits)\//.test(x.path)).length,
  savedDirectRecordCounts:first.registeredUnits.savedTotalCount,
  directRecordCountFieldVerified:first.registeredUnits.verifiedFields,
  directRecordCountMissing:first.registeredUnits.missingFields,
  independentlyMatchedDirectRecordTotals:first.registeredUnits.matchedResultTotals,
  unmatchedDirectRecordTotals:first.registeredUnits.mismatchedResultTotals,
  independentDirectCountConsistent:first.registeredUnits.mismatchedResultTotals===0,
  unverifiedLegacyRecordTotals:first.registeredUnits.resultsMissingOrUnverifiable,
  noCustomerDataOrFinanceValuesLogged:true,
  // Still NOT proof of smartphone login/auth access; must be tested with real
  // authenticated partner roles prior to any UI/backend release.
  livePartnerAccountE2EVerified:false,liveOwnerFinanceUIVerified:false
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PROD_AUDIT_MODE!=='READ_ONLY')stop('OPERATOR_GATE');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const {applicationDefault}=require('firebase-admin/app');
 const token=(await applicationDefault().getAccessToken()).access_token;
 if(!token)stop('MISSING_AUTH');
 const request=async(method,url,body)=>{
  if(!permitted(method,url,body))stop('NON_READ_ONLY_REQUEST');
  const result=await fetch(url,{method,redirect:'error',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!result.ok)stop('API_HTTP_'+result.status);
  return result.json();
 };
 const result=await audit({
  request,
  backup:()=>inspect({getToken:async()=>token,request:async(url,opts)=>{
   if(url!==BACKUPS||opts?.method!=='GET')stop('UNEXPECTED_BACKUP_REQUEST');
   return fetch(url,{...opts,redirect:'error'});
  }})
 });
 console.log('NICO_LIVE_PARTNER_BOUNDARY_READ_ONLY '+JSON.stringify(result));
 if(!result.independentDirectCountConsistent)stop('STORED_RECORD_COUNT_MISMATCH');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{
  console.error(/^STOP_[A-Z0-9_]+$/.test(error?.message||'')?error.message:
   'STOP_PRODUCTION_READ_ONLY_AUDIT_INCOMPLETE');
  process.exitCode=2;
 });
}
