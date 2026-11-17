import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {prepareCanonicalOwnerPackage,writeCanonicalOwnerPackage,OWNER_SOURCE,CODEBASE}
 from '../tools/production/prepare-canonical-hub-owner-correction-package.mjs';
import {OWNER_ONLY_CANDIDATE,INTEGRATED_CANDIDATE,gitBlob,
 makeOwnerOnlyCandidateOwnerPackage,makeIntegratedCandidateOwnerPackage}
 from '../tools/production/prepare-hub-owner-correction-v3-package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('the new Owner-only correction candidate pins only the reviewed service change and cannot relax historical protections',()=>{
 const changed='functions-partner-workspace/service.cjs';
 const diffs=Object.keys(OWNER_ONLY_CANDIDATE).filter(path=>
  OWNER_ONLY_CANDIDATE[path]!==INTEGRATED_CANDIDATE[path]);
 assert.deepEqual(diffs,[changed]);
 const files=Object.fromEntries(Object.keys(OWNER_ONLY_CANDIDATE).map(path=>
  [path,readFileSync(join(root,path),'utf8')]));
 assert.equal(gitBlob(files[changed]),OWNER_ONLY_CANDIDATE[changed]);
 assert.equal(makeOwnerOnlyCandidateOwnerPackage(files).report.productionDataWrites,0);
 assert.throws(()=>makeIntegratedCandidateOwnerPackage(files),/SOURCE_CHANGED/,
  'the historical reviewed release source must stay immutable');
 assert.throws(()=>makeOwnerOnlyCandidateOwnerPackage({...files,
  [changed]:files[changed]+'\\n'}),/SOURCE_CHANGED/);
 assert.throws(()=>makeOwnerOnlyCandidateOwnerPackage({...files,
  'firestore.rules':files['firestore.rules']+'\\n'}),/SOURCE_CHANGED/);
});

test('reuse the reviewed existing Owner implementation, two callable names and codebase without a second server implementation',()=>{
 const p=prepareCanonicalOwnerPackage(root);
 assert.equal(p.report.codebase,'hub-owner-correction-v3');
 assert.deepEqual(p.report.exportedNames,['listHubPartnerCounts','correctHubPartnerCounts']);
 assert.equal(p.report.productionWrites,0);assert.equal(p.report.flagsChanged,false);
 assert.equal(p.bundle[OWNER_SOURCE+'/index.js'],readFileSync(join(root,'staging/partner-owner-correction-v3/entry.cjs'),'utf8'));
 assert.equal(p.bundle[OWNER_SOURCE+'/trusted-auth.cjs'],readFileSync(join(root,'staging/partner-owner-correction-v3/trusted-auth.cjs'),'utf8'));
 assert.equal(p.bundle[OWNER_SOURCE+'/service.cjs'],readFileSync(join(root,'staging/partner-owner-correction-v3/service.cjs'),'utf8')
  .replace('require("../partner-sb-v2/sb-category-v2.cjs")','require("./sb-category-v2.cjs")'));
 assert.doesNotMatch(readFileSync(join(root,'functions-partner-workspace/index.js'),'utf8'),/exports\.(listHubPartnerCounts|correctHubPartnerCounts)\s*=/);
 assert.equal(JSON.parse(p.bundle['firebase.owner-correction.json']).functions.codebase,CODEBASE);
});
test('prepare only a self-contained disposable runner package; never overwrite an existing directory',()=>{
 const folder=mkdtempSync(join(tmpdir(),'nico-existing-owner-'));
 const dest=join(folder,'nico-reviewed-owner-correction-v3-package');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,GITHUB_REPOSITORY:process.env.GITHUB_REPOSITORY,RUNNER_TEMP:process.env.RUNNER_TEMP};
 try{
  process.env.GITHUB_ACTIONS='true';process.env.GITHUB_REPOSITORY='Keikei-p/-';process.env.RUNNER_TEMP=folder;
  const p=prepareCanonicalOwnerPackage(root);writeCanonicalOwnerPackage(p,dest);
  const runtime=createRequire(import.meta.url)(join(dest,OWNER_SOURCE,'trusted-auth.cjs'));
  assert.equal(typeof runtime.makeAuthenticatedOwnerCorrectionV3,'function');
  assert(existsSync(join(dest,OWNER_SOURCE,'service.cjs')));
  assert.throws(()=>writeCanonicalOwnerPackage(p,dest),/DESTINATION|ALREADY_EXISTS/);
  assert.throws(()=>writeCanonicalOwnerPackage(p,'relative'),/DESTINATION/);
 }finally{
  for(const [key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;
  assert(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true});
 }
});
