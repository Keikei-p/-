import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspect,classify,summarize,EXPECTED,PROJECT}
 from '../tools/production/inspect-live-partner-callables-readonly.mjs';

const region='asia-northeast1';
const root='https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+
 '/locations/'+region+'/functions/';
const body=(name,patch={})=>({
 name:root+name,
 state:'ACTIVE',
 buildConfig:{runtime:'nodejs22',entryPoint:name},
 serviceConfig:{uri:'https://nico-counts-abc.a.run.app',
  environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled'}},
 ...patch
});
const answer=(code,contents)=>({
 status:code,json:async()=>contents
});
test('all four targets have fixed regional URL, active state and exact enabled flag',async()=>{
 const urls=[];
 const report=await inspect(async url=>{
  urls.push(url);
  return answer(200,body(url.slice(root.length)));
 });
 assert.deepEqual(urls,EXPECTED.map(name=>root+name));
 assert.equal(report.project,PROJECT);
 assert.equal(report.mode,'CLOUD_FUNCTIONS_METADATA_GET_ONLY');
 assert.equal(report.countFunctionMetadataPresent,true);
 assert.equal(report.countFunctionsActive,true);
 assert.equal(report.countFunctionsConfiguredEnabled,true);
 assert.equal(report.actualCallableInvoked,false);
 assert.equal(report.realPartnerCountEntryVerified,false);
 assert.equal(report.realPartnerFinanceDenyVerified,false);
 assert.equal(report.originalSalesDataWrites,0);
 assert.equal(report.safeToCutOverRules,false);
 assert.doesNotMatch(JSON.stringify(report),/nico-counts-abc|PARTNER_WORKSPACE_ENABLED|enabled/);
});
test('HTTP 404 is a deployment blocker and never fakes success',async()=>{
 const result=await inspect(async url=>{
  if(url.endsWith('/submitPartnerWorkspaceCounts'))return answer(404,{});
  return answer(200,body(url.slice(root.length)));
 });
 assert.equal(result.countFunctionMetadataPresent,false);
 assert.equal(result.countFunctionsActive,false);
 assert.equal(result.countFunctionsConfiguredEnabled,false);
 assert.equal(result.functions.submitPartnerWorkspaceCounts.deployed,false);
});
test('disabled or unknown function state and non-HTTPS gen2 URL stay blocked',()=>{
 for(const patch of [
  {state:'DEPLOYING'},
  {state:'FAILED'},
  {serviceConfig:{environmentVariables:{PARTNER_WORKSPACE_ENABLED:'disabled'},uri:'https://approved.a.run.app'}},
  {serviceConfig:{environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled'},uri:'http://localhost'}},
  {serviceConfig:{environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled'}}},
  {buildConfig:{runtime:'python312',entryPoint:EXPECTED[0]}},
  {buildConfig:{runtime:'nodejs22',entryPoint:'otherFunction'}},
  {name:'projects/different/locations/other/functions/another'}
 ]){
  const item=classify(EXPECTED[0],body(EXPECTED[0],patch),200);
  assert.equal(item.countEnabled,false,JSON.stringify(patch));
 }
});
test('missing, duplicate or malformed four-callable inventory aborts cleanly',()=>{
 const row=name=>({name,deployed:true,active:true,callableGen2:true,countEnabled:true});
 assert.throws(()=>summarize(EXPECTED.slice(0,3).map(row)),/STOP_PARTNER_CALLABLES_INVENTORY_INCOMPLETE/);
 assert.throws(()=>summarize(EXPECTED.map(()=>row(EXPECTED[0]))),/STOP_PARTNER_CALLABLES_INVENTORY_UNTRUSTED/);
 assert.throws(()=>summarize(EXPECTED.map((name,i)=>i===0?{name,deployed:true}:row(name))),
  /STOP_PARTNER_CALLABLES_INVENTORY_UNTRUSTED/);
 assert.throws(()=>classify('deleteEverything',body(EXPECTED[0]),200),/STOP_PARTNER_CALLABLES_UNKNOWN_TARGET/);
});
test('401/403 and network errors are UNKNOWN, not interpreted as missing deployments',async()=>{
 for(const code of [401,403,500,429]){
  await assert.rejects(inspect(async()=>answer(code,{})),/STOP_PARTNER_CALLABLES_/);
 }
 await assert.rejects(inspect(async()=>{throw Error('private tokens');}),
  /STOP_PARTNER_CALLABLES_READ_TRANSPORT_UNVERIFIED/);
 await assert.rejects(inspect(async()=>({status:200,json:async()=>{throw Error('private doc')}})),
  /STOP_PARTNER_CALLABLES_/);
});
test('no production write verbs, credentials or values emitted to console',()=>{
 const source=readFileSync(new URL('../tools/production/inspect-live-partner-callables-readonly.mjs',import.meta.url),'utf8');
 assert.match(source,/method:'GET'/);
 assert.match(source,/safeToCutOverRules:false/);
 assert.doesNotMatch(source,/method:'POST'|method:'PATCH'|method:'DELETE'|method:'PUT'/);
 assert.doesNotMatch(source,/setDoc\(|updateDoc\(|deleteDoc\(|firestore\.googleapis\.com|firebase deploy/);
 assert.doesNotMatch(source,/console\.log\(token|console\.log\(body|console\.log\(response/);
});
