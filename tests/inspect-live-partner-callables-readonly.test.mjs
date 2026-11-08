import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspect,classify,summarize,reconcileWithCli,EXPECTED,PROJECT}
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
const cliRows=()=>({result:EXPECTED.map(name=>({
 id:'projects/'+PROJECT+'/locations/'+region+'/functions/'+name,
 region,platform:'gcfv2',status:'ACTIVE',codebase:'partner-workspace',
 environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled',PRIVATE_API_TOKEN:'never-public'}
}))});

test('real deployment regression: per-function REST 404 and exact CLI ACTIVE => metadata confirmed, discrepancy surfaced',async()=>{
 const rest=await inspect(async()=>answer(404,{}));
 assert.equal(rest.countFunctionMetadataPresent,false);
 const report=reconcileWithCli(rest,cliRows());
 assert.equal(report.countFunctionMetadataPresent,true);
 assert.equal(report.countFunctionsActive,true);
 assert.equal(report.countFunctionsConfiguredEnabled,true);
 assert.equal(report.metadataSourcesDisagree,true);
 assert.equal(report.metadataSource,'VERIFIED_FIREBASE_CLI_WITH_FUNCTIONS_API_CROSSCHECK');
 assert.equal(report.actualCallableInvoked,false);
 assert.equal(report.realPartnerCountEntryVerified,false);
 assert.equal(report.realPartnerFinanceDenyVerified,false);
 assert.equal(report.safeToCutOverRules,false);
 assert.equal(report.originalSalesDataWrites,0);
 assert.equal(JSON.stringify(report).includes('PRIVATE_API_TOKEN'),false);
 assert.equal(JSON.stringify(report).includes('never-public'),false);
 for(const name of EXPECTED)
  assert.deepEqual(report.functions[name],{
   deployed:true,active:true,callableGen2:true,countEnabled:true
  });
});

test('independent Functions API and exact CLI fully agree when both sources see ACTIVE',async()=>{
 const rest=await inspect(async url=>answer(200,body(url.slice(root.length))));
 const both=reconcileWithCli(rest,cliRows());
 assert.equal(both.countFunctionsConfiguredEnabled,true);
 assert.equal(both.metadataSourcesDisagree,false);
 assert.equal(both.safeToCutOverRules,false);
});

test('untrusted, ambiguous, missing or disabled CLI rows always block readiness despite REST ACTIVE',async()=>{
 const good=await inspect(async url=>answer(200,body(url.slice(root.length))));
 const cases=[
  {result:[]},
  {result:cliRows().result.slice(0,3)},
  {result:[...cliRows().result,cliRows().result[0]]},
  {result:cliRows().result.map((x,i)=>i?x:{...x,region:'us-central1'})},
  {result:cliRows().result.map((x,i)=>i?x:{...x,status:'DEPLOYING'})},
  {result:cliRows().result.map((x,i)=>i?x:{...x,platform:'gcfv1'})},
  {result:cliRows().result.map((x,i)=>i?x:{...x,codebase:'unapproved'})},
  {result:cliRows().result.map((x,i)=>i?x:{...x,environmentVariables:{PARTNER_WORKSPACE_ENABLED:'disabled'}})},
  {result:cliRows().result.map((x,i)=>i?x:{...x,id:'projects/other-project/locations/'+region+'/functions/'+EXPECTED[0]})}
 ];
 for(const value of cases){
  const a=reconcileWithCli(good,value);
  assert.equal(a.countFunctionsConfiguredEnabled,false);
  assert.equal(a.safeToCutOverRules,false);
 }
 assert.throws(()=>reconcileWithCli(good,{result:null}),/STOP_FOUR_COUNT_CLI_INVENTORY_/);
 assert.throws(()=>reconcileWithCli({...good,project:'other'},cliRows()),/STOP_PARTNER_CALLABLES_RECONCILE_PRIMARY/);
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
