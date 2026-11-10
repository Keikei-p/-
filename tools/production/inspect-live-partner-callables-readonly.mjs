#!/usr/bin/env node
/**
 * READ-ONLY production Cloud Functions v2 metadata check for count-only paths.
 * Not a production invoke and not evidence that an actual user can submit.
 * No Firestore, Auth, Rules, Hosting, IAM, or Cloud Functions writes.
 * Never print environment values, URIs, service accounts, tokens, names,
 * identities, traffic targets, or raw API errors.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const PROJECT='sales-management-cc116';
const REGION='asia-northeast1';
const ROOT='https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+
 '/locations/'+REGION+'/functions/';
// API HTTP endpoint and response Function.name are different namespaces.
// Google Cloud Functions v2 returns a RESOURCE NAME without scheme/host/v2.
const RESOURCE_ROOT='projects/'+PROJECT+'/locations/'+REGION+'/functions/';
export const LIST_URL=ROOT.slice(0,-1)+'?pageSize=1000';
export const EXPECTED=Object.freeze([
 'getPartnerWorkspace',
 'submitPartnerWorkspaceCounts',
 'managePartnerWorkspace',
 'acceptPartnerWorkspaceInvite'
]);
const abort=code=>{throw Error('STOP_PARTNER_CALLABLES_'+code);};
const expectName=name=>EXPECTED.includes(name)&&name.length<64;
const props=val=>val&&typeof val==='object'&&!Array.isArray(val)?val:{};

export function classify(name,body,status){
 if(!expectName(name))abort('UNKNOWN_TARGET');
 if(status===404)return Object.freeze({
  deployed:false,active:false,countEnabled:false,callableGen2:false
 });
 if(status!==200||!body||typeof body!=='object'||Array.isArray(body))
  abort('UNVERIFIED_FUNCTION_METADATA');
 const exact=RESOURCE_ROOT+name;
 const service=props(body.serviceConfig),build=props(body.buildConfig);
 const deployed=body.name===exact;
 const active=deployed&&body.state==='ACTIVE';
 // A published v2 callable has type HTTPS. Do not infer live invocation,
 // ingress reachability, validity of user token, or successful count write.
 let httpsUri=false;
 try{
  const u=new URL(service.uri);
  // Cloud Run v2 and HTTPS Function URIs can have no trailing slash.
  // Accept only Google's expected function hostnames (not arbitrary links).
  httpsUri=u.protocol==='https:'&&!u.username&&!u.password&&
   !u.search&&!u.hash&&u.port===''&&
   (u.hostname.endsWith('.a.run.app')||
    u.hostname.endsWith('.cloudfunctions.net'))&&
   (u.pathname==='/'||/^\/[A-Za-z0-9/_-]+$/.test(u.pathname));
 }catch{}
 const callableGen2=active&&build.entryPoint===name&&
  /^nodejs(?:18|20|22|24)$/.test(build.runtime||'')&&httpsUri;
 const env=props(service.environmentVariables);
 const countEnabled=callableGen2&&env.PARTNER_WORKSPACE_ENABLED==='enabled';
 return Object.freeze({deployed,active,callableGen2,countEnabled});
}

export function summarize(results,{metadataListFallbackUsed=false,directGetListConflict=false}={}){
 if(typeof metadataListFallbackUsed!=='boolean'||typeof directGetListConflict!=='boolean')
  abort('UNTRUSTED_RECONCILIATION');
 if(!Array.isArray(results)||results.length!==EXPECTED.length)abort('INVENTORY_INCOMPLETE');
 const seen=new Set(),features={};
 for(const result of results){
  if(!expectName(result?.name)||seen.has(result.name)||
     !['deployed','active','callableGen2','countEnabled'].every(k=>typeof result[k]==='boolean'))
   abort('INVENTORY_UNTRUSTED');
  seen.add(result.name);
  features[result.name]=Object.freeze({
   deployed:result.deployed,active:result.active,
   callableGen2:result.callableGen2,countEnabled:result.countEnabled
  });
 }
 if(EXPECTED.some(name=>!seen.has(name)))abort('INVENTORY_INCOMPLETE');
 const allPresent=EXPECTED.every(name=>features[name].deployed);
 const allActive=EXPECTED.every(name=>features[name].active);
 const allEnabled=EXPECTED.every(name=>features[name].countEnabled);
 // This is ONLY a metadata gate. GET cannot prove actual login or counts save.
 return Object.freeze({
  project:PROJECT,region:REGION,mode:'CLOUD_FUNCTIONS_METADATA_GET_ONLY',
  countFunctionMetadataPresent:allPresent,
  countFunctionsActive:allActive,
  countFunctionsConfiguredEnabled:allEnabled,
  functions:features,
  metadataListFallbackUsed,directGetListConflict,
  actualCallableInvoked:false,
  realPartnerCountEntryVerified:false,
  realPartnerFinanceDenyVerified:false,
  originalSalesDataWrites:0,
  safeToCutOverRules:false
 });
}

export async function inspect(read){
 if(typeof read!=='function')abort('TRANSPORT');
 const results=[];
 const get404=new Set();
 for(const name of EXPECTED){
  let response;
  try{response=await read(ROOT+name);}
  catch{abort('READ_TRANSPORT_UNVERIFIED');}
  const status=response?.status;
  if(status===401||status===403)abort('INSUFFICIENT_READ_PERMISSIONS');
  if(![200,404].includes(status))abort('REMOTE_RESPONSE_UNVERIFIED');
  let body=null;
  if(status===200){
   try{body=await response.json();}
   catch{abort('JSON_UNVERIFIED');}
  }
  if(status===404)get404.add(name);
  results.push({name,...classify(name,body,status)});
 }
 if(get404.size===0)return summarize(results);
 // Individual v2 GET can return 404 while Firebase CLI region inventory
 // lists the exact Gen2 function. Never call 404 definitive absence until
 // the canonical regional v2 LIST is independently checked, GET-only.
 let listedResponse;
 try{listedResponse=await read(LIST_URL);}
 catch{abort('LIST_TRANSPORT_UNVERIFIED');}
 if(listedResponse?.status!==200)abort('LIST_METADATA_UNVERIFIED');
 let page;
 try{page=await listedResponse.json();}
 catch{abort('LIST_JSON_UNVERIFIED');}
 if(!page||typeof page!=='object'||Array.isArray(page)||
    !Array.isArray(page.functions??[])||page.functions.length>1000||
    (page.nextPageToken!==undefined&&page.nextPageToken!==''))
  abort('LIST_INCOMPLETE');
 const regional=new Map();
 for(const row of page.functions??[]){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     typeof row.name!=='string'||row.name.length>500)
   abort('LIST_ROW_UNTRUSTED');
  if(!row.name.startsWith(RESOURCE_ROOT))continue;
  const name=row.name.slice(RESOURCE_ROOT.length);
  if(!EXPECTED.includes(name))continue;
  if(regional.has(name))abort('LIST_DUPLICATE_TARGET');
  regional.set(name,row);
 }
 let conflict=false;
 for(let i=0;i<results.length;i++){
  const name=results[i].name,listed=regional.get(name);
  if(!get404.has(name)&&!listed)abort('LIST_DISAGREES_WITH_GET');
  if(get404.has(name)&&listed){
   results[i]={name,...classify(name,listed,200)};
   conflict=true;
  }
 }
 return summarize(results,{metadataListFallbackUsed:true,directGetListConflict:conflict});
}

/**
 * An independent, GET-only preflight for the ONE additive joint ranking API.
 * Do not call the Function itself. Function metadata cannot establish whether
 * a signed-in partner was denied finance GET/LIST or saved actual counts.
 */
