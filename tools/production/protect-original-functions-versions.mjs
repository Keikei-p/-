#!/usr/bin/env node
/**
 * Read-only immutable snapshot of six deployed original Functions. Explicitly
 * NOT an endpoint invocation, a data backup, a deploy, or a Rules proof.
 * Protects old LINE, invitation and quick-count services before/after the
 * separate four-function release. Only boolean results are printed.
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ORIGINAL} from './inspect-original-partner-functions-readonly.mjs';
const PROJECT='sales-management-cc116';
// Original production Functions may still be Gen1. Protect both versions,
 // including a transitional dual-generation deployment, without invoking them.
const ROOTS=Object.freeze(Object.fromEntries(['v2','v1'].map(version=>[
 version,'https://cloudfunctions.googleapis.com/'+version+'/projects/'+PROJECT+
 '/locations/asia-northeast1/functions/'
])));
const stop=reason=>{throw Error('STOP_ORIGINAL_FUNCTION_VERSION_'+reason)};
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const validTime=t=>typeof t==='string'&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(t);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const stable=value=>{
 if(Array.isArray(value))return value.map(stable);
 if(isObj(value))return Object.fromEntries(Object.keys(value).sort()
  .map(k=>[k,stable(value[k])]));
 return value;
};
export function immutableOriginal(name,body,generation='v2'){
 if(!ORIGINAL.includes(name))stop('TARGET_UNKNOWN');
 if(!Object.hasOwn(ROOTS,generation))stop('GENERATION_UNKNOWN');
 if(!isObj(body)||body.name!=='projects/'+PROJECT+
  '/locations/asia-northeast1/functions/'+name||
  !validTime(body.updateTime))
  stop('LIVE_ORIGINAL_NOT_ACTIVE_OR_METADATA_MISSING');
 if(generation==='v1'){
  // Cloud Functions v1 has status/runtime/versionId/httpsTrigger instead of
  // v2's state/buildConfig/serviceConfig. A v1 404 is not a failure when a
  // separate verified active v2 exists, but an ACTIVE v1 must be fingerprinted.
  const http=isObj(body.httpsTrigger)&&
   typeof body.httpsTrigger.url==='string'&&
   body.httpsTrigger.url.startsWith('https://');
  const event=isObj(body.eventTrigger)&&
   typeof body.eventTrigger.eventType==='string'&&
   body.eventTrigger.eventType.length>0;
  if(body.status!=='ACTIVE'||!/^nodejs(?:18|20|22|24)$/.test(body.runtime||'')||
     !/^[1-9][0-9]*$/.test(body.versionId||'')||
     (body.entryPoint!==undefined&&
      (typeof body.entryPoint!=='string'||!body.entryPoint))||
     http===event)
    stop('LIVE_ORIGINAL_V1_METADATA_MISSING_OR_INACTIVE');
  // Hash the entire stable Gen1 metadata, including its deployment version,
  // runtime, trigger, IAM identity, source, labels and environment settings.
  // The raw metadata is never printed or retained as a public artifact.
  return hash(stable({generation,metadata:body}));
 }
 if(body.state!=='ACTIVE'||!isObj(body.buildConfig)||
    !isObj(body.serviceConfig))
  stop('LIVE_ORIGINAL_NOT_ACTIVE_OR_METADATA_MISSING');
 const build=body.buildConfig,service=body.serviceConfig;
 if(!/^nodejs(?:18|20|22|24)$/.test(build.runtime||'')||
  typeof build.entryPoint!=='string'||build.entryPoint.length===0||
  typeof service.uri!=='string'||!service.uri.startsWith('https://'))
  stop('LIVE_ORIGINAL_BUILD_UNKNOWN');
 // The selected fields cover original deployments' code, runtime, routing,
 // secrets, service identity, memory/CPU/concurrency, state and updatedAt.
 // Never store or print raw values, URIs, environment variables or secrets.
 const protectedFields=stable({
  state:body.state,updateTime:body.updateTime,
  buildConfig:build,serviceConfig:service,
  eventTrigger:body.eventTrigger||null,labels:body.labels||null,
  kmsKeyName:body.kmsKeyName||null
 });
 return hash(protectedFields);
}
export async function captureOriginal(read){
 if(typeof read!=='function')stop('NO_TRANSPORT');
 const snap={};
 for(const name of ORIGINAL){
  const generations={};
  // Check BOTH generations even after finding an ACTIVE function. This catches
  // transitions and ensures a newly added or removed generation changes hash.
  for(const generation of ['v2','v1']){
   let response;
   try{response=await read(ROOTS[generation]+name);}
   catch{stop('REMOTE_UNAVAILABLE');}
   if(response?.status===404)continue;
   if(response?.status!==200)stop('ORIGINAL_GET_NOT_SUCCESSFUL');
   let data;
   try{data=await response.json();}
   catch{stop('ORIGINAL_METADATA_INVALID');}
   generations[generation]=immutableOriginal(name,data,generation);
  }
  if(Object.keys(generations).length===0)stop('ORIGINAL_BOTH_GENERATIONS_MISSING');
  snap[name]=hash(stable(generations));
 }
 return Object.freeze(snap);
}
export function compareOriginalVersions(before,after){
 if(!isObj(before)||!isObj(after)||
    Object.keys(before).length!==ORIGINAL.length||
    Object.keys(after).length!==ORIGINAL.length)
  stop('INVENTORY_INCOMPLETE');
 for(const name of ORIGINAL){
  if(!/^[0-9a-f]{64}$/.test(before[name]||'')||
     !/^[0-9a-f]{64}$/.test(after[name]||''))
   stop('INVALID_FINGERPRINT');
  if(before[name]!==after[name])
   stop('EXISTING_FUNCTION_VERSION_CHANGED');
 }
 return Object.freeze({
  allOriginalSixVersionsUnchanged:true,
  originalFunctionsReplaced:0,
  originalFunctionsRemoved:0,
  productionDocumentWrites:0,
  livePartnerCountSubmissionVerified:false,
  safeToCutOverFinanceRules:false
 });
}
async function main(){
 const stage=process.argv[2];
 if(!['before','after'].includes(stage)||
  process.env.GITHUB_ACTIONS!=='true'||
  process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||
  process.env.GITHUB_REF!=='refs/heads/main'||
  process.env.FIREBASE_PROJECT_ID!==PROJECT||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS||
  !process.env.RUNNER_TEMP)
  stop('APPROVED_RUNTIME_ONLY');
 const cfg=JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'));
 if(cfg.projects?.default!==PROJECT)stop('PROJECT_MISMATCH');
 const out=path.join(process.env.RUNNER_TEMP,'nico-original-six-immutable-versions.private.json');
 let credentials;
 try{
  const require=createRequire(new URL('../../functions/package.json',import.meta.url));
  credentials=require('firebase-admin/app').applicationDefault();
 }catch{stop('OAUTH_LIBRARY_UNAVAILABLE');}
 const read=async url=>{
  if(!ORIGINAL.some(name=>Object.values(ROOTS).some(root=>url===root+name)))
   stop('ENDPOINT_UNREVIEWED');
  const token=(await credentials.getAccessToken())?.access_token;
  if(!token)stop('OAUTH_TOKEN_UNAVAILABLE');
  return fetch(url,{method:'GET',cache:'no-store',redirect:'error',
   headers:{Authorization:'Bearer '+token}});
 };
 const result=await captureOriginal(read);
 if(stage==='before'){
  // This remains on the disposable private GitHub runner and isn't uploaded.
  writeFileSync(out,JSON.stringify(result),{mode:0o600,flag:'wx'});
  chmodSync(out,0o600);
  console.log('ORIGINAL_SIX_VERSION_BASELINE_CAPTURED_READONLY');
 }else{
  let previous;
  try{previous=JSON.parse(readFileSync(out,'utf8'));}
  catch{stop('MISSING_BASELINE');}
  const report=compareOriginalVersions(previous,result);
  console.log('ORIGINAL_SIX_VERSION_STABILITY '+JSON.stringify(report));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_ORIGINAL_FUNCTION_VERSION_[A-Z0-9_]+$/.test(e?.message||'')?
   e.message:'STOP_ORIGINAL_FUNCTION_VERSION_UNVERIFIED');
  process.exitCode=1;
 });
}
