#!/usr/bin/env node
/** Offline, unapproved bytes for the six EXISTING Functions and bounded Hosting plan. */
import {readFileSync,existsSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,basename,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {PROJECT,SITE,TARGETS,verifyLocal,sourceBytes,sha256}
 from './verify-integrated-count-release-candidate.mjs';
import {prepareCanonicalOwnerPackage}
 from './prepare-canonical-hub-owner-correction-package.mjs';

const stop=code=>{throw Error('STOP_INTEGRATED_COUNT_BUNDLE_'+code);};
const safePath=p=>typeof p==='string'&&p.length<300&&/^[A-Za-z0-9_./-]+$/.test(p)&&
 !p.startsWith('/')&&p.split('/').every(x=>x!==''&&!x.startsWith('.'));
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const hashJson=x=>sha256(JSON.stringify(x));
export const REQUIRED_GATES=Object.freeze([
 'CURRENT_HEAD_INDEPENDENT_REVIEW_SIGNATURE_AND_MAINTAINER_LABEL',
 'ALL_REQUIRED_CI_GREEN',
 'CURRENT_PRODUCTION_VERSION_CONFIG_AND_FUNCTION_CODEBASE_IDENTITY_MATCH',
 'FRESH_BACKUP_RESTORE_AND_SOURCE_INVARIANTS',
 'EXISTING_FINANCE_TEST_EVIDENCE_ACCEPTED_FOR_THIS_SOURCE',
 'OWNER_APPROVED_PRODUCT_PUBLICATION_SKU_BINDINGS_AND_ACTIVE_COMPANY_RELATIONS',
 'VERIFIED_PUBLIC_NAMES_OR_ANONYMOUS_CROSS_COMPANY_LABELS',
 'REAL_ACCOUNT_COUNT_SAVE_READBACK_CORRECTION_AND_RANK_RECONCILIATION',
 'PER_FUNCTION_ENVIRONMENT_AND_COST_LIMIT_REVIEW',
 'ORIGINAL_FUNCTION_SOURCE_ARCHIVES_AND_ROLLBACK_PREPARED',
 'SIGNED_BOUNDED_APPLY_OPERATOR_AND_POST_RELEASE_VERIFICATION'
]);
export function assertPackageSafety(bytes){
 let p;try{p=JSON.parse(bytes);}catch{stop('PACKAGE_JSON');}
 if(p.private!==true||p.engines?.node!=='22'||p.main!=='index.js'||
    Object.keys(p.dependencies||{}).sort().join('|')!=='firebase-admin|firebase-functions'||
    p.dependencies['firebase-admin']!=='14.4.0'||p.dependencies['firebase-functions']!=='7.4.0'||
    Object.hasOwn(p,'scripts')||Object.hasOwn(p,'devDependencies')||
    Object.hasOwn(p,'optionalDependencies')||Object.hasOwn(p,'overrides'))stop('PACKAGE_DEPENDENCIES');
 return true;
}
export function uploadBytes(raw){
 const gz=gzipSync(raw,{level:9,mtime:0});
 // Normalize only the gzip header; the compressed stream remains untouched.
 // Exact stream reproducibility still requires the recorded Node/zlib runtime.
 gz.fill(0,4,8);gz[9]=255;
 return gz;
}
export function prepareIntegratedCountBundle({root,manifest,candidateHead}={}){
 if(!/^[a-f0-9]{40}$/.test(candidateHead||''))stop('CANDIDATE_HEAD');
 const source=verifyLocal(root,manifest),files=new Map();
 const expectedSources=new Map(manifest.sourceFiles.map(x=>[x.path,x.sha256]));
 const lockedSource=p=>{const b=sourceBytes(root,p);if(sha256(b)!==expectedSources.get(p))stop('SOURCE_CHANGED_DURING_PREPARATION');return b;};
 const put=(p,b)=>{if(!safePath(p)||files.has(p))stop('OUTPUT_FILE_SCOPE');files.set(p,Buffer.isBuffer(b)?b:Buffer.from(b));};
 const packages=[];
 for(const [folder,config,dir,codebase] of [
  ['workspace','firebase.partner-workspace.json','functions-partner-workspace','partner-workspace'],
  ['ranking','firebase.ranking-approvals.json','functions-ranking-approvals','ranking-owner-approvals']]){
  const selected=manifest.backendFiles.filter(p=>p.startsWith(dir+'/'));
  if(!selected.length)stop('PACKAGE_EMPTY');
  assertPackageSafety(lockedSource(dir+'/package.json'));
  for(const p of selected)put('functions/'+folder+'/'+p,lockedSource(p));
  put('functions/'+folder+'/'+config,lockedSource(config));
  packages.push({folder:'functions/'+folder,config,codebase,
   targets:TARGETS.filter(t=>t.split(':')[1]===codebase),sourceFileCount:selected.length});
 }
 const owner=prepareCanonicalOwnerPackage(root);
 for(const [p,b] of Object.entries(owner.bundle))put('functions/owner/'+p,b);
 assertPackageSafety(files.get('functions/owner/functions-hub-owner-correction/package.json'));
 packages.push({folder:'functions/owner',config:'firebase.owner-correction.json',
  codebase:'hub-owner-correction-v3',targets:TARGETS.filter(t=>t.split(':')[1]==='hub-owner-correction-v3'),sourceFileCount:5});
 const packageExports=packages.map(p=>{
  const cfg=JSON.parse(files.get(p.folder+'/'+p.config));
  if(Object.keys(cfg).join('|')!=='functions'||cfg.functions.codebase!==p.codebase)stop('PACKAGE_CONFIG');
  const entry=files.get(p.folder+'/'+cfg.functions.source+'/index.js')?.toString('utf8');
  if(!entry)stop('PACKAGE_ENTRY');
  return {codebase:p.codebase,names:[...entry.matchAll(/exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)].map(x=>x[1])};
 });
 const names=packageExports.flatMap(p=>p.names);
 if(new Set(names).size!==names.length)stop('DUPLICATED_FUNCTION_NAME');
 for(const t of TARGETS){const [,codebase,name]=t.split(':');if(!packageExports.some(p=>p.codebase===codebase&&p.names.includes(name)))stop('FUNCTION_TARGET');}
 const populate={},uploads=[];
 for(const item of source.hosting.files){
  if(item.action==='preserve'){
   if(!/^[0-9a-f]{64}$/.test(item.hostingHash||''))stop('PRESERVED_HOSTING_HASH');
   populate[item.path]=item.hostingHash;
  }else{
   const raw=lockedSource(item.path.slice(1)),gz=uploadBytes(raw),hash=sha256(gz);
   if(sha256(raw)!==item.rawSha256)stop('HOSTING_SOURCE');
   put('hosting/raw'+item.path,raw);put('hosting/uploads/'+hash,gz);
   populate[item.path]=hash;uploads.push({path:item.path,action:item.action,rawSha256:item.rawSha256,
    uploadSha256:hash,rawBytes:raw.length,gzipBytes:gz.length,bytesFile:'hosting/uploads/'+hash});
  }
 }
 if(Object.keys(populate).length!==46||uploads.length!==17||
    source.hosting.preserved.length!==29||source.hosting.replacements.length!==4||
    source.hosting.additions.length!==13)stop('HOSTING_SCOPE');
 const config=structuredClone(manifest.hosting.baseline.config);
 put('hosting/create-version.json',json({config}));
 put('hosting/populate-files.json',json({files:populate}));
 put('hosting/baseline.json',json(manifest.hosting.baseline));
 put('source-manifest.json',json(manifest));
 const review={format:'nico-integrated-count-offline-bundle-v1',project:PROJECT,site:SITE,
  candidateHead,sourceAnchorCommit:manifest.candidateCommit,sourceManifestSha256:hashJson(manifest),
  runtime:{node:process.versions.node,zlib:process.versions.zlib,platform:process.platform,arch:process.arch,
   gzipLevel:9,gzipMtime:0,gzipOsByte:255,reproducibleOnlyWithinPinnedRuntime:true},
  functionTargets:[...TARGETS],packages,packageExports,
  hosting:{baselineVersion:manifest.hosting.baseline.name,configSha256:source.hosting.configSha256,
   finalCount:46,preserved:source.hosting.preserved,replacements:source.hosting.replacements,
   additions:source.hosting.additions,uploads,populateFilesSha256:hashJson({files:populate})},
  rollback:{hostingVersion:manifest.hosting.baseline.name,hostingConfigSha256:source.hosting.configSha256,
   originalHostingFiles:33,originalHostingManifestIncluded:true,
   functionsSourceArchivesIncluded:false,functionsRollbackPrepared:false},
  npmDependenciesExactAtTopLevel:true,transitiveDependencyLockfilesIncluded:false,
  sourceFlagsChanged:false,environmentFilesIncluded:false,credentialsLoaded:false,
  networkRequests:0,productionWrites:0,productionDeploys:0,releaseApproved:false,
  safeToApply:false,applyImplemented:false,requiredGates:[...REQUIRED_GATES]};
 put('review.json',json(review));
 put('READ_ME_BEFORE_APPLY.txt',Buffer.from(
  'OFFLINE REVIEW BUNDLE ONLY. This tool never deploys or authorizes a release.\n'+
  'The supplied candidate HEAD is an explicit review reference; source hashes are independently verified.\n'+
  'Keep all six per-function targets; never use a generic Functions or Hosting deploy.\n'+
  'Environment flags, credentials, npm installs, original Function rollback archives and an apply operator are NOT included.\n'+
  'A signed operator must verify every required gate and the actual target runtime before using these bytes.\n'+
  'Hosting uploads are exact gzip bytes; preserve the recorded runtime and verify live baseline/config before creating a version.\n'+
  'The prior Hosting version is a rollback reference, not proof that rollback or Function recovery has been tested.\n'+
  REQUIRED_GATES.map(g=>'REQUIRED '+g).join('\n')+'\n'));
 put('file-inventory.json',json(Object.fromEntries([...files].map(([p,b])=>[p,sha256(b)]))));
 return {files,review,sourceRoot:realpathSync(root),
  integrity:new Map([...files].map(([p,b])=>[p,sha256(b)]))};
}
export function writeIntegratedCountBundle(prepared,destination){
 if(!prepared?.files||!(prepared.files instanceof Map)||!prepared.files.size||
    !(prepared.integrity instanceof Map)||prepared.integrity.size!==prepared.files.size||
    prepared.review?.safeToApply!==false||prepared.review?.releaseApproved!==false)stop('BUNDLE_SHAPE');
 if(!prepared.files.has('review.json')||
    hashJson(JSON.parse(prepared.files.get('review.json')))!==hashJson(prepared.review))stop('REVIEW_INTEGRITY');
 if(typeof destination!=='string'||resolve(destination)!==destination||existsSync(destination))stop('DESTINATION');
 const parent=realpathSync(dirname(destination));
 if(join(parent,basename(destination))!==destination||basename(destination).startsWith('.'))stop('DESTINATION');
 if(typeof prepared.sourceRoot!=='string')stop('BUNDLE_SHAPE');
 for(const folder of ['functions','functions-partner-workspace','functions-ranking-approvals','staging','ranking']){
  const prefix=resolve(prepared.sourceRoot,folder),rel=relative(prefix,destination);
  if(!rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))
   stop('DESTINATION_INSIDE_SOURCE_PACKAGE');
 }
 for(const [p,b]of prepared.files){if(!safePath(p)||!Buffer.isBuffer(b))stop('OUTPUT_FILE_SCOPE');
  if(sha256(b)!==prepared.integrity.get(p))stop('OUTPUT_INTEGRITY');
  const rel=relative(destination,resolve(destination,p));if(rel.startsWith('..'))stop('OUTPUT_FILE_SCOPE');}
 mkdirSync(destination);
 for(const [p,b]of prepared.files){const target=resolve(destination,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,b,{flag:'wx'});}
 return {...prepared.review,outputDirectory:destination,filesWritten:prepared.files.size};
}
async function main(){
 const [mode,root,manifestPath,destination,candidateHead,...extra]=process.argv.slice(2);
 // Reject before reading paths, credentials or environment-dependent source files.
 if(mode!=='--prepare')stop('PREPARE_ONLY_NO_APPLY');
 if(!root||!manifestPath||!destination||!candidateHead||extra.length)stop('ARGUMENTS');
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 const prepared=prepareIntegratedCountBundle({root,manifest,candidateHead});
 const report=writeIntegratedCountBundle(prepared,resolve(destination));
 console.log(JSON.stringify({project:report.project,candidateHead:report.candidateHead,
  filesWritten:report.filesWritten,functionTargets:report.functionTargets,hostingPaths:report.hosting.finalCount,
  hostingUploads:report.hosting.uploads.length,sourceFlagsChanged:false,productionWrites:0,
  productionDeploys:0,safeToApply:false,releaseApproved:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
 console.error(/^STOP_INTEGRATED_COUNT_(?:BUNDLE|VERIFY)_[A-Z_]+$/.test(e?.message||'')?
  e.message:'STOP_INTEGRATED_COUNT_BUNDLE_UNVERIFIED');process.exitCode=1;
});
