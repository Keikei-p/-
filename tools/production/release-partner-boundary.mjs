// Approved, narrow partner boundary release. Never writes production documents.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collect,fingerprint,validateSafeCall,PROJECT} from '../readonly-backup/backup.mjs';
import {restoreToLocalEmulator} from '../readonly-backup/restore-emulator.mjs';
import {previewLiveRules} from './preview-live-finance-rules.mjs';
import {inspect} from './inspect-firestore-backups-readonly.mjs';

export const ORIGINAL='9d186b9ff763e010373e5c239ec80f53bac168b61ddb2877b38338c73ba43a91';
export const CANDIDATE='d1d9998d874a1a31c81ddf6996e08cd9de3a3d13bd684e245140bf03cab32179';
const root='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
const releaseName='projects/'+PROJECT+'/releases/cloud.firestore';
const setName=/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/;
const normalized=s=>s.replace(/\r\n/g,'\n').trim();
const sha=s=>createHash('sha256').update(normalized(s)).digest('hex');
const stop=code=>{throw Error('STOP_'+code);};

export function permitted(method,url,body){
 if(validateSafeCall(method,url,body))return true;
 if(method==='GET'&&body===undefined)return url===root+'/releases/cloud.firestore'||
  (url.startsWith('https://firebaserules.googleapis.com/v1/')&&setName.test(url.slice('https://firebaserules.googleapis.com/v1/'.length)));
 if(method==='POST'&&url===root+'/rulesets')return Object.keys(body||{}).join() ==='source'&&
  Object.keys(body.source||{}).join()==='files'&&body.source.files?.length===1&&
  body.source.files[0].name==='firestore.rules'&&sha(body.source.files[0].content||'')===CANDIDATE;
 if(method==='PATCH'&&url===root+'/releases/cloud.firestore')return Object.keys(body||{}).sort().join()==='release,updateMask'&&
  body.updateMask==='rulesetName'&&Object.keys(body.release||{}).sort().join()==='name,rulesetName'&&
  body.release.name===releaseName&&setName.test(body.release.rulesetName||'');
 return false;
}

