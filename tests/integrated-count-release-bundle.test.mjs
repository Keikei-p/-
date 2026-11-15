import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {prepareIntegratedCountBundle,writeIntegratedCountBundle,assertPackageSafety,REQUIRED_GATES}
 from '../tools/production/prepare-integrated-count-release-bundle.mjs';
import {TARGETS,sha256,sourceBytes} from '../tools/production/verify-integrated-count-release-candidate.mjs';
const root=process.env.NICO_RELEASE_CANDIDATE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../docs/integrated-count-release-candidate-20261115.json',import.meta.url)));
const candidateHead='fdef4c7063f93dfd9e1dd42aea063a6bf5395b02';
const build=()=>prepareIntegratedCountBundle({root,manifest,candidateHead});
const clone=b=>({...b,files:new Map([...b.files].map(([p,v])=>[p,Buffer.from(v)])),integrity:new Map(b.integrity)});
const cleanTemporary=p=>{const base=resolve(tmpdir()),target=resolve(p),rel=relative(base,target);
 assert.ok(rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel));
 rmSync(target,{recursive:true,force:true});};
let prepared;
test('offline bundle verifies exact sources, preserves the original Hosting plan and only names six necessary existing targets',()=>{
 const fetcher=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('unexpected network');};
 try{prepared=build();}finally{globalThis.fetch=fetcher;}
 assert.equal(calls,0);
 assert.deepEqual(prepared.review.functionTargets,[...TARGETS]);
 assert.equal(prepared.review.packages.length,3);
 assert.deepEqual(prepared.review.hosting.replacements,['/index.html','/owner-partner-setup.html','/partner-workspace.html','/ranking/owner-partner-setup-mount.mjs']);
 assert.equal(prepared.review.hosting.additions.length,13);
 assert.equal(prepared.review.hosting.preserved.length,29);
 assert.equal(prepared.review.hosting.finalCount,46);
 assert.equal(prepared.review.hosting.uploads.length,17);
 assert.equal(prepared.review.sourceFlagsChanged,false);
 assert.equal(prepared.review.safeToApply,false);
 assert.equal(prepared.review.releaseApproved,false);
 assert.equal(prepared.review.applyImplemented,false);
 assert.equal(prepared.review.rollback.functionsRollbackPrepared,false);
 assert.deepEqual(prepared.review.requiredGates,[...REQUIRED_GATES]);
 assert.ok(prepared.files.size>70&&prepared.files.size<100);
 assert.ok([...prepared.files.keys()].every(p=>!p.split('/').some(x=>x.startsWith('.'))));
});
test('gzip upload bytes round-trip exactly, have normalized headers, retain their hash and are reproducible in the pinned runtime',()=>{
 const again=build();
 assert.deepEqual(again.review,prepared.review);
 assert.deepEqual([...again.files].map(([p,b])=>[p,sha256(b)]),[...prepared.files].map(([p,b])=>[p,sha256(b)]));
 const populate=JSON.parse(prepared.files.get('hosting/populate-files.json')).files;
 for(const u of prepared.review.hosting.uploads){
  const raw=sourceBytes(root,u.path.slice(1)),gzip=prepared.files.get(u.bytesFile);
  assert.deepEqual(gunzipSync(gzip),raw);
  assert.equal(sha256(raw),u.rawSha256);assert.equal(sha256(gzip),u.uploadSha256);
  assert.equal(populate[u.path],u.uploadSha256);
  assert.deepEqual([...gzip.subarray(4,8)],[0,0,0,0]);assert.equal(gzip[9],255);
 }
 for(const p of prepared.review.hosting.preserved){
  assert.equal(populate[p],manifest.hosting.baseline.files.find(f=>f.path===p).hash);
  assert.equal(prepared.files.has('hosting/raw'+p),false);
 }
 assert.equal(populate['/service-worker.js'],manifest.hosting.baseline.files.find(f=>f.path==='/service-worker.js').hash);
});
test('copies only manifested backend bytes and the existing generated Owner package without moving callable names',()=>{
 for(const p of manifest.backendFiles.filter(p=>p.startsWith('functions-partner-workspace/')))
  assert.deepEqual(prepared.files.get('functions/workspace/'+p),sourceBytes(root,p));
 for(const p of manifest.backendFiles.filter(p=>p.startsWith('functions-ranking-approvals/')))
  assert.deepEqual(prepared.files.get('functions/ranking/'+p),sourceBytes(root,p));
 assert.deepEqual(prepared.review.packageExports.find(x=>x.codebase==='hub-owner-correction-v3').names,
  ['listHubPartnerCounts','correctHubPartnerCounts']);
 const workspace=prepared.review.packageExports.find(x=>x.codebase==='partner-workspace').names;
 assert.ok(!workspace.includes('listHubPartnerCounts')&&!workspace.includes('correctHubPartnerCounts'));
 assert.deepEqual(JSON.parse(prepared.files.get('hosting/create-version.json')),{config:manifest.hosting.baseline.config});
 assert.deepEqual(JSON.parse(prepared.files.get('hosting/baseline.json')),manifest.hosting.baseline);
});
test('rejects changed source hashes, generic targets and unexpected npm dependencies or lifecycle scripts',()=>{
 const bad=structuredClone(manifest);bad.sourceFiles.find(x=>x.path==='index.html').sha256='0'.repeat(64);
 assert.throws(()=>prepareIntegratedCountBundle({root,manifest:bad,candidateHead}),/SOURCE_DRIFT/);
 const wider=structuredClone(manifest);wider.functionTargets=['functions'];
 assert.throws(()=>prepareIntegratedCountBundle({root,manifest:wider,candidateHead}),/FUNCTION_SCOPE/);
 const pkg=JSON.parse(sourceBytes(root,'functions-partner-workspace/package.json'));
 for(const change of [p=>{p.dependencies.unreviewed='latest';},p=>{p.scripts={postinstall:'unexpected'};},p=>{p.dependencies['firebase-admin']='^14.4.0';}]){
  const altered=structuredClone(pkg);change(altered);
  assert.throws(()=>assertPackageSafety(JSON.stringify(altered)),/PACKAGE_DEPENDENCIES/);
 }
 assert.throws(()=>prepareIntegratedCountBundle({root,manifest,candidateHead:'main'}),/CANDIDATE_HEAD/);
});
test('writes a disposable bundle once, refuses overwrite and verifies every output byte before creating directories',t=>{
 const parent=mkdtempSync(join(tmpdir(),'nico-count-bundle-'));t.after(()=>cleanTemporary(parent));
 const out=join(parent,'candidate');
 const written=writeIntegratedCountBundle(prepared,out);
 assert.equal(written.filesWritten,prepared.files.size);
 for(const [p,b]of prepared.files)assert.deepEqual(readFileSync(join(out,p)),b);
 assert.throws(()=>writeIntegratedCountBundle(prepared,out),/DESTINATION/);
 const bad=clone(prepared);bad.files.get('hosting/raw/index.html')[0]^=1;
 const second=join(parent,'altered');
 assert.throws(()=>writeIntegratedCountBundle(bad,second),/OUTPUT_INTEGRITY/);
 assert.equal(existsSync(second),false);
 const alteredReview={...prepared,review:{...prepared.review,functionTargets:['functions']}};
 assert.throws(()=>writeIntegratedCountBundle(alteredReview,second),/REVIEW_INTEGRITY/);
 assert.equal(existsSync(second),false);
});
test('rejects path traversal and hidden credential files before writing any bundle',t=>{
 const parent=mkdtempSync(join(tmpdir(),'nico-count-bundle-path-'));t.after(()=>cleanTemporary(parent));
 for(const p of ['../escape','functions/workspace/.env','C:/escape']){
  const bad=clone(prepared),bytes=Buffer.from('synthetic');bad.files.set(p,bytes);bad.integrity.set(p,sha256(bytes));
  const out=join(parent,'bad');assert.throws(()=>writeIntegratedCountBundle(bad,out),/OUTPUT_FILE_SCOPE/);
  assert.equal(existsSync(out),false);
 }
 assert.throws(()=>writeIntegratedCountBundle(prepared,'relative-output'),/DESTINATION/);
 const sourceOutput=join(resolve(root),'functions-partner-workspace','nico-bundle-output-must-be-refused');
 assert.throws(()=>writeIntegratedCountBundle(prepared,sourceOutput),/DESTINATION/);
 assert.equal(existsSync(sourceOutput),false);
});
test('CLI apply/release modes fail before accessing source, identity or any network',()=>{
 const tool=fileURLToPath(new URL('../tools/production/prepare-integrated-count-release-bundle.mjs',import.meta.url));
 for(const mode of ['--apply','--release']){
  const p=spawnSync(process.execPath,[tool,mode,'missing-source','missing-manifest','missing-output','main'],
   {encoding:'utf8',timeout:20000,env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:'not-a-credential'}});
  assert.equal(p.status,1);assert.equal(p.stdout,'');
  assert.match(p.stderr,/STOP_INTEGRATED_COUNT_BUNDLE_PREPARE_ONLY_NO_APPLY/);
 }
});
