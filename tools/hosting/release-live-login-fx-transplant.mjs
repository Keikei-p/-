#!/usr/bin/env node
/**
 * Production release for an exact reviewed login-FX-only overlay.
 * No Firestore/Auth/Functions/Rules calls. Retains every other live Hosting file.
 * Must be invoked only from a protected main workflow after human release review.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {applyLoginOnly} from './audit-live-login-fx-transplant.mjs';
import {uploadSingleExistingIndex,SITE,PROJECT} from './surgical-existing-index.mjs';

const BASE_SHA='1fb08a776c4e8c520425151bb4834a5a38d9abfc';
const REVIEWED_OLD_SHA='0a07f7b3df37055bd8ece616b776e02a6c8957dc5bfc02a50a7787c3bd951484';
const REVIEWED_NEXT_SHA='ca7ef44b66e576cc4734ddf96a38d0a8d8636c5fe8502c58bb239f08ed1c4b9d';
const BASE='https://firebasehosting.googleapis.com/v1beta1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const versionPattern=/^sites\/nico-factory\/versions\/[a-zA-Z0-9_-]+$/;

async function publicIndex(tag){
 const req=await fetch('https://'+SITE+'.web.app/?login_fx_only='+encodeURIComponent(tag),{
   headers:{Accept:'text/html'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(25000)
 });
 if(!req.ok||new URL(req.url).origin!=='https://'+SITE+'.web.app')
  throw Error('PUBLIC_INDEX_NOT_TRUSTED');
 return Buffer.from(await req.arrayBuffer());
}

async function run(){
 const [mode]=process.argv.slice(2);
 if(!['--dry-run','--release'].includes(mode)||process.argv.length!==3)
  throw Error('USAGE_dry_run_or_release');
 if(PROJECT!=='sales-management-cc116'||SITE!=='nico-factory')
  throw Error('FIREBASE_PROJECT_CHANGED');
 const old=execFileSync('git',['show',BASE_SHA+':index.html'],{encoding:'utf8',maxBuffer:3e6});
 const proposed=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 const liveBytes=await publicIndex('before_'+(process.env.GITHUB_SHA||'manual'));
 if(sha(liveBytes)!==REVIEWED_OLD_SHA)throw Error('LIVE_PREIMAGE_HASH_CHANGED_STOP');
 const patch=applyLoginOnly({base:old,proposed,live:liveBytes.toString('utf8')});
 if(!patch.changed||patch.liveSha256!==REVIEWED_OLD_SHA||patch.candidateSha256!==REVIEWED_NEXT_SHA)
  throw Error('REVIEWED_FX_PATCH_SHA_MISMATCH');
 if(mode==='--release'){
  if(process.env.GITHUB_REF!=='refs/heads/main'||
     process.env.NICO_LOGIN_FX_REVIEWED!=='PR786_APPROVED_INDEX_ONLY'||
     !process.env.GITHUB_SHA)
    throw Error('RELEASE_NEEDS_PROTECTED_MAIN_AND_REVIEWED_APPROVAL');
  const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(actual!==process.env.GITHUB_SHA)throw Error('WRONG_MAIN_REVISION');
 }
 if(!process.env.GOOGLE_APPLICATION_CREDENTIALS)
  throw Error('PROTECTED_HOSTING_IDENTITY_REQUIRED');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const {applicationDefault}=require('firebase-admin/app');
 const credential=applicationDefault();
 const request=async(method,url,body=null,type='application/json')=>{
  if(!url.startsWith(BASE+'/sites/'+SITE+'/')&&
     !url.startsWith('https://upload-firebasehosting.googleapis.com/upload/sites/'+SITE+'/versions/'))
   throw Error('NON_HOSTING_ENDPOINT_REFUSED');
  const {access_token}=await credential.getAccessToken();
  if(!access_token)throw Error('NO_HOSTING_TOKEN');
  const headers={Authorization:'Bearer '+access_token};
  if(body!==null)headers['Content-Type']=type;
  const response=await fetch(url,{method,headers,body:body===null?undefined:type==='application/octet-stream'?body:JSON.stringify(body)});
  if(!response.ok)throw Error('HOSTING_API_'+method+'_HTTP_'+response.status);
  const raw=await response.text();return raw?JSON.parse(raw):{};
 };
 // Independent preflight: live served bytes must match the live Hosting manifest.
 const releases=await request('GET',BASE+'/sites/'+SITE+'/releases?pageSize=1');
 const version=releases?.releases?.[0]?.version?.name;
 if(!versionPattern.test(version||''))throw Error('UNKNOWN_LIVE_VERSION');
 let token='',indexHash=null,seen=new Set(),count=0;
 do{
  if(seen.has(token))throw Error('MANIFEST_PAGINATION_LOOP');
  seen.add(token);
  const query=new URLSearchParams({pageSize:'1000'});if(token)query.set('pageToken',token);
  const page=await request('GET',BASE+'/'+version+'/files?'+query);
  if(!Array.isArray(page.files))throw Error('MANIFEST_UNAVAILABLE');
  for(const f of page.files){
   count++;
   if(f.path==='/index.html'){
    if(indexHash!==null)throw Error('DUPLICATE_INDEX_MANIFEST');
    indexHash=f.hash;
   }
  }
  token=page.nextPageToken||'';
  if(count>30000)throw Error('UNEXPECTED_MANIFEST_LENGTH');
 }while(token);
 const currentGzipHash=sha(gzipSync(liveBytes,{mtime:0}));
 if(indexHash!==currentGzipHash)throw Error('PUBLIC_BYTES_DIFFER_FROM_HOSTING_MANIFEST');
 const second=await publicIndex('preflight_'+(process.env.GITHUB_SHA||'manual'));
 if(sha(second)!==REVIEWED_OLD_SHA)throw Error('PUBLIC_INDEX_CHANGED_DURING_PREFLIGHT');
 const candidate=Buffer.from(patch.candidate,'utf8');
 const result=await uploadSingleExistingIndex({assetBytes:candidate,request,release:mode==='--release',
   log:message=>console.log('HOSTING_CHECK '+message)});
 if(result.sourceName!==version)throw Error('SOURCE_RELEASE_CHANGED_SAFETY_STOP');
 console.log(JSON.stringify({status:result.released?'RELEASED':'DRY_RUN_OK',
   reviewedLiveHash:REVIEWED_OLD_SHA,reviewedCandidateHash:REVIEWED_NEXT_SHA,
   sourceVersion:version,manifestCount:count,nonIndexPathsPreserved:count-1,
   operation:mode==='--release'?'INDEX_ONLY_HOSTING_RELEASE':'READ_ONLY_NO_DEPLOY'}));
 if(!result.released)return;
 let postOk=false;
 for(let i=0;i<12;i++){
  const served=await publicIndex('after_'+process.env.GITHUB_SHA+'_'+i);
  if(sha(served)===REVIEWED_NEXT_SHA){postOk=true;break;}
  await sleep(3000);
 }
 if(!postOk)throw Error('POST_RELEASE_PUBLIC_BYTE_PARITY_FAILED');
 for(const path of ['/partner-workspace.html','/partner-invite.html','/partner-counts.html']){
   const resp=await fetch('https://'+SITE+'.web.app'+path,{redirect:'follow',signal:AbortSignal.timeout(15000)});
   if(resp.status!==200)throw Error('POST_RELEASE_EXISTING_ROUTE_FAILED');
 }
 console.log('LOGIN_FX_PRODUCTION_LIVE_BYTE_PARITY_AND_EXISTING_ROUTES_PASS');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
 run().catch(e=>{console.error('SAFE_STOP '+e.message);process.exitCode=1;});
