#!/usr/bin/env node
/** READ ONLY. Probe exact four legacy Cloud Functions v1 metadata endpoints.
 * Even all ACTIVE is NOT evidence a real partner can submit counts.
 * No environment values, bearer tokens, service accounts, function URIs,
 * UIDs or financial fields are emitted. Never calls live Function handlers.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {EXPECTED,PROJECT} from './inspect-live-partner-callables-readonly.mjs';

const PREFIX='https://cloudfunctions.googleapis.com/v1/projects/'+PROJECT+
 '/locations/asia-northeast1/functions/';
const abort=code=>{throw Error('STOP_LEGACY_COUNT_FUNCTION_'+code);};
const safe=body=>body&&typeof body==='object'&&!Array.isArray(body)?body:{};
const validHttpsUrl=value=>{
 if(typeof value!=='string')return false;
 try{
  const u=new URL(value);
  return u.protocol==='https:'&&!u.username&&!u.password&&
   !u.search&&!u.hash&&u.port===''&&u.hostname.endsWith('.cloudfunctions.net');
 }catch{return false;}
};
export function classifyLegacy(name,body,status){
 if(!EXPECTED.includes(name))abort('UNKNOWN_FUNCTION');
 if(status===404)return Object.freeze({present:false,active:false,httpsCallable:false,enabled:false});
 if(status!==200)abort('BAD_RESPONSE');
 const data=safe(body),trigger=safe(data.httpsTrigger);
 const present=data.name==='projects/'+PROJECT+'/locations/asia-northeast1/functions/'+name;
 const active=present&&data.status==='ACTIVE';
 const httpsCallable=active&&data.entryPoint===name&&
   /^nodejs(?:16|18|20|22)$/.test(data.runtime||'')&&validHttpsUrl(trigger.url);
 const enabled=httpsCallable&&safe(data.environmentVariables).PARTNER_WORKSPACE_ENABLED==='enabled';
 return Object.freeze({present,active,httpsCallable,enabled});
}
export async function inspectLegacy(read){
 if(typeof read!=='function')abort('TRANSPORT');
 const list={};
 for(const name of EXPECTED){
  let response;
  try{response=await read(PREFIX+name);}
  catch{abort('TRANSPORT_FAILURE');}
  const code=response?.status;
  if(code===401||code===403)abort('MISSING_METADATA_PERMISSIONS');
  if(![200,404].includes(code))abort('UNKNOWN_HTTP_RESULT');
  let data={};
  if(code===200){
   try{data=await response.json();}
   catch{abort('MALFORMED_METADATA');}
  }
  list[name]=classifyLegacy(name,data,code);
 }
 return Object.freeze({
  project:PROJECT,
  mode:'GEN1_FUNCTIONS_METADATA_GET_ONLY',
  legacyFunctionsPresent:EXPECTED.every(n=>list[n].present),
  legacyFunctionsActive:EXPECTED.every(n=>list[n].active),
  legacyFunctionsConfiguredEnabled:EXPECTED.every(n=>list[n].enabled),
  functions:list,
  liveCallableInvocations:0,
  liveCountWrites:0,
  productionDocumentWrites:0,
  realPartnerFinanceDenyVerified:false,
  realCountInputVerified:false,
  safeToCutOverRules:false
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||
  process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||
  process.env.GITHUB_REF!=='refs/heads/main'||
  process.env.FIREBASE_PROJECT_ID!==PROJECT||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  abort('WRONG_AUDIT_CONTEXT');
 const config=JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'));
 if(config?.projects?.default!==PROJECT)abort('WRONG_PROJECT');
 let credential;
 try{
  const require=createRequire(new URL('../../functions/package.json',import.meta.url));
  credential=require('firebase-admin/app').applicationDefault();
 }catch{abort('OAUTH_UNAVAILABLE');}
 const read=async url=>{
  if(!EXPECTED.includes(url.slice(PREFIX.length))||
    url!==PREFIX+url.slice(PREFIX.length))abort('UNKNOWN_ENDPOINT');
  const token=(await credential.getAccessToken())?.access_token;
  if(!token)abort('NO_BEARER_TOKEN');
  return fetch(url,{method:'GET',cache:'no-store',redirect:'error',
   headers:{Authorization:'Bearer '+token}});
 };
 const result=await inspectLegacy(read);
 console.log('PARTNER_COUNT_GEN1_METADATA '+JSON.stringify(result));
 if(!result.legacyFunctionsPresent)console.log('BLOCK_GEN1_COUNT_CALLABLES_NOT_DEPLOYED');
 if(!result.legacyFunctionsActive)console.log('BLOCK_GEN1_COUNT_CALLABLES_NOT_ACTIVE');
 if(!result.legacyFunctionsConfiguredEnabled)console.log('BLOCK_GEN1_COUNT_CALLABLES_NOT_ENABLED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_LEGACY_COUNT_FUNCTION_[A-Z0-9_]+$/.test(e?.message||'')?
   e.message:'STOP_LEGACY_COUNT_FUNCTION_UNVERIFIED');
  process.exitCode=1;
 });
}
