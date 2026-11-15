import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {TARGETS,DORMANT_SETTINGS,sha256,verifyLocal,ensureExactTargets,sourceBytes,
 buildHostingPlan,boundedMetadataReader,verifyLiveMetadata,verifyPublic,refuseApply}
 from '../tools/production/verify-integrated-count-release-candidate.mjs';
const manifest=JSON.parse(readFileSync(new URL('../docs/integrated-count-release-candidate-20261115.json',import.meta.url)));
const root=process.env.NICO_RELEASE_CANDIDATE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const H='https://firebasehosting.googleapis.com/v1beta1/';
const FN='https://cloudfunctions.googleapis.com/v2/projects/sales-management-cc116/locations/asia-northeast1/functions?pageSize=1000';
const clone=x=>structuredClone(x);
const raw=s=>Buffer.from(s);

test('candidate locks actual source and preserves original 31 assets/config while adding only required browser dependencies',()=>{
 const result=verifyLocal(root,manifest);
 assert.equal(result.localSourceVerified,true);
 assert.equal(result.backendFiles,38);
 assert.equal(result.frontendDependencies,20);
 assert.equal(result.hosting.originalCount,33);
 assert.equal(result.hosting.finalCount,46);
 assert.equal(result.hosting.preserved.length,31);
 assert.deepEqual(result.hosting.replacements,['/index.html','/partner-workspace.html']);
 assert.equal(result.hosting.additions.length,13);
 assert.equal(result.hosting.files.find(x=>x.path==='/service-worker.js').action,'preserve');
 assert.ok(result.hosting.files.filter(x=>x.action!=='preserve').every(x=>x.uploadHashPrepared===false));
});
test('a changed backend/HTML hash cannot be accepted through a current source anchor',()=>{
 const bad=clone(manifest);bad.sourceFiles.find(x=>x.path==='functions-partner-workspace/service.cjs').sha256='0'.repeat(64);
 assert.throws(()=>verifyLocal(root,bad),/SOURCE_DRIFT/);
});
test('dropping a backend hash while preserving its filename cannot weaken the source manifest',()=>{
 const bad=clone(manifest);bad.sourceFiles=bad.sourceFiles.filter(x=>x.path!=='functions-partner-workspace/service.cjs');
 assert.throws(()=>verifyLocal(root,bad),/SOURCE_MANIFEST_INCOMPLETE/);
});
test('no generic/full Functions target, duplicated name or extra dormant setting is deployable in this lower-bound scope',()=>{
 ensureExactTargets([...TARGETS]);
 assert.throws(()=>ensureExactTargets(['functions']),/FUNCTION_SCOPE/);
 assert.throws(()=>ensureExactTargets([...TARGETS,TARGETS[0]]),/FUNCTION_SCOPE/);
 assert.throws(()=>ensureExactTargets([...TARGETS.slice(0,-1),'functions:ranking-owner-approvals:setRankingOwnerConsent']),/FUNCTION_SCOPE/);
});
test('source path traversal is refused before reading outside the candidate',()=>{
 assert.throws(()=>sourceBytes(root,'../outside.mjs'),/SOURCE_PATH/);
 assert.throws(()=>sourceBytes(root,'C:/secret.json'),/SOURCE_PATH/);
});
test('metadata allowlist rejects tokens, Firestore user data and write endpoints before acquiring identity',async()=>{
 let authCalls=0,remoteCalls=0;
 const read=boundedMetadataReader(async()=>{remoteCalls++;},async()=>{authCalls++;return 'synthetic';},manifest.hosting.baseline.name);
 for(const url of ['https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)/documents/users',
  H+'sites/nico-factory/versions',FN+'&pageToken=extra',FN+'#fragment'])
  await assert.rejects(read(url),/METADATA_ENDPOINT/);
 assert.equal(authCalls,0);assert.equal(remoteCalls,0);
});
test('metadata transport uses GET with no body and fails on unreadable/oversized responses',async()=>{
 const calls=[];
 const read=boundedMetadataReader(async(url,options)=>{calls.push({url,options});return {status:200,text:async()=>'{}'};},async()=>'synthetic',manifest.hosting.baseline.name);
 await read(FN);
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.body,undefined);
 assert.equal(calls[0].options.redirect,'error');
 await assert.rejects(boundedMetadataReader(async()=>({status:403}),async()=>'synthetic',manifest.hosting.baseline.name)(FN),/METADATA_HTTP/);
 await assert.rejects(boundedMetadataReader(async()=>({status:200,text:async()=>'x'.repeat(3000001)}),async()=>'synthetic',manifest.hosting.baseline.name)(FN),/METADATA_SIZE/);
});
function metadata(changes={}){
 const b=manifest.hosting.baseline;
 const functions=[...TARGETS.map(x=>x.split(':').at(-1)),...DORMANT_SETTINGS].map(name=>({
  name:'projects/sales-management-cc116/locations/asia-northeast1/functions/'+name,state:'ACTIVE',
  labels:{'firebase-functions-codebase':DORMANT_SETTINGS.includes(name)||name==='getVerifiedJointCountRanking'?
   'ranking-owner-approvals':['listHubPartnerCounts','correctHubPartnerCounts'].includes(name)?
    'hub-owner-correction-v3':'partner-workspace'}}));
 const result={
  [H+'sites/nico-factory/releases?pageSize=1']:{releases:[{version:{name:b.name}}]},
  [H+b.name]:{name:b.name,status:'FINALIZED',config:b.config},
  [H+b.name+'/files?pageSize=1000']:{files:b.files.map(x=>({path:x.path,hash:x.hash||'f'.repeat(64)}))},
  [FN]:{functions}
 };
 return Object.assign(result,changes);
}
test('exact current Hosting manifest/config and codebase inventory are proven only through bounded metadata reads',async()=>{
 const data=metadata(),calls=[];
 const result=await verifyLiveMetadata(async u=>{calls.push(u);assert.ok(Object.hasOwn(data,u));return data[u];},manifest);
 assert.equal(calls.length,4);assert.equal(result.hostingMetadataVerified,true);
 assert.equal(result.functions.length,11);assert.ok(result.functions.every(x=>x.present&&x.active&&x.codebaseVerified));
 assert.equal(result.metadataOnlyNeverUserProof,true);
});
test('a Hosting config change, incomplete file list or unrelated asset drift is never accepted',async()=>{
 const b=manifest.hosting.baseline;
 for(const mutate of [
  d=>{d[H+b.name].config={headers:[]};},
  d=>{d[H+b.name+'/files?pageSize=1000'].nextPageToken='truncated';},
  d=>{d[H+b.name+'/files?pageSize=1000'].files[0].hash='0'.repeat(64);},
  d=>{d[H+b.name+'/files?pageSize=1000'].files[1]=d[H+b.name+'/files?pageSize=1000'].files[0];}
 ]){const data=clone(metadata());mutate(data);await assert.rejects(verifyLiveMetadata(async u=>data[u],manifest),/LIVE_(?:CONFIG_DRIFT|FILES_INCOMPLETE|FILE_DRIFT)/);}
});
test('already-deployed Owner API in another codebase is reported as a collision, never mistaken for an approved new addition',async()=>{
 const data=metadata();data[FN].functions.find(x=>x.name.endsWith('/listHubPartnerCounts')).labels['firebase-functions-codebase']='partner-workspace';
 const result=await verifyLiveMetadata(async u=>data[u],manifest);
 assert.equal(result.functions.find(x=>x.name==='listHubPartnerCounts').codebaseVerified,false);
});
test('an unbounded regional inventory cannot provide deployment proof',async()=>{
 const data=metadata();data[FN].nextPageToken='unread';
 await assert.rejects(verifyLiveMetadata(async u=>data[u],manifest),/FUNCTIONS_INCOMPLETE/);
});
test('public verification issues only bounded anonymous GETs and detects changed source bytes',async()=>{
 const bytes=raw('synthetic public asset'),m={hosting:{baseline:{files:Array.from({length:33},(_,i)=>({path:'/asset-'+i+'.mjs',rawSha256:sha256(bytes)}))}}};
 const calls=[];const fetcher=async(u,o)=>{calls.push({u,o});return {status:200,arrayBuffer:async()=>bytes};};
 assert.equal((await verifyPublic(fetcher,m)).originalPublicAssetsVerified,33);
 assert.ok(calls.every(x=>x.o.method==='GET'&&!x.o.body&&!x.o.headers));
 m.hosting.baseline.files[12].rawSha256='0'.repeat(64);
 await assert.rejects(verifyPublic(fetcher,m),/PUBLIC_BASELINE_DRIFT/);
});
test('candidate cannot change the service worker through dependency inclusion',t=>{
 const tmp=mkdtempSync(join(tmpdir(),'nico-release-verifier-'));
 t.after(()=>rmSync(tmp,{recursive:true,force:true}));
 writeFileSync(join(tmp,'service-worker.js'),'altered worker');
 assert.throws(()=>buildHostingPlan(manifest.hosting.baseline,tmp,['service-worker.js']),/SERVICE_WORKER_CHANGE/);
});
test('apply/release refuse before root files, service identities, public GETs or approval claims are considered',()=>{
 assert.throws(()=>refuseApply(),/APPLY_UNIMPLEMENTED/);
 const tool=fileURLToPath(new URL('../tools/production/verify-integrated-count-release-candidate.mjs',import.meta.url));
 for(const mode of ['--apply','--release']){
  const p=spawnSync(process.execPath,[tool,mode,'does-not-exist','does-not-exist'],{encoding:'utf8',env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:'does-not-exist'}});
  assert.equal(p.status,1);assert.match(p.stderr,/STOP_INTEGRATED_COUNT_VERIFY_APPLY_UNIMPLEMENTED_INDEPENDENT_SIGNED_OPERATOR_REQUIRED/);
  assert.equal(p.stdout,'');
 }
});
