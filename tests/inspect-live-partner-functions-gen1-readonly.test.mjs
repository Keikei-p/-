import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXPECTED,PROJECT} from '../tools/production/inspect-live-partner-callables-readonly.mjs';
import {classifyLegacy,inspectLegacy} from '../tools/production/inspect-live-partner-functions-gen1-readonly.mjs';
const prefix='https://cloudfunctions.googleapis.com/v1/projects/'+PROJECT+
 '/locations/asia-northeast1/functions/';
const make=(name,changes={})=>({
 name:'projects/'+PROJECT+'/locations/asia-northeast1/functions/'+name,
 status:'ACTIVE',entryPoint:name,runtime:'nodejs20',
 httpsTrigger:{url:'https://asia-northeast1-sales-management-cc116.cloudfunctions.net/'+name},
 environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled'},...changes
});
test('four real-generation1 endpoint URLs, boolean-only metadata, no invocation',async()=>{
 const urls=[];
 const result=await inspectLegacy(async url=>{
  urls.push(url);
  return {status:200,json:async()=>make(url.slice(prefix.length))};
 });
 assert.deepEqual(urls,EXPECTED.map(name=>prefix+name));
 assert.equal(result.legacyFunctionsPresent,true);
 assert.equal(result.legacyFunctionsActive,true);
 assert.equal(result.legacyFunctionsConfiguredEnabled,true);
 assert.equal(result.liveCallableInvocations,0);
 assert.equal(result.liveCountWrites,0);
 assert.equal(result.productionDocumentWrites,0);
 assert.equal(result.realCountInputVerified,false);
 assert.equal(result.safeToCutOverRules,false);
 assert.doesNotMatch(JSON.stringify(result),/asia-northeast1-sales-management-cc116\.cloudfunctions\.net|PARTNER_WORKSPACE_ENABLED/);
});
test('404 and inactive function block, but are not mistaken for a real count write failure',async()=>{
 const o=await inspectLegacy(async url=>
  url.endsWith('/submitPartnerWorkspaceCounts')?
   {status:404}:{status:200,json:async()=>make(url.slice(prefix.length))});
 assert.equal(o.legacyFunctionsPresent,false);
 assert.equal(o.legacyFunctionsActive,false);
 assert.equal(o.legacyFunctionsConfiguredEnabled,false);
 assert.equal(o.functions.submitPartnerWorkspaceCounts.present,false);
});
test('foreign resource, wrong entrypoint, disabled env, unsafe URL, wrong runtime are never enabled',()=>{
 for(const bad of [
  {name:'projects/other/locations/other/functions/getPartnerWorkspace'},
  {status:'FAILED'},
  {entryPoint:'deleteRecords'},
  {environmentVariables:{PARTNER_WORKSPACE_ENABLED:'disabled'}},
  {httpsTrigger:{url:'http://localhost/getPartnerWorkspace'}},
  {httpsTrigger:{url:'https://attacker.example/getPartnerWorkspace'}},
  {runtime:'python312'}
 ]){
  assert.equal(classifyLegacy(EXPECTED[0],make(EXPECTED[0],bad),200).enabled,false);
 }
 assert.throws(()=>classifyLegacy('foreign',make(EXPECTED[0]),200),/STOP_LEGACY_COUNT_FUNCTION_UNKNOWN_FUNCTION/);
});
test('no permission, throttling, transport or JSON errors can be treated as 404',async()=>{
 for(const code of [401,403,429,500]){
  await assert.rejects(inspectLegacy(async()=>({status:code})),/STOP_LEGACY_COUNT_FUNCTION_/);
 }
 await assert.rejects(inspectLegacy(async()=>{throw Error('private oauth values');}),
  /STOP_LEGACY_COUNT_FUNCTION_TRANSPORT_FAILURE/);
 await assert.rejects(inspectLegacy(async()=>({status:200,json:async()=>{throw Error('private');}})),
  /STOP_LEGACY_COUNT_FUNCTION_MALFORMED_METADATA/);
});
test('read-only code cannot deploy, change Firestore, or print response/credentials',()=>{
 const s=readFileSync(new URL('../tools/production/inspect-live-partner-functions-gen1-readonly.mjs',import.meta.url),'utf8');
 assert.match(s,/method:'GET'/);
 assert.match(s,/safeToCutOverRules:false/);
 assert.doesNotMatch(s,/method:'POST'|method:'PATCH'|method:'DELETE'|method:'PUT'/);
 assert.doesNotMatch(s,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|firestore\.googleapis\.com/);
 assert.doesNotMatch(s,/console\.log\(response|console\.log\(token|console\.log\(data/);
});
