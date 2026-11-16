#!/usr/bin/env node
/** Review-only preparation for the existing #704 candidate. NO APPLY path.
 * --offline ROOT MANIFEST: exact local source/dependency/scope verification.
 * --verify ROOT MANIFEST: additionally bounded public and cloud metadata GETs.
 * The old release operators and their original SHA gates remain unchanged.
 */
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,relative,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT='sales-management-cc116',SITE='nico-factory';
export const TARGETS=Object.freeze([
 'functions:partner-workspace:getPartnerWorkspace',
 'functions:partner-workspace:submitPartnerWorkspaceCounts',
 'functions:hub-owner-correction-v3:listHubPartnerCounts',
 'functions:hub-owner-correction-v3:correctHubPartnerCounts',
 'functions:ranking-owner-approvals:getVerifiedJointCountRanking',
 'functions:ranking-owner-approvals:setOwnerProductVisibility'
]);
export const DORMANT_SETTINGS=Object.freeze(['getOwnerProductVisibility',
 'getOwnerReviewedSkuMapping','setOwnerReviewedSkuMapping',
 'getRankingOwnerConsentStatus','setRankingOwnerConsent']);
const HOSTING='https://firebasehosting.googleapis.com/v1beta1/';
const FUNCTIONS='https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+
 '/locations/asia-northeast1/functions?pageSize=1000';
