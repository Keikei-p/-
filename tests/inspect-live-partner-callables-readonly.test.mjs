import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspect,classify,summarize,inspectJointRankingMetadata,
 JOINT_RANKING_METADATA_URL,EXPECTED,PROJECT,LIST_URL}
 from '../tools/production/inspect-live-partner-callables-readonly.mjs';

const region='asia-northeast1';
const root='https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+
 '/locations/'+region+'/functions/';
// Cloud Functions REST v2 Function.name is a resource path, NOT an API URL.
const resource='projects/'+PROJECT+'/locations/'+region+'/functions/';
const body=(name,patch={})=>({
 name:resource+name,
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
test('response Function.name must be canonical resource ID, never full REST URL',()=>{
 const id=EXPECTED[0];
 const valid=body(id);
 assert.equal(valid.name,resource+id);
 assert.equal(classify(id,valid,200).countEnabled,true);
 const wrong=classify(id,{...valid,name:root+id},200);
 assert.equal(wrong.deployed,false);
 assert.equal(wrong.countEnabled,false);
});

test('HTTP 404 is a deployment blocker and never fakes success',async()=>{
 const result=await inspect(async url=>{
  if(url===LIST_URL)return answer(200,{functions:EXPECTED
   .filter(name=>name!=='submitPartnerWorkspaceCounts').map(name=>body(name))});
  if(url.endsWith('/submitPartnerWorkspaceCounts'))return answer(404,{});
  return answer(200,body(url.slice(root.length)));
 });
 assert.equal(result.countFunctionMetadataPresent,false);
 assert.equal(result.countFunctionsActive,false);
 assert.equal(result.countFunctionsConfiguredEnabled,false);
 assert.equal(result.functions.submitPartnerWorkspaceCounts.deployed,false);
});
test('404 on individual v2 GET but all four found in canonical regional LIST is a measurable audit conflict, not a missing deployment',async()=>{
 const urls=[];
 const report=await inspect(async url=>{
  urls.push(url);
  if(url===LIST_URL)return answer(200,{functions:EXPECTED.map(name=>body(name))});
  return answer(404,{});
 });
 assert.deepEqual(urls,[...EXPECTED.map(name=>root+name),LIST_URL]);
 assert.equal(report.countFunctionMetadataPresent,true);
 assert.equal(report.countFunctionsActive,true);
 assert.equal(report.countFunctionsConfiguredEnabled,true);
 assert.equal(report.metadataListFallbackUsed,true);
 assert.equal(report.directGetListConflict,true);
 assert.equal(report.safeToCutOverRules,false);
 assert.equal(report.actualCallableInvoked,false);
 assert.equal(report.realPartnerCountEntryVerified,false);
 assert.equal(report.originalSalesDataWrites,0);
 assert.ok(EXPECTED.every(name=>report.functions[name].countEnabled===true));
 assert.doesNotMatch(JSON.stringify(report),/nico-counts-abc|PARTNER_WORKSPACE_ENABLED|https:\/\//);
});

test('regional LIST metadata fails closed on 403, pagination, duplicates, and malformed payloads',async()=>{
 const fallback=async (list)=>inspect(async url=>
  url===LIST_URL?list:answer(404,{}));
 for(const response of [
  answer(403,{}),answer(500,{}),
  answer(200,{functions:{bad:true}}),
  answer(200,{functions:EXPECTED.map(name=>body(name)),nextPageToken:'unreviewed'}),
  answer(200,{functions:[body(EXPECTED[0]),body(EXPECTED[0])]}),
  answer(200,{functions:[{name:resource+EXPECTED[0]}]})
 ]){
  if(response===undefined)continue;
  // A syntactically present but incomplete v2 listing must never certify
  // all functions as ACTIVE or unlock any signed-in release gate.
  if((await response.json())?.functions?.length===1 &&
      (await response.json()).functions[0].name===resource+EXPECTED[0] &&
      !(await response.json()).functions[0].buildConfig){
   const report=await fallback(response);
   assert.equal(report.countFunctionsConfiguredEnabled,false);
   assert.equal(report.safeToCutOverRules,false);
  }else await assert.rejects(fallback(response),/STOP_PARTNER_CALLABLES_/);
 }
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

test('joint Function metadata GET verifies deployed ACTIVE flag while never claiming real-account finance denial',async()=>{
 const calls=[];
 const result=await inspectJointRankingMetadata(async url=>{
  calls.push(url);
  return answer(200,body('getVerifiedJointCountRanking',{
   serviceConfig:{uri:'https://nico-count-api-001.a.run.app',
    environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:'enabled'}}
  }));
 });
 assert.deepEqual(calls,[JOINT_RANKING_METADATA_URL]);
 assert.equal(result.jointRankingFunctionPresent,true);
 assert.equal(result.jointRankingFunctionActive,true);
 assert.equal(result.jointRankingFunctionConfiguredEnabled,true);
 assert.equal(result.jointMetadataFromRegionalList,false);
 assert.equal(result.realPartnerFinanceDenyVerified,false);
 assert.equal(result.realPartnerCountEntryVerified,false);
 assert.doesNotMatch(JSON.stringify(result),/nico-count-api|a\\.run\\.app|uid|token/i);
});
test('joint Function default-OFF is identified even when gen2 metadata exists',async()=>{
 const result=await inspectJointRankingMetadata(async()=>answer(200,
  body('getVerifiedJointCountRanking',{serviceConfig:{
   uri:'https://nico-count-api-001.a.run.app',environmentVariables:{}
  }})));
 assert.equal(result.jointRankingFunctionPresent,true);
 assert.equal(result.jointRankingFunctionActive,true);
 assert.equal(result.jointRankingFunctionConfiguredEnabled,false);
});
test('joint direct 404 is independently reconciled with full regional GET-only inventory',async()=>{
 const cases=[
  {functions:[],expectPresent:false,expectEnabled:false},
  {functions:[body('getVerifiedJointCountRanking',{
   serviceConfig:{uri:'https://nico-count-api-001.a.run.app',
    environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:'enabled'}}
  })],expectPresent:true,expectEnabled:true}
 ];
 for(const c of cases){
  const calls=[];
  const result=await inspectJointRankingMetadata(async url=>{
   calls.push(url);
   return url===LIST_URL?answer(200,{functions:c.functions}):answer(404,{});
  });
  assert.deepEqual(calls,[JOINT_RANKING_METADATA_URL,LIST_URL]);
  assert.equal(result.jointRankingFunctionPresent,c.expectPresent);
  assert.equal(result.jointRankingFunctionConfiguredEnabled,c.expectEnabled);
  assert.equal(result.jointMetadataFromRegionalList,true);
 }
});
test('joint Function permission failures, partial listings and suspicious descriptors never certify release',async()=>{
 for(const code of [401,403,429,500]){
  await assert.rejects(inspectJointRankingMetadata(async()=>answer(code,{})),
   /STOP_PARTNER_CALLABLES_/);
 }
 for(const listing of [
  {nextPageToken:'page2',functions:[]},
  {functions:[body('getVerifiedJointCountRanking'),
   body('getVerifiedJointCountRanking')]},
  {functions:null}
 ]){
  await assert.rejects(inspectJointRankingMetadata(async url=>
   url===LIST_URL?answer(200,listing):answer(404,{})),
   /STOP_PARTNER_CALLABLES_/);
 }
 for(const patch of [
  {name:resource+'unexpectedRanking'},
  {state:'FAILED'},
  {buildConfig:{runtime:'python312',entryPoint:'getVerifiedJointCountRanking'}},
  {serviceConfig:{uri:'http://evil.invalid',
   environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:'enabled'}}}
 ]){
  if(patch.name){
   await assert.rejects(inspectJointRankingMetadata(async()=>answer(200,
    body('getVerifiedJointCountRanking',patch))),/STOP_PARTNER_CALLABLES_/);
  }else{
   const report=await inspectJointRankingMetadata(async()=>answer(200,
    body('getVerifiedJointCountRanking',patch)));
   assert.equal(report.jointRankingFunctionActive,false);
   assert.equal(report.jointRankingFunctionConfiguredEnabled,false);
  }
 }
});
