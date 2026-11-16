import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FLAGS,TARGET_FLAGS,ENDPOINTS,classifyFeatureFlag,classifyFunctionMetadata,
 summarizeRegionalMetadata,inspectRuntimeFlags}
 from '../tools/production/inspect-publication-runtime-flags-readonly.mjs';

const root='projects/sales-management-cc116/locations/asia-northeast1/functions/';
const gen2=(name,flags={})=>({name:root+name,environment:'GEN_2',state:'ACTIVE',
 buildConfig:{runtime:'nodejs22',entryPoint:name},serviceConfig:{environmentVariables:flags}});
const gen1=(name,flags={})=>({name:root+name,environment:'GEN_1',status:'ACTIVE',
 runtime:'nodejs20',entryPoint:name,environmentVariables:flags});
const pages=(v1=[],v2=[])=>[{apiVersion:'v1',body:{functions:v1}},
 {apiVersion:'v2',body:{functions:v2}}];

test('only exact enabled string enables a runtime gate; unset, missing metadata and other values differ',()=>{
 assert.deepEqual(classifyFeatureFlag({},FLAGS[2]),{state:'unset',effectiveEnabled:false});
 assert.deepEqual(classifyFeatureFlag(undefined,FLAGS[2]),{state:'unavailable',effectiveEnabled:null});
 for(const value of [true,1,'true','ENABLED',' enabled','enabled\n',null])
  assert.deepEqual(classifyFeatureFlag({[FLAGS[2]]:value},FLAGS[2]),
   {state:'unrecognized',effectiveEnabled:false});
 assert.deepEqual(classifyFeatureFlag({[FLAGS[2]]:'enabled'},FLAGS[2]),
  {state:'enabled',effectiveEnabled:true});
 assert.deepEqual(classifyFeatureFlag({[FLAGS[2]]:'disabled'},FLAGS[2]),
  {state:'disabled',effectiveEnabled:false});
 assert.throws(()=>classifyFeatureFlag({},'SECRET'),/FLAG_NOT_ALLOWLISTED/);
});

test('reports actual per-function divergent flags across the complete relevant call chain',()=>{
 const rows=Object.keys(TARGET_FLAGS).map(name=>gen2(name,Object.fromEntries(FLAGS.map(flag=>[flag,'enabled']))));
 rows.find(x=>x.name.endsWith('/submitPartnerWorkspaceCounts'))
  .serviceConfig.environmentVariables[FLAGS[2]]='disabled';
 const result=summarizeRegionalMetadata(pages([],rows));
 assert.equal(result.allTargetMetadataPresent,true);
 assert.equal(result.functions.getPartnerWorkspace.observations[0].flags[FLAGS[2]].effectiveEnabled,true);
 assert.equal(result.functions.submitPartnerWorkspaceCounts.observations[0].flags[FLAGS[2]].effectiveEnabled,false);
 assert.equal(result.functions.getVerifiedJointCountRanking.observations[0].flags[FLAGS[4]].state,'enabled');
 assert.equal(result.functions.getOwnerReviewedSkuMapping.observations[0].flags[FLAGS[1]].state,'enabled');
 assert.equal(result.productionDocumentWrites,0);
 assert.equal(result.liveCallableInvocations,0);
 assert.equal(result.realAccountSaveVerified,false);
 assert.equal(result.realPartnerFinanceDenialVerified,false);
});

test('supports gen1 and gen2 field shapes and surfaces conflicting API metadata without guessing',()=>{
 const a=gen1('getPartnerWorkspace',{[FLAGS[2]]:'enabled'});
 const b=gen2('submitPartnerWorkspaceCounts',{[FLAGS[2]]:'disabled'});
 const result=summarizeRegionalMetadata(pages([a],[a,b]));
 assert.equal(result.functions.getPartnerWorkspace.conflictingApiMetadata,false);
 assert.equal(result.functions.getPartnerWorkspace.observations[1].generation,'gen1');
 assert.equal(result.functions.submitPartnerWorkspaceCounts.observations[0].generation,'gen2');
 const changed=structuredClone(a);changed.environmentVariables[FLAGS[2]]='disabled';
 const conflict=summarizeRegionalMetadata(pages([a],[changed]));
 assert.equal(conflict.conflictingApiMetadata,true);
 assert.equal(conflict.functions.getPartnerWorkspace.observations.length,2);
 assert.equal(conflict.allTargetMetadataPresent,false);
});

