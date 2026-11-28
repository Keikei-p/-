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
 assert.equal(p.report.canonicalLedgerReused,true);
 assert.equal(p.bundle[OWNER_SOURCE+'/index.js'],readFileSync(join(root,'staging/partner-owner-correction-v3/canonical-entry.cjs'),'utf8'));
 for(const name of ["service.cjs","workspace-identity.cjs","shared-count-standings.cjs","approved-published-categories.cjs","submission-publication-guard.cjs","owner-approved-individual-count-input.cjs"])
  assert.equal(p.bundle[OWNER_SOURCE+'/'+name],readFileSync(join(root,'functions-partner-workspace',name),'utf8'));
 assert.doesNotMatch(p.bundle[OWNER_SOURCE+'/index.js'],/exports\.(submitPartnerWorkspaceCounts|managePartnerWorkspace)\s*=/);
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
  const runtime=createRequire(import.meta.url)(join(dest,OWNER_SOURCE,'service.cjs'));
  assert.equal(typeof runtime.makeWorkspace,'function');
  assert(existsSync(join(dest,OWNER_SOURCE,'service.cjs')));
  assert.throws(()=>writeCanonicalOwnerPackage(p,dest),/DESTINATION|ALREADY_EXISTS/);
  assert.throws(()=>writeCanonicalOwnerPackage(p,'relative'),/DESTINATION/);
 }finally{
  for(const [key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;
  assert(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true});
 }
});
test('packaged Owner entry retains existing two names, count-only gates OFF and same canonical callable wiring',async()=>{
 const vm=await import("node:vm");
 const p=prepareCanonicalOwnerPackage(root),entry=p.bundle[OWNER_SOURCE+'/index.js'];
 const env={},exports={},calls=[];
 const fake={
  "firebase-admin/app":{initializeApp:()=>{}},
  "firebase-admin/auth":{getAuth:()=>{}},
  "firebase-admin/firestore":{getFirestore:()=>({}),FieldValue:{},Timestamp:{}},
  "firebase-functions/v2/https":{onCall:(options,handler)=>({options,handler}),HttpsError:Error},
  "./service.cjs":{makeWorkspace:options=>{calls.push(options);return {listHubPartnerCounts:()=>"list",correctHubPartnerCounts:()=>"correct"}}}
 };
 vm.runInNewContext(entry,{exports,process:{env},require:name=>{assert(Object.hasOwn(fake,name),name);return fake[name]}});
 assert.deepEqual(Object.keys(exports).sort(),["correctHubPartnerCounts","listHubPartnerCounts"]);
 assert.equal(exports.listHubPartnerCounts.handler(),"list");
 assert.equal(exports.correctHubPartnerCounts.handler(),"correct");
 const gates=calls[0];
 for(const k of ["enabled","ownerCorrectionReadEnabled","ownerCorrectionWriteEnabled","submissionPublicationEnabled","individualCountInputEnabled"])
  assert.equal(gates[k](),false,k);
 env.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED="enabled";
 assert.equal(gates.enabled(),true);assert.equal(gates.ownerCorrectionReadEnabled(),true);
 assert.equal(gates.ownerCorrectionWriteEnabled(),true);assert.equal(gates.individualCountInputEnabled(),false);
 env.NICO_PARTNER_INDIVIDUAL_COUNT_INPUT_ENABLED="enabled";
 assert.equal(gates.individualCountInputEnabled(),true);assert.equal(gates.submissionPublicationEnabled(),false);
 assert.equal(p.report.deployed,false);assert.equal(p.report.financeBoundaryVerified,false);
});
test('existing workspace runtime binds the same individual input gate, without new endpoints or default activation',async()=>{
 const vm=await import("node:vm"),env={},exports={},calls=[];
 const entry=readFileSync(join(root,'functions-partner-workspace/index.js'),'utf8');
 const fake={
  "firebase-admin/app":{initializeApp:()=>{}},
  "firebase-admin/auth":{getAuth:()=>{}},
  "firebase-admin/firestore":{getFirestore:()=>({}),FieldValue:{},Timestamp:{}},
  "firebase-functions/v2/https":{onCall:(options,handler)=>({options,handler}),HttpsError:Error},
  "./service.cjs":{makeWorkspace:options=>{calls.push(options);return {view:()=>{},manage:()=>{},accept:()=>{},submit:()=>{}}}},
  "./company-code-auth.cjs":{makeCompanyCodeAuth:()=>({issue:()=>{},activate:()=>{},login:()=>{},logout:()=>{}})}
 };
 vm.runInNewContext(entry,{exports,process:{env},require:name=>{assert(Object.hasOwn(fake,name),name);return fake[name]}});
 assert.deepEqual(Object.keys(exports).sort(),["acceptPartnerWorkspaceInvite","activatePartnerCompanyCode","getPartnerWorkspace","issuePartnerCompanyCode","loginPartnerCompanyCode","logoutPartnerCompanyCode","managePartnerWorkspace","submitPartnerWorkspaceCounts"]);
 const gates=calls[0];
 assert.equal(gates.enabled(),false);
 assert.equal(gates.submissionPublicationEnabled(),false);
 assert.equal(gates.individualCountInputEnabled(),false);
 env.NICO_PARTNER_INDIVIDUAL_COUNT_INPUT_ENABLED="enabled";
 assert.equal(gates.individualCountInputEnabled(),true);assert.equal(gates.submissionPublicationEnabled(),false);
 env.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED="enabled";
 assert.equal(gates.submissionPublicationEnabled(),true);
 assert.equal(gates.enabled(),false);
});
