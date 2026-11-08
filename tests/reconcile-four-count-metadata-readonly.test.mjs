import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarize,EXPECTED,PROJECT} from '../tools/production/inspect-live-partner-callables-readonly.mjs';
import {reconcile,parsePrivateDirectLog,OUTPUT_PREFIX} from
 '../tools/production/reconcile-four-count-metadata-readonly.mjs';

const region='asia-northeast1';
const source=(ready=false)=>summarize(EXPECTED.map(name=>({name,
 deployed:ready,active:ready,callableGen2:ready,countEnabled:ready
})));
const cli=()=>({result:EXPECTED.map(name=>({
 id:'projects/'+PROJECT+'/locations/'+region+'/functions/'+name,
 region,platform:'gcfv2',status:'ACTIVE',codebase:'partner-workspace',
 environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled',PRIVATE_KEY:'must-not-print'},
 serviceConfig:{uri:'https://private.a.run.app'}
}))});

test('API per-function 200 but incompatible metadata is not falsely called UNDEPLOYED when CLI independently verifies all four',()=>{
 const summary=reconcile(source(false),cli());
 assert.equal(summary.project,PROJECT);
 assert.equal(summary.countFunctionMetadataPresent,true);
 assert.equal(summary.countFunctionsActive,true);
 assert.equal(summary.countFunctionsConfiguredEnabled,true);
 assert.equal(summary.metadataSourcesDisagree,true);
 assert.equal(summary.metadataEvidence,'FIREBASE_CLI_INDEPENDENT_REGIONAL_CROSSCHECK');
 assert.equal(summary.realPartnerCountEntryVerified,false);
 assert.equal(summary.realPartnerFinanceDenyVerified,false);
 assert.equal(summary.safeToCutOverRules,false);
 assert.equal(summary.actualCallableInvoked,false);
 assert.equal(summary.originalSalesDataWrites,0);
 for(const name of EXPECTED)
  assert.deepEqual(summary.functions[name],{
   deployed:true,active:true,callableGen2:true,countEnabled:true
  });
 assert.doesNotMatch(JSON.stringify(summary),/PRIVATE_KEY|must-not-print|private\.a\.run\.app/);
});

test('CLI and direct metadata agreement never grants live Rules release',()=>{
 const r=reconcile(source(true),cli());
 assert.equal(r.metadataSourcesDisagree,false);
 assert.equal(r.countFunctionsConfiguredEnabled,true);
 assert.equal(r.safeToCutOverRules,false);
});

test('missing, duplicate, wrong-region, disabled and foreign CLI metadata fail closed',()=>{
 const cases=[
  {result:[]},
  {result:cli().result.slice(0,3)},
  {result:[...cli().result,cli().result[0]]},
  {result:cli().result.map((v,i)=>i?v:{...v,region:'us-central1'})},
  {result:cli().result.map((v,i)=>i?v:{...v,status:'FAILED'})},
  {result:cli().result.map((v,i)=>i?v:{...v,platform:'gcfv1'})},
  {result:cli().result.map((v,i)=>i?v:{...v,codebase:'different'})},
  {result:cli().result.map((v,i)=>i?v:{...v,environmentVariables:{PARTNER_WORKSPACE_ENABLED:'disabled'}})},
  {result:cli().result.map((v,i)=>i?v:{
   ...v,id:'projects/other-project/locations/'+region+'/functions/'+EXPECTED[0]
  })}
 ];
 for(const input of cases){
  const report=reconcile(source(true),input);
  assert.equal(report.countFunctionsConfiguredEnabled,false);
  assert.equal(report.safeToCutOverRules,false);
  assert.equal(report.realPartnerCountEntryVerified,false);
 }
 assert.throws(()=>reconcile(source(true),{result:null}),/STOP_COUNT_METADATA_RECONCILIATION_INVALID_CLI_EVIDENCE/);
 assert.throws(()=>reconcile({...source(true),project:'other'},cli()),/STOP_COUNT_METADATA_RECONCILIATION_INVALID_DIRECT_AUDIT/);
});

test('read-only original Functions audit must have a unique validated report, never raw developer output',()=>{
 const input=source(false);
 assert.deepEqual(parsePrivateDirectLog('private diagnostic log\n'+OUTPUT_PREFIX+
  JSON.stringify(input)+'\n'),input);
 assert.throws(()=>parsePrivateDirectLog(''),/DIRECT_REPORT_COUNT/);
 assert.throws(()=>parsePrivateDirectLog(OUTPUT_PREFIX+JSON.stringify(input)+'\n'+
  OUTPUT_PREFIX+JSON.stringify(input)),/DIRECT_REPORT_COUNT/);
 assert.throws(()=>parsePrivateDirectLog(OUTPUT_PREFIX+'not-json'),/DIRECT_REPORT_JSON/);
 assert.throws(()=>parsePrivateDirectLog(OUTPUT_PREFIX+JSON.stringify({...input,safeToCutOverRules:true})),/DIRECT_AUDIT_CONTRACT/);
});

test('production workflow only inventories, never deploys, and deletes private CLI/REST/credential logs',()=>{
 const wf=readFileSync(new URL('../.github/workflows/nico-unified-release-readiness-readonly.yml',import.meta.url),'utf8');
 for(const marker of [
  'firebase-tools@15.34.1',
  'firebase functions:list --project',
  'inspect-live-partner-callables-readonly.mjs',
  'reconcile-four-count-metadata-readonly.mjs',
  'nico-readiness-functions-rest.private.log',
  'nico-readiness-cli.private.json',
  'nico-readiness-cli-stderr.private.log',
  'PARTNER_COUNT_FUNCTION_METADATA ',
  'metadataEvidence',
  'rm -f "$RUNNER_TEMP/nico-readiness-cli.private.json"'
 ]) assert.ok(wf.includes(marker),'Missing audited gate '+marker);
 assert.doesNotMatch(wf,/firebase deploy|functions:delete|gcloud functions deploy|firestore:rules/);
 assert.match(wf,/FIREBASE_PROJECT_ID: sales-management-cc116/);
 const src=readFileSync(new URL('../tools/production/reconcile-four-count-metadata-readonly.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/method:'POST'|method:'PATCH'|method:'DELETE'|setDoc\(|updateDoc\(|deleteDoc\(|firebase deploy/);
 assert.match(src,/safeToCutOverRules:false/);
});