export const JOINT_RANKING_METADATA_URL=ROOT+'getVerifiedJointCountRanking';
function jointState(body,status){
 if(status===404)return Object.freeze({deployed:false,active:false,configuredEnabled:false});
 if(status!==200||!body||typeof body!=='object'||Array.isArray(body))
  abort('JOINT_RANKING_METADATA_UNVERIFIED');
 if(body.name!==RESOURCE_ROOT+'getVerifiedJointCountRanking')
  abort('JOINT_RANKING_IDENTITY_UNVERIFIED');
 const service=props(body.serviceConfig),build=props(body.buildConfig);
 let safeIngress=false;
 try{
  const url=new URL(service.uri);
  safeIngress=url.protocol==='https:'&&!url.username&&!url.password&&
   !url.port&&!url.search&&!url.hash&&
   (url.hostname.endsWith('.a.run.app')||
    url.hostname.endsWith('.cloudfunctions.net'));
 }catch{}
 const active=body.state==='ACTIVE'&&safeIngress&&
  /^nodejs(?:20|22|24)$/.test(build.runtime||'')&&
  build.entryPoint==='getVerifiedJointCountRanking';
 return Object.freeze({
  deployed:true,active,configuredEnabled:active&&
  props(service.environmentVariables).NICO_JOINT_COUNT_RANKING_ENABLED==='enabled'
 });
}
export async function inspectJointRankingMetadata(read){
 if(typeof read!=='function')abort('JOINT_RANKING_TRANSPORT_UNVERIFIED');
 let result;
 try{result=await read(JOINT_RANKING_METADATA_URL);}
 catch{abort('JOINT_RANKING_TRANSPORT_UNVERIFIED');}
 if(result?.status===401||result?.status===403)
  abort('JOINT_RANKING_READ_PERMISSION_MISSING');
 if(result?.status===200){
  let data;
  try{data=await result.json();}catch{abort('JOINT_RANKING_JSON_UNVERIFIED');}
  return Object.freeze({jointRankingFunctionPresent:true,
   ...(()=>{const v=jointState(data,200);return {
    jointRankingFunctionActive:v.active,
    jointRankingFunctionConfiguredEnabled:v.configuredEnabled
   };})(),
   jointMetadataFromRegionalList:false,
   realPartnerFinanceDenyVerified:false,
   realPartnerCountEntryVerified:false
  });
 }
 if(result?.status!==404)abort('JOINT_RANKING_GET_UNVERIFIED');
 // GET endpoints occasionally return 404 even for a listed gen2 Function.
 // Resolve using the canonical regional list, never guess deployment from 404.
 let response;
 try{response=await read(LIST_URL);}catch{abort('JOINT_RANKING_LIST_UNVERIFIED');}
 if(response?.status!==200)abort('JOINT_RANKING_LIST_UNVERIFIED');
 let listing;
 try{listing=await response.json();}catch{abort('JOINT_RANKING_LIST_JSON_UNVERIFIED');}
 if(!listing||typeof listing!=='object'||Array.isArray(listing)||
   !Array.isArray(listing.functions??[])||listing.functions.length>1000||
   (listing.nextPageToken!==undefined&&listing.nextPageToken!==''))
  abort('JOINT_RANKING_LIST_INCOMPLETE');
 const matches=listing.functions.filter(x=>x?.name===
   RESOURCE_ROOT+'getVerifiedJointCountRanking');
 if(matches.length>1)abort('JOINT_RANKING_DUPLICATE');
 const v=matches.length?jointState(matches[0],200):jointState(null,404);
 return Object.freeze({
  jointRankingFunctionPresent:v.deployed,
  jointRankingFunctionActive:v.active,
  jointRankingFunctionConfiguredEnabled:v.configuredEnabled,
  jointMetadataFromRegionalList:true,
  realPartnerFinanceDenyVerified:false,
  realPartnerCountEntryVerified:false
 });
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||
    process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||
    process.env.GITHUB_REF!=='refs/heads/main'||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
   abort('WRONG_AUDIT_ENV');
 let firebase;
 try{
  const require=createRequire(new URL('../../functions/package.json',import.meta.url));
  firebase=require('firebase-admin/app');
 }catch{abort('AUTH_DEPENDENCY');}
 if(JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'))?.projects?.default!==PROJECT)
   abort('WRONG_PROJECT');
 const tokenProvider=firebase.applicationDefault();
 const read=async url=>{
  if(url!==LIST_URL&&url!==JOINT_RANKING_METADATA_URL&&
     (!url.startsWith(ROOT)||!EXPECTED.includes(url.slice(ROOT.length))||
      url!==ROOT+url.slice(ROOT.length)))abort('UNKNOWN_ENDPOINT');
  const token=(await tokenProvider.getAccessToken())?.access_token;
  if(!token)abort('NO_READ_TOKEN');
  return fetch(url,{method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
 };
 const result=await inspect(read);
 const joint=await inspectJointRankingMetadata(read);
 console.log('PARTNER_COUNT_FUNCTION_METADATA '+JSON.stringify({...result,...joint}));
 const blockers=[];
 if(!result.countFunctionMetadataPresent)blockers.push('COUNT_FUNCTION_MISSING');
 if(!result.countFunctionsActive)blockers.push('COUNT_FUNCTION_NOT_ACTIVE');
 if(!result.countFunctionsConfiguredEnabled)blockers.push('COUNT_FUNCTION_NOT_ENABLED');
 for(const value of blockers)console.log('BLOCK_'+value);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  const safe=/^STOP_PARTNER_CALLABLES_[A-Z0-9_]+$/.test(e?.message||'')?
    e.message:'STOP_PARTNER_CALLABLES_UNVERIFIED';
  console.error(safe);process.exitCode=1;
 });
}
