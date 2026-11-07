#!/usr/bin/env node
/**
 * Isolated metadata-only health check for the existing owner quick-count
 * approval callable. The original 6-function audit remains untouched.
 * No Function invocation, Firestore access, data writes, deploy or IAM changes.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT='sales-management-cc116';
export const REGION='asia-northeast1';
export const FUNCTION='approvePartnerQuickCounts';
const base='https://cloudfunctions.googleapis.com/';
const resource='projects/'+PROJECT+'/locations/'+REGION+'/functions/'+FUNCTION;
export const ENDPOINTS=Object.freeze([
 base+'v2/'+resource,
 base+'v1/'+resource
]);
const stop=code=>{throw Error('STOP_QUICK_APPROVAL_AUDIT_'+code);};

export function classifyQuickApproval(generation,status,body){
 if(!['v1','v2'].includes(generation))stop('GENERATION');
 if(status===404)return Object.freeze({present:false,active:false});
 if(status!==200||!body||typeof body!=='object'||Array.isArray(body))
  stop('MALFORMED_METADATA');
 const match=body.name===resource;
 return Object.freeze({
  present:match,
  active:match&&(generation==='v2'?body.state==='ACTIVE':body.status==='ACTIVE')
 });
}

export async function inspectQuickApproval(read){
 if(typeof read!=='function')stop('TRANSPORT');
 const states=[];
 for(const [index,url] of ENDPOINTS.entries()){
  let response;
  try{response=await read(url);}catch{stop('REMOTE_READ_UNVERIFIED');}
  const code=response?.status;
  if(code===401||code===403)stop('READ_PERMISSION');
  if(code!==200&&code!==404)stop('HTTP_UNKNOWN');
  let body=null;
  if(code===200){
   try{body=await response.json();}catch{stop('JSON_UNKNOWN');}
  }
  states.push(classifyQuickApproval(index===0?'v2':'v1',code,body));
 }
 const [gen2,gen1]=states;
 return Object.freeze({
  project:PROJECT,region:REGION,function:FUNCTION,
  mode:'CLOUD_FUNCTIONS_METADATA_GET_ONLY',
  deployed:gen2.present||gen1.present,
  active:gen2.active||gen1.active,
  gen2Present:gen2.present,
  gen1Present:gen1.present,
  ambiguousGenerations:gen2.present&&gen1.present,
  metadataOnly:true,
  actualApprovalInvocationVerified:false,
  actualOwnerCountApprovalVerified:false,
  financeRulesVerified:false,
  productionWrites:0,
  safeToSwitchFinanceRules:false,
  safeToPublishNewWorkspaceUI:false
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||
  process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||
  process.env.GITHUB_REF!=='refs/heads/main'||
  process.env.FIREBASE_PROJECT_ID!==PROJECT||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  stop('WRONG_CONTEXT');
 const config=JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'));
 if(config?.projects?.default!==PROJECT)stop('WRONG_PROJECT');
 let credential;
 try{
  const require=createRequire(new URL('../../functions/package.json',import.meta.url));
  credential=require('firebase-admin/app').applicationDefault();
 }catch{stop('OAUTH_LIBRARY');}
 const read=async url=>{
  if(!ENDPOINTS.includes(url))stop('ENDPOINT');
  const token=(await credential.getAccessToken())?.access_token;
  if(!token)stop('MISSING_TOKEN');
  return fetch(url,{method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
 };
 const result=await inspectQuickApproval(read);
 console.log('PARTNER_QUICK_APPROVAL_METADATA '+JSON.stringify(result));
 if(!result.deployed)console.log('BLOCK_QUICK_APPROVAL_MISSING');
 if(!result.active)console.log('BLOCK_QUICK_APPROVAL_NOT_ACTIVE');
 if(result.ambiguousGenerations)console.log('BLOCK_QUICK_APPROVAL_AMBIGUOUS');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_QUICK_APPROVAL_AUDIT_[A-Z0-9_]+$/.test(e?.message||'')?
   e.message:'STOP_QUICK_APPROVAL_AUDIT_UNVERIFIED');
  process.exitCode=1;
 });
}
