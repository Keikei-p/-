#!/usr/bin/env node
/** GET-only runtime configuration audit. Never invokes a Function or reads
 * Firestore documents. Only allowlisted feature states leave the process;
 * arbitrary environment values, identities and raw errors are never logged.
 */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const PROJECT='sales-management-cc116',REGION='asia-northeast1';
const RESOURCE='projects/'+PROJECT+'/locations/'+REGION+'/functions/';
const API='https://cloudfunctions.googleapis.com/';
export const FLAGS=Object.freeze([
 'NICO_OWNER_PRODUCT_VISIBILITY_ENABLED','NICO_OWNER_SKU_MAPPING_ENABLED',
 'NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED','NICO_PARTNER_SHARED_RANKING_ENABLED',
 'NICO_JOINT_COUNT_RANKING_ENABLED'
]);
export const TARGET_FLAGS=Object.freeze({
 getOwnerProductVisibility:Object.freeze([FLAGS[0]]),
 setOwnerProductVisibility:Object.freeze([FLAGS[0]]),
 getOwnerReviewedSkuMapping:Object.freeze([FLAGS[1]]),
 setOwnerReviewedSkuMapping:Object.freeze([FLAGS[1]]),
 getPartnerWorkspace:Object.freeze([FLAGS[2],FLAGS[3]]),
 submitPartnerWorkspaceCounts:Object.freeze([FLAGS[2]]),
 getVerifiedJointCountRanking:Object.freeze([FLAGS[4]])
});
export const ENDPOINTS=Object.freeze(['v1','v2'].map(version=>
 API+version+'/'+RESOURCE.slice(0,-1)+'?pageSize=1000'));
const stop=code=>{throw Error('STOP_PUBLICATION_RUNTIME_FLAGS_'+code)};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

export function classifyFeatureFlag(env,key){
 if(!FLAGS.includes(key))stop('FLAG_NOT_ALLOWLISTED');
 if(!object(env))return Object.freeze({state:'unavailable',effectiveEnabled:null});
 if(!Object.hasOwn(env,key))return Object.freeze({state:'unset',effectiveEnabled:false});
 const value=env[key];
 return Object.freeze({state:value==='enabled'?'enabled':value==='disabled'?'disabled':'unrecognized',
  effectiveEnabled:value==='enabled'});
}

export function classifyFunctionMetadata(name,row,apiVersion){
 if(!Object.hasOwn(TARGET_FLAGS,name)||!['v1','v2'].includes(apiVersion)||
    !object(row)||row.name!==RESOURCE+name)stop('FUNCTION_IDENTITY');
 // v2 regional metadata can describe either generation. Read its explicit
 // generation first, then require the corresponding runtime field shape.
 const generation=row.environment==='GEN_1'?'gen1':row.environment==='GEN_2'?'gen2':
  row.environment!==undefined?'unknown':object(row.serviceConfig)?'gen2':
  typeof row.entryPoint==='string'?'gen1':'unknown';
 const gen2=generation==='gen2';
 const runtime=gen2?row.buildConfig?.runtime:row.runtime;
 const entryPoint=gen2?row.buildConfig?.entryPoint:row.entryPoint;
 const runtimeVerified=generation!=='unknown'&&entryPoint===name&&
  /^nodejs(?:16|18|20|22|24)$/.test(runtime||'');
 const env=gen2?row.serviceConfig?.environmentVariables:row.environmentVariables;
 const flags={};
 for(const key of TARGET_FLAGS[name])flags[key]=classifyFeatureFlag(env,key);
 const state=Object.hasOwn(row,'state')?row.state:row.status;
 return Object.freeze({apiVersion,generation,runtimeVerified,
  active:runtimeVerified&&state==='ACTIVE',flags});
}

