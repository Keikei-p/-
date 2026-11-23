import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {prepareCanonicalOwnerPackage,writeCanonicalOwnerPackage,OWNER_SOURCE,CODEBASE}
 from '../tools/production/prepare-canonical-hub-owner-correction-package.mjs';
import {INTEGRATED_CANDIDATE,makeIntegratedCandidateOwnerPackage,makeOwnerPackage}
 from '../tools/production/prepare-hub-owner-correction-v3-package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));

test('current integrated source rejects any finance, auth, ledger or Hosting drift while historical release stays blocked',()=>{
 const files=Object.fromEntries(Object.keys(INTEGRATED_CANDIDATE).map(p=>[p,readFileSync(join(root,p),'utf8')]));
 assert.equal(makeIntegratedCandidateOwnerPackage(files).report.deployed,false);
 assert.throws(()=>makeOwnerPackage(files),/SOURCE_CHANGED/);
 for(const p of Object.keys(INTEGRATED_CANDIDATE))
  assert.throws(()=>makeIntegratedCandidateOwnerPackage({...files,[p]:files[p]+'\n'}),/SOURCE_CHANGED/,p);
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