test('does not mislabel malformed runtime, inactive deployments or missing env as active enabled',()=>{
 const x=gen2('getPartnerWorkspace');
 x.buildConfig.entryPoint='anotherFunction';
 assert.equal(classifyFunctionMetadata('getPartnerWorkspace',x,'v2').active,false);
 const y=gen1('getPartnerWorkspace');y.status='DEPLOY_IN_PROGRESS';
 assert.equal(classifyFunctionMetadata('getPartnerWorkspace',y,'v1').active,false);
 const z=gen2('getPartnerWorkspace');delete z.serviceConfig.environmentVariables;
 assert.equal(classifyFunctionMetadata('getPartnerWorkspace',z,'v2').flags[FLAGS[2]].state,'unavailable');
 const contradictory=gen2('getPartnerWorkspace');contradictory.state='FAILED';contradictory.status='ACTIVE';
 assert.equal(classifyFunctionMetadata('getPartnerWorkspace',contradictory,'v2').active,false);
 const unknown=gen2('getPartnerWorkspace');unknown.environment='FUTURE_UNKNOWN_GENERATION';
 assert.equal(classifyFunctionMetadata('getPartnerWorkspace',unknown,'v2').runtimeVerified,false);
 assert.throws(()=>classifyFunctionMetadata('getPartnerWorkspace',{...z,name:root+'other'},'v2'),/FUNCTION_IDENTITY/);
});

test('arbitrary env values, service accounts, URIs, revisions and unrelated function metadata never leave summary',()=>{
 const secret='DO_NOT_LOG_PRIVATE_VALUE';
 const row=gen2('getPartnerWorkspace',{[FLAGS[2]]:secret,SECRET:secret});
 row.serviceConfig.serviceAccountEmail=secret;row.serviceConfig.uri=secret;
 row.labels={private:secret};row.buildConfig.source={secret};
 const ignored={name:root+'unrelated',environmentVariables:{SECRET:secret}};
 const output=JSON.stringify(summarizeRegionalMetadata(pages([ignored],[row])));
 assert.equal(output.includes(secret),false);
 assert.equal(output.includes('SECRET'),false);
 assert.match(output,/unrecognized/);
});

test('incomplete listings, duplicates and invalid pagination fail closed',()=>{
 const row=gen2('getPartnerWorkspace');
 assert.throws(()=>summarizeRegionalMetadata(pages([],[row,row])),/DUPLICATE_FUNCTION/);
 const partial=pages();partial[1].body.nextPageToken='more';
 assert.throws(()=>summarizeRegionalMetadata(partial),/INVENTORY_INCOMPLETE/);
 assert.throws(()=>summarizeRegionalMetadata([{apiVersion:'v1',body:{}}]),/INVENTORY_SCOPE/);
 const malformed=pages();malformed[0].body.functions='bad';
 assert.throws(()=>summarizeRegionalMetadata(malformed),/INVENTORY_INCOMPLETE/);
});

test('transport uses only two fixed metadata lists, with no Function invocations or document reads',async()=>{
 const calls=[];
 const summary=await inspectRuntimeFlags(async url=>{calls.push(url);
  return {status:200,json:async()=>({functions:[]})};});
 assert.deepEqual(calls,ENDPOINTS);
 assert.equal(calls.every(url=>url.startsWith('https://cloudfunctions.googleapis.com/')),true);
 assert.equal(summary.allTargetMetadataPresent,false);
 for(const status of [401,403,404,500])
  await assert.rejects(inspectRuntimeFlags(async()=>({status})),/STOP_PUBLICATION_RUNTIME_FLAGS_/);
 await assert.rejects(inspectRuntimeFlags(async()=>{throw Error('PRIVATE_TOKEN')}),/METADATA_GET_FAILED/);
 await assert.rejects(inspectRuntimeFlags(async()=>({status:200,json:async()=>{throw Error('PRIVATE_BODY')}})),/METADATA_JSON/);
});

test('CLI refuses unapproved runtime before SDK or network and emits no arbitrary environment data',()=>{
 const source=new URL('../tools/production/inspect-publication-runtime-flags-readonly.mjs',import.meta.url);
 try{execFileSync(process.execPath,[fileURLToPath(source)],{
  env:{...process.env,GITHUB_ACTIONS:'false',SECRET:'PRIVATE_VALUE'},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.fail('CLI should refuse local runtime');
 }catch(error){
  assert.match(String(error.stderr),/^STOP_PUBLICATION_RUNTIME_FLAGS_UNAPPROVED_RUNTIME\s*$/);
  assert.equal(String(error.stdout).includes('PRIVATE_VALUE'),false);
 }
});

test('workflow keeps credentials out of PR jobs and triggers real GET-only audit on main push or dispatch',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/nico-publication-runtime-flags-readonly.yml',import.meta.url),'utf8');
 const offline=workflow.slice(workflow.indexOf('  offline:'),workflow.indexOf('  live-get-only:'));
 assert.match(workflow,/pull_request:/);assert.match(workflow,/push:/);assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(offline,/secrets\./);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/github\.repository == 'Keikei-p\/-'/);
 assert.match(workflow,/NICO_PUBLICATION_RUNTIME_AUDIT_MODE: GET_ONLY/);
 assert.doesNotMatch(workflow,/firebase deploy|gcloud|upload-artifact|curl|workflow_run/);
 assert.match(workflow,/if: always\(\)/);
});