export function summarizeRegionalMetadata(pages){
 if(!Array.isArray(pages)||pages.length!==2||
    pages[0]?.apiVersion!=='v1'||pages[1]?.apiVersion!=='v2')stop('INVENTORY_SCOPE');
 const observations=Object.fromEntries(Object.keys(TARGET_FLAGS).map(name=>[name,[]]));
 for(const {apiVersion,body} of pages){
  if(!object(body)||!Array.isArray(body.functions??[])||
     (body.functions??[]).length>1000||
     (body.nextPageToken!==undefined&&body.nextPageToken!==''))stop('INVENTORY_INCOMPLETE');
  const seen=new Set();
  for(const row of body.functions??[]){
   if(!object(row)||typeof row.name!=='string'||row.name.length>500)
    stop('INVENTORY_ROW');
   if(!row.name.startsWith(RESOURCE))continue;
   const name=row.name.slice(RESOURCE.length);
   if(!Object.hasOwn(TARGET_FLAGS,name))continue;
   if(seen.has(name))stop('DUPLICATE_FUNCTION');
   seen.add(name);
   observations[name].push(classifyFunctionMetadata(name,row,apiVersion));
  }
 }
 const functions={};
 for(const [name,rows] of Object.entries(observations)){
  const equivalent=row=>JSON.stringify({generation:row.generation,
   runtimeVerified:row.runtimeVerified,active:row.active,flags:row.flags});
  const conflict=rows.length>1&&equivalent(rows[0])!==equivalent(rows[1]);
  functions[name]=Object.freeze({metadataPresent:rows.length>0,
   conflictingApiMetadata:conflict,observations:rows});
 }
 return Object.freeze({project:PROJECT,region:REGION,
  mode:'RUNTIME_FEATURE_FLAGS_METADATA_GET_ONLY',metadataApiVersions:['v1','v2'],functions,
  allTargetMetadataPresent:Object.values(functions).every(x=>x.metadataPresent),
  conflictingApiMetadata:Object.values(functions).some(x=>x.conflictingApiMetadata),
  productionDocumentReads:0,productionDocumentWrites:0,liveCallableInvocations:0,
  productionDeployments:0,realAccountSaveVerified:false,realPartnerFinanceDenialVerified:false});
}

export async function inspectRuntimeFlags(read){
 if(typeof read!=='function')stop('TRANSPORT');
 const pages=[];
 for(let i=0;i<ENDPOINTS.length;i++){
  let response;
  try{response=await read(ENDPOINTS[i]);}catch{stop('METADATA_GET_FAILED');}
  if(response?.status===401||response?.status===403)stop('METADATA_PERMISSION_DENIED');
  if(response?.status!==200)stop('METADATA_GET_UNVERIFIED');
  let body;
  try{body=await response.json();}catch{stop('METADATA_JSON');}
  pages.push({apiVersion:i===0?'v1':'v2',body});
 }
 return summarizeRegionalMetadata(pages);
}

async function main(){
 if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||
    process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||process.env.GITHUB_REF!=='refs/heads/main'||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PUBLICATION_RUNTIME_AUDIT_MODE!=='GET_ONLY'||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'))
     .projects.default!==PROJECT)stop('UNAPPROVED_RUNTIME');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const credential=require('firebase-admin/app').applicationDefault();
 const read=async url=>{
  if(!ENDPOINTS.includes(url))stop('ENDPOINT_NOT_ALLOWLISTED');
  const token=(await credential.getAccessToken())?.access_token;
  if(typeof token!=='string'||!token)stop('MISSING_READ_IDENTITY');
  return fetch(url,{method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
 };
 const summary=await inspectRuntimeFlags(read);
 console.log('NICO_PUBLICATION_RUNTIME_FLAGS '+JSON.stringify(summary));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{
  console.error(/^STOP_PUBLICATION_RUNTIME_FLAGS_[A-Z_]+$/.test(error?.message||'')?
   error.message:'STOP_PUBLICATION_RUNTIME_FLAGS_UNVERIFIED');
  process.exitCode=1;
 });