const PUBLIC='https://'+SITE+'.web.app';
const ROOTS=['index.html','partner-workspace.html','owner-partner-setup.html'];
const HEX=/^[0-9a-f]{64}$/;
const stop=code=>{throw Error('STOP_INTEGRATED_COUNT_VERIFY_'+code)};
export const sha256=x=>createHash('sha256').update(x).digest('hex');
const hashJson=x=>sha256(JSON.stringify(x));
const safePath=p=>typeof p==='string'&&p.length<220&&
 /^[A-Za-z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&
 p.split('/').every(x=>x!==''&&x!=='.'&&x!=='..');
export function sourceBytes(root,p){
 if(!safePath(p))stop('SOURCE_PATH');
 const base=realpathSync(root),file=realpathSync(resolve(base,p));
 const rel=relative(base,file);
 if(rel.startsWith('..')||resolve(base,rel)!==file)stop('SOURCE_ESCAPE');
 const b=readFileSync(file);if(b.length>4000000)stop('SOURCE_SIZE');return b;
}
export function frontendClosure(root){
 const found=new Set(ROOTS),queue=[...ROOTS];
 while(queue.length){
  const p=queue.shift(),s=sourceBytes(root,p).toString('utf8');
  // Includes literal dynamic imports and styles set by the current HTML.
  // No evaluation of candidate code or remote modules is performed.
  for(const m of s.matchAll(/["']((?:\.\.?\/)[^"'\s?#]+\.(?:mjs|js|css))["']/g)){
   const dep=posix.normalize(posix.join(posix.dirname(p),m[1]));
   if(!safePath(dep))stop('DEPENDENCY_PATH');
   sourceBytes(root,dep);
   if(!found.has(dep)){found.add(dep);queue.push(dep);}
  }
  if(found.size>100)stop('DEPENDENCY_LIMIT');
 }
 return [...found].sort();
}
export function packageFiles(root,dir){
 const result=[];
 const walk=p=>{for(const entry of readdirSync(resolve(root,p),{withFileTypes:true})){
  if(entry.name==='node_modules'||entry.name==='.git')continue;
  if(entry.isSymbolicLink())stop('PACKAGE_SYMLINK');
  const next=p+'/'+entry.name;
  if(entry.isDirectory())walk(next);
  else if(/\.(?:js|cjs|mjs|json)$/.test(entry.name)&&!entry.name.startsWith('.'))result.push(next);
  if(result.length>400)stop('PACKAGE_LIMIT');
 }};walk(dir);return result.sort();
}
export function ensureExactTargets(targets){
 if(!Array.isArray(targets)||targets.length!==TARGETS.length||
   new Set(targets).size!==TARGETS.length||targets.some(x=>!TARGETS.includes(x)))
  stop('FUNCTION_SCOPE');
}
export function inspectManifest(manifest){
 if(!manifest||manifest.format!=='nico-integrated-count-review-only-v1'||
    manifest.project!==PROJECT||manifest.site!==SITE||
    !/^[0-9a-f]{40}$/.test(manifest.candidateCommit||'')||
    manifest.releaseApproved!==false||manifest.applyImplemented!==false||
    !Array.isArray(manifest.sourceFiles)||manifest.sourceFiles.length<30||
    manifest.sourceFiles.length>500)stop('MANIFEST');
 ensureExactTargets(manifest.functionTargets);
 const paths=new Set();
 for(const item of manifest.sourceFiles){
  if(!safePath(item.path)||!HEX.test(item.sha256||'')||paths.has(item.path))stop('SOURCE_MANIFEST');
  paths.add(item.path);
 }
 if(!manifest.hosting||manifest.hosting.baseline.name!=='sites/nico-factory/versions/a68817fa14752460'||
    manifest.hosting.baseline.files?.length!==33||
    !HEX.test(manifest.hosting.configSha256||''))stop('HOSTING_BASELINE');
 return true;
}
export function verifyLocal(root,manifest){
 inspectManifest(manifest);
 for(const item of manifest.sourceFiles)
  if(sha256(sourceBytes(root,item.path))!==item.sha256)stop('SOURCE_DRIFT');
 const assets=frontendClosure(root);
 if(JSON.stringify(assets)!==JSON.stringify(manifest.hosting.frontendDependencies))stop('DEPENDENCY_DRIFT');
 const backend=[...packageFiles(root,'functions-partner-workspace'),
  ...packageFiles(root,'functions-ranking-approvals'),
  'staging/partner-owner-correction-v3/entry.cjs','staging/partner-owner-correction-v3/service.cjs',
  'staging/partner-owner-correction-v3/trusted-auth.cjs','staging/partner-sb-v2/sb-category-v2.cjs'].sort();
 if(JSON.stringify(backend)!==JSON.stringify(manifest.backendFiles))stop('PACKAGE_DRIFT');
 const allSources=[...new Set([...assets,...backend,'firebase.partner-workspace.json',
  'firebase.ranking-approvals.json','staging/partner-owner-correction-v3/firebase.owner-correction.json',
  'tools/production/prepare-hub-owner-correction-v3-package.mjs',
  'tools/production/prepare-canonical-hub-owner-correction-package.mjs',
  'firestore.rules','functions/index.js'])].sort();
 if(JSON.stringify(manifest.sourceFiles.map(x=>x.path).sort())!==JSON.stringify(allSources))
  stop('SOURCE_MANIFEST_INCOMPLETE');
 if(manifest.hosting.configSha256!==hashJson(manifest.hosting.baseline.config))stop('BASELINE_CONFIG');
 for(const [cfg,source,codebase] of [
  ['firebase.partner-workspace.json','functions-partner-workspace','partner-workspace'],
  ['firebase.ranking-approvals.json','functions-ranking-approvals','ranking-owner-approvals'],
  ['staging/partner-owner-correction-v3/firebase.owner-correction.json','functions-hub-owner-correction','hub-owner-correction-v3']]){
  const json=JSON.parse(sourceBytes(root,cfg));
  if(Object.keys(json).join('|')!=='functions'||json.functions.source!==source||
     json.functions.codebase!==codebase)stop('CONFIG_SCOPE');
 }
 for(const target of TARGETS){
  const [,codebase,name]=target.split(':'),dir=codebase==='partner-workspace'?
   'functions-partner-workspace':codebase==='hub-owner-correction-v3'?
    'staging/partner-owner-correction-v3':'functions-ranking-approvals';
  const entry=codebase==='hub-owner-correction-v3'?'/entry.cjs':'/index.js';
  if(!sourceBytes(root,dir+entry).toString('utf8').includes('exports.'+name+'='))stop('EXPORT_MISSING');
 }
 const expected=buildHostingPlan(manifest.hosting.baseline,root,assets);
 if(hashJson(expected)!==manifest.hosting.planSha256)stop('HOSTING_PLAN_DRIFT');
 return {localSourceVerified:true,frontendDependencies:assets.length,
  backendFiles:backend.length,functionTargets:[...TARGETS],hosting:expected};
}
export function buildHostingPlan(baseline,root,assets){
 const original=new Map();
 for(const f of baseline.files||[]){
  if(typeof f.path!=='string'||!safePath(f.path.slice(1))||
     !(HEX.test(f.hash||'')||f.path==='/index.html'&&f.hash===null)||
     !HEX.test(f.rawSha256||'')||original.has(f.path))
   stop('BASELINE_FILE');
  original.set(f.path,f.hash);
 }
 if(original.size!==33||!original.has('/index.html')||!original.has('/service-worker.js'))stop('BASELINE_COUNT');
 const next=new Map([...original].map(([path,hash])=>[path,{path,hostingHash:hash,action:'preserve'}]));
 const replacements=[],additions=[];
 for(const p of assets){
  const publicPath='/'+p,rawSha256=sha256(sourceBytes(root,p));
  const old=baseline.files.find(f=>f.path===publicPath);
  if(old?.rawSha256===rawSha256)continue;
  if(original.has(publicPath))replacements.push(publicPath);
  if(!original.has(publicPath))additions.push(publicPath);
  next.set(publicPath,{path:publicPath,rawSha256,action:old?'replace':'add',uploadHashPrepared:false});
 }
 // The worker/cache/config is preserved. A candidate cannot quietly replace it.
 if(next.get('/service-worker.js')?.action!=='preserve')stop('SERVICE_WORKER_CHANGE');
 const preserved=[...next.values()].filter(x=>x.action==='preserve').map(x=>x.path).sort();
 return {originalCount:33,finalCount:next.size,preserved,replacements:replacements.sort(),
  additions:additions.sort(),files:[...next.values()].sort((a,b)=>a.path.localeCompare(b.path)),
  configSha256:hashJson(baseline.config),
  uploadHashesRequireIndependentPinnedRuntimePreparation:true};
}
export function allowedMetadataUrl(url,baseline){
 return url===FUNCTIONS||url===HOSTING+'sites/nico-factory/releases?pageSize=1'||
  url===HOSTING+baseline||url===HOSTING+baseline+'/files?pageSize=1000';
}
export function boundedMetadataReader(fetcher,tokenProvider,baseline){
 return async url=>{
  if(!allowedMetadataUrl(url,baseline))stop('METADATA_ENDPOINT');
  const token=await tokenProvider();if(typeof token!=='string'||!token)stop('READ_IDENTITY');
  const r=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(r.status!==200)stop('METADATA_HTTP');
  const s=await r.text();if(s.length>3000000)stop('METADATA_SIZE');return JSON.parse(s);
 };
}
export async function verifyLiveMetadata(read,manifest){
 const baseline=manifest.hosting.baseline;
 const release=await read(HOSTING+'sites/nico-factory/releases?pageSize=1');
 if(release.releases?.length!==1||release.releases[0]?.version?.name!==baseline.name)stop('LIVE_VERSION_DRIFT');
 const version=await read(HOSTING+baseline.name);
 if(version.name!==baseline.name||version.status!=='FINALIZED'||
    hashJson(version.config)!==manifest.hosting.configSha256)stop('LIVE_CONFIG_DRIFT');
 const files=await read(HOSTING+baseline.name+'/files?pageSize=1000');
 if(files.nextPageToken||!Array.isArray(files.files)||files.files.length!==33)stop('LIVE_FILES_INCOMPLETE');
 const expected=new Map(baseline.files.map(f=>[f.path,f.hash]));
 const seen=new Set();
 for(const f of files.files){
  if(seen.has(f.path)||!expected.has(f.path)||!HEX.test(f.hash||'')||
     expected.get(f.path)!==null&&expected.get(f.path)!==f.hash)stop('LIVE_FILE_DRIFT');seen.add(f.path);
 }
 const all=await read(FUNCTIONS);
 if(all.nextPageToken||!Array.isArray(all.functions)||all.functions.length>1000)stop('FUNCTIONS_INCOMPLETE');
 const identities=new Set();
 for(const fn of all.functions){
  if(typeof fn.name!=='string'||!fn.name.startsWith('projects/'+PROJECT+'/locations/asia-northeast1/functions/')||
     identities.has(fn.name))stop('FUNCTION_IDENTITY');identities.add(fn.name);
 }
 const names=[...TARGETS.map(x=>x.split(':').at(-1)),...DORMANT_SETTINGS];
 const states=names.map(name=>{
  const fn=all.functions.find(x=>x.name.endsWith('/'+name));
  return {name,present:!!fn,active:fn?.state==='ACTIVE',
   codebaseVerified:fn?.labels?.['firebase-functions-codebase']===(
    TARGETS.find(target=>target.split(':')[2]===name)?.split(':')[1]||
    (DORMANT_SETTINGS.includes(name)?'ranking-owner-approvals':null))};
 });
 return {hostingMetadataVerified:true,existingFunctionIdentities:identities.size,
  functions:states,metadataOnlyNeverUserProof:true};
}
async function publicBytes(fetcher,p){
 const r=await fetcher(PUBLIC+p,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(r.status!==200)stop('PUBLIC_ASSET_HTTP');
 const b=Buffer.from(await r.arrayBuffer());if(b.length>4000000)stop('PUBLIC_ASSET_SIZE');return b;
}
export async function verifyPublic(fetcher,manifest){
 // All 33 original assets, including the SDK init reserved paths, must remain exact.
 const files=manifest.hosting.baseline.files;
 for(let i=0;i<files.length;i+=4){await Promise.all(files.slice(i,i+4).map(async f=>{
  if(sha256(await publicBytes(fetcher,f.path))!==f.rawSha256)stop('PUBLIC_BASELINE_DRIFT');
 }));}
 return {originalPublicAssetsVerified:33};
}
export function refuseApply(){stop('APPLY_UNIMPLEMENTED_INDEPENDENT_SIGNED_OPERATOR_REQUIRED');}
async function main(){
 const [mode,root,manifestFile,...extra]=process.argv.slice(2);
 // Reject applies before opening source/evidence files or loading any credential.
 if(mode==='--apply'||mode==='--release')refuseApply();
 if(!['--offline','--verify'].includes(mode)||!root||!manifestFile||extra.length)stop('ARGUMENTS');
 const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
 const local=verifyLocal(root,manifest),live={};
 if(mode==='--verify'){
  Object.assign(live,await verifyPublic(fetch,manifest));
  if(process.env.GOOGLE_APPLICATION_CREDENTIALS){
   const require=createRequire(resolve(root,'functions/package.json'));
   const credential=require('firebase-admin/app').applicationDefault();
   const read=boundedMetadataReader(fetch,async()=>(await credential.getAccessToken()).access_token,
    manifest.hosting.baseline.name);
   Object.assign(live,await verifyLiveMetadata(read,manifest));
  }
 }
 console.log(JSON.stringify({project:PROJECT,mode:'READ_ONLY_NO_APPLY',candidateCommit:manifest.candidateCommit,
  sourceManifestSha256:hashJson(manifest),...local,...live,productionWrites:0,
  safeToApply:false,releaseApproved:false,blockingReasons:[
   ...(!live.hostingMetadataVerified?['FRESH_AUTHENTICATED_HOSTING_AND_FUNCTION_METADATA_REQUIRED']:[]),
   'CURRENT_CANDIDATE_INDEPENDENT_SIGNATURE_LABEL_AND_GREEN_CI_REQUIRED',
   'FRESH_READY_BACKUP_AND_FULL_SNAPSHOT_ISOLATED_RESTORE_INVARIANT_REQUIRED',
   'REAL_PARTNER_PRIMARY_SECONDARY_FINANCE_GET_LIST_DENY_REQUIRED',
   'REAL_OWNER_LOGIN_COUNT_SAVE_CORRECTION_AND_FINANCE_ALLOW_REQUIRED',
   'LIVE_COMPANY_TEAM_PERSON_SKU_COUNT_RECONCILIATION_REQUIRED',
   'EXACT_ENVIRONMENT_FLAGS_AND_COST_SCOPE_REVIEW_REQUIRED',
   'INDEPENDENT_SIGNED_APPLY_OPERATOR_NOT_IMPLEMENTED']}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
 console.error(/^STOP_INTEGRATED_COUNT_VERIFY_[A-Z_]+$/.test(e?.message||'')?
  e.message:'STOP_INTEGRATED_COUNT_VERIFY_UNVERIFIED');process.exitCode=1;
});
