#!/usr/bin/env node
/**
 * READ-ONLY prerequisites for guarded count Functions deployment.
 * Scans exactly 6 existing dependency Functions in both generations;
 * never invokes the endpoints or accesses revenue/Firestore documents.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT='sales-management-cc116',REGION='asia-northeast1';
const prefix=v=>'https://cloudfunctions.googleapis.com/'+v+'/projects/'+PROJECT+
 '/locations/'+REGION+'/functions/';
export const ORIGINAL=Object.freeze([
 'sendMissingReportReminders',
 'createPartnerCompanyInvitation',
 'previewPartnerCompanyInvitation',
 'acceptPartnerCompanyInvitation',
 'getPartnerQuickCounts',
 'submitPartnerQuickCounts'
]);
const stop=x=>{throw Error('STOP_ORIGINAL_PARTNER_FUNCTIONS_'+x);};
export function classifyOriginal(name,v,body,status){
 if(!ORIGINAL.includes(name)||!['v1','v2'].includes(v))stop('UNKNOWN_TARGET');
 if(status===404)return Object.freeze({present:false,active:false});
 if(status!==200||!body||typeof body!=='object')stop('BAD_METADATA');
 const expected='projects/'+PROJECT+'/locations/'+REGION+'/functions/'+name;
 return Object.freeze({
  present:body.name===expected,
  active:body.name===expected&&(v==='v2'?body.state==='ACTIVE':body.status==='ACTIVE')
 });
}
export async function inspectOriginal(read){
 if(typeof read!=='function')stop('TRANSPORT');
 const data={};
 for(const name of ORIGINAL){
  const generations={};
  for(const version of ['v2','v1']){
   let response;
   try{response=await read(prefix(version)+name);}
   catch{stop('REMOTE_READ_UNVERIFIED');}
   const code=response?.status;
   if(code===401||code===403)stop('INSUFFICIENT_READ_PERMISSION');
   if(![200,404].includes(code))stop('UNKNOWN_HTTP_STATUS');
   let body=null;
   if(code===200){
    try{body=await response.json();}
    catch{stop('MALFORMED_METADATA');}
   }
   generations[version]=classifyOriginal(name,version,body,code);
  }
  data[name]=Object.freeze({
   present:generations.v2.present||generations.v1.present,
   active:generations.v2.active||generations.v1.active,
   gen2Present:generations.v2.present,
   gen1Present:generations.v1.present
  });
 }
 return Object.freeze({
  project:PROJECT,region:REGION,mode:'GEN1_GEN2_METADATA_GET_ONLY',
  allOriginalFunctionsPresent:ORIGINAL.every(name=>data[name].present),
  allOriginalFunctionsActive:ORIGINAL.every(name=>data[name].active),
  functions:data,
  originalFunctionInvocations:0,
  originalProductionWrites:0,
  livePartnerCountSubmissionVerified:false,
  safeToDeployNewFour:false,
  safeToCutOverFinanceRules:false
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||
  process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||
  process.env.GITHUB_REF!=='refs/heads/main'||
  process.env.FIREBASE_PROJECT_ID!==PROJECT||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  stop('WRONG_AUDIT_CONTEXT');
 const cfg=JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'));
 if(cfg?.projects?.default!==PROJECT)stop('WRONG_PROJECT');
 let credential;
 try{
  const require=createRequire(new URL('../../functions/package.json',import.meta.url));
  credential=require('firebase-admin/app').applicationDefault();
 }catch{stop('OAUTH_LIBRARY');}
 const read=async url=>{
  const allowed=ORIGINAL.some(name=>url===prefix('v1')+name||url===prefix('v2')+name);
  if(!allowed)stop('UNKNOWN_ENDPOINT');
  const token=(await credential.getAccessToken())?.access_token;
  if(!token)stop('MISSING_TOKEN');
  return fetch(url,{method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
 };
 const result=await inspectOriginal(read);
 console.log('ORIGINAL_PARTNER_FUNCTIONS '+JSON.stringify(result));
 if(!result.allOriginalFunctionsPresent)console.log('BLOCK_ORIGINAL_PARTNER_FUNCTIONS_MISSING');
 if(!result.allOriginalFunctionsActive)console.log('BLOCK_ORIGINAL_PARTNER_FUNCTIONS_NOT_ACTIVE');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_ORIGINAL_PARTNER_FUNCTIONS_[A-Z0-9_]+$/.test(e?.message||'')?
    e.message:'STOP_ORIGINAL_PARTNER_FUNCTIONS_UNVERIFIED');
  process.exitCode=1;
 });
}