export async function releaseBoundary({request,snapshot,restore,backup,reviewed,apply=false,log=()=>{}}){
 const readRelease=()=>request('GET',root+'/releases/cloud.firestore');
 const readSource=async name=>{
  if(!setName.test(name||''))stop('UNEXPECTED_RULESET');
  const set=await request('GET','https://firebaserules.googleapis.com/v1/'+name);
  if(set.source?.files?.length!==1||typeof set.source.files[0].content!=='string')stop('RULES_SOURCE');
  return set.source.files[0].content;
 };
 const original=await readRelease(),source=await readSource(original.rulesetName);
 if(sha(source)!==ORIGINAL&&sha(source)!==CANDIDATE)stop('LIVE_RULES_CHANGED');
 if(sha(reviewed)!==CANDIDATE)stop('UNREVIEWED_CANDIDATE');
 const preview=previewLiveRules(source,reviewed);
 if(!preview.matchesReviewed||sha(preview.candidate)!==CANDIDATE)stop('PREVIEW_PARITY');
 const managed=await backup();
 const backupAge=Date.now()-Date.parse(managed.latestReadySnapshot);
 if(!managed.readyBackups||!Number.isFinite(backupAge)||backupAge<0||backupAge>48*3600000)stop('RECENT_BACKUP_REQUIRED');
 const before=await snapshot(),digest=fingerprint(before);
 const restored=await restore(before);
 if(restored.fieldsAndIdsVerified!==true||restored.productionTouched!==false||
    restored.documentCount!==before.documents.length||restored.sourceInventoryFingerprint!==digest)stop('RESTORE_UNVERIFIED');
 if(fingerprint(await snapshot())!==digest)stop('DATA_CHANGED_BEFORE_RELEASE');
 if((await readRelease()).rulesetName!==original.rulesetName)stop('RULES_RACE');
 const summary={project:PROJECT,documentCount:before.documents.length,inventorySha256:digest,
  fieldsAndIdsRestored:true,metadataTimestampsRestored:false,managedBackupRestored:false,
  fullInventoryStableBefore:true,productionDocumentWrites:0,applied:false,
  originalRulesSha256:sha(source),candidateRulesSha256:CANDIDATE};
 log(summary);
 if(!apply)return summary;
 let created=null,attempted=false;
 const pointTo=rulesetName=>request('PATCH',root+'/releases/cloud.firestore',{
  release:{name:releaseName,rulesetName},updateMask:'rulesetName'});
 try{
  if(sha(source)!==CANDIDATE){
   created=await request('POST',root+'/rulesets',{source:{files:[{name:'firestore.rules',content:preview.candidate}]}});
   if(!setName.test(created.name||''))stop('CREATED_RULESET_INVALID');
   if((await readRelease()).rulesetName!==original.rulesetName)stop('RULES_RACE');
   attempted=true;
   await pointTo(created.name);
  }
  const current=await readRelease();
  if(current.rulesetName!==(created?.name||original.rulesetName)||sha(await readSource(current.rulesetName))!==CANDIDATE)stop('READBACK_FAILED');
  if(fingerprint(await snapshot())!==digest)stop('DATA_CHANGED_AFTER_RELEASE');
  return {...summary,applied:true,fullInventoryStableAfter:true,
   rollbackRuleset:original.rulesetName,currentRuleset:current.rulesetName};
 }catch(error){
  if(attempted){
   // Never undo a different operator's concurrent release or modify any data.
   const current=await readRelease();
   if(current.rulesetName===created.name){
    await pointTo(original.rulesetName);
    if((await readRelease()).rulesetName!==original.rulesetName)stop('ROLLBACK_UNVERIFIED');
    log({rulesRolledBack:true,productionDocumentWrites:0});
   }else if(current.rulesetName!==original.rulesetName)stop('CONCURRENT_RELEASE_MANUAL_REVIEW');
  }
  throw error;
 }
}

async function main(){
 const mode=process.argv[2];
 if(!['verify','apply'].includes(mode)||process.argv.length!==3||
    process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_USAGE_APPROVAL!=='EXISTING_FUNCTIONS_AND_FULL_INVENTORY_APPROVED')stop('OPERATOR_GATE');
 if(mode==='apply'&&process.env.NICO_RULES_APPROVAL!=='APPROVED_PARTNER_BOUNDARY_ONLY')stop('RELEASE_APPROVAL');
 if(JSON.parse(readFileSync('.firebaserc','utf8')).projects.default!==PROJECT)stop('PROJECT');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const credential=require('firebase-admin/app').applicationDefault();
 const request=async(method,url,body)=>{
  if(!permitted(method,url,body))stop('UNAPPROVED_API');
  const {access_token}=await credential.getAccessToken();
  const result=await fetch(url,{method,redirect:'error',headers:{Authorization:'Bearer '+access_token,
   'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!result.ok)stop('API_HTTP_'+result.status);
  return result.json();
 };
 const result=await releaseBoundary({request,
  snapshot:()=>collect(request,{maxDocuments:10000}),
  restore:source=>restoreToLocalEmulator(source,{emulatorHost:process.env.FIRESTORE_EMULATOR_HOST}),
  backup:()=>inspect(),reviewed:readFileSync('firestore.rules','utf8'),apply:mode==='apply',
  log:summary=>console.log('PARTNER_BOUNDARY_CHECK '+JSON.stringify(summary))});
 // Only counts, whole-inventory digest and Rules references leave process memory.
 writeFileSync(path.join(process.env.RUNNER_TEMP,'partner-boundary-summary.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log('PARTNER_BOUNDARY_RESULT '+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{console.error(/^STOP_[A-Z0-9_]+$/.test(e.message)?e.message:'STOP_REDACTED_FAILURE');process.exitCode=1;});
}
