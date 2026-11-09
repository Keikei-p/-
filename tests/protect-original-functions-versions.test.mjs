import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORIGINAL} from '../tools/production/inspect-original-partner-functions-readonly.mjs';
import {immutableOriginal,captureOriginal,compareOriginalVersions}
 from '../tools/production/protect-original-functions-versions.mjs';
const base='projects/sales-management-cc116/locations/asia-northeast1/functions/';
const make=(name,custom={})=>({
 name:base+name,state:'ACTIVE',updateTime:'2026-11-07T03:34:35.123456Z',
 buildConfig:{runtime:'nodejs22',entryPoint:name,source:{storageSource:{
  bucket:'private-function-artifacts',object:'opaque-code-archive'}}},
 serviceConfig:{uri:'https://service-private-abc.a.run.app',
  environmentVariables:{PARTNER_WORKSPACE_ENABLED:'enabled'},
  serviceAccountEmail:'internal-service-account@example.iam.gserviceaccount.com'},
 ...custom
});
const answer=(body,status=200)=>({status,json:async()=>body});
test('GET only six approved originals and report booleans, never real config',async()=>{
 const urls=[];
 const snapshot=await captureOriginal(async url=>{
  urls.push(url);
  return answer(make(url.split('/').at(-1)));
 });
 assert.equal(urls.length,6);
 assert.deepEqual(urls.map(x=>x.split('/').at(-1)),ORIGINAL);
 assert.ok(urls.every(x=>x.startsWith('https://cloudfunctions.googleapis.com/v2/projects/sales-management-cc116/')));
 assert.deepEqual(Object.keys(snapshot),ORIGINAL);
 assert.ok(Object.values(snapshot).every(x=>/^[0-9a-f]{64}$/.test(x)));
 const proof=compareOriginalVersions(snapshot,snapshot);
 assert.equal(proof.allOriginalSixVersionsUnchanged,true);
 assert.equal(proof.originalFunctionsReplaced,0);
 assert.equal(proof.originalFunctionsRemoved,0);
 assert.equal(proof.productionDocumentWrites,0);
 assert.equal(proof.livePartnerCountSubmissionVerified,false);
 assert.equal(proof.safeToCutOverFinanceRules,false);
 assert.doesNotMatch(JSON.stringify(proof),/opaque-code-archive|service-account|PARTNER_WORKSPACE_ENABLED/);
});
test('key order changes do not create a false code update',()=>{
 const normal=make(ORIGINAL[0]),reordered={
  serviceConfig:{...normal.serviceConfig},
  updateTime:normal.updateTime,name:normal.name,
  buildConfig:{entryPoint:ORIGINAL[0],source:normal.buildConfig.source,runtime:'nodejs22'},
  state:'ACTIVE'
 };
 assert.equal(immutableOriginal(ORIGINAL[0],normal),immutableOriginal(ORIGINAL[0],reordered));
});
test('detect code/revision/trigger/URI/settings/IAM/service identity drift',()=>{
 const name=ORIGINAL[0],normal=make(name),before={};
 for(const n of ORIGINAL)before[n]=immutableOriginal(n,make(n));
 for(const next of [
  {...normal,updateTime:'2026-11-07T03:35:35.123456Z'},
  {...normal,buildConfig:{...normal.buildConfig,runtime:'nodejs20'}},
  {...normal,serviceConfig:{...normal.serviceConfig,uri:'https://other.a.run.app'}},
  {...normal,serviceConfig:{...normal.serviceConfig,environmentVariables:{PARTNER_WORKSPACE_ENABLED:'disabled'}}},
  {...normal,serviceConfig:{...normal.serviceConfig,serviceAccountEmail:'new-identity@example.iam.gserviceaccount.com'}},
  {...normal,eventTrigger:{eventType:'google.cloud.firestore.document.v1.written'}}
 ]){
  const after={...before,[name]:immutableOriginal(name,next)};
  assert.throws(()=>compareOriginalVersions(before,after),
   /STOP_ORIGINAL_FUNCTION_VERSION_EXISTING_FUNCTION_VERSION_CHANGED/);
 }
});
test('missing, inactive, foreign, malformed metadata stops without revealing sensitive details',async()=>{
 const name=ORIGINAL[0];
 for(const changed of [
  {state:'FAILED'},
  {name:'projects/other/locations/other/functions/'+name},
  {updateTime:'unverified'},
  {buildConfig:null},
  {serviceConfig:null},
  {buildConfig:{runtime:'python312',entryPoint:name}},
  {serviceConfig:{uri:'http://localhost'}}
 ]){
  assert.throws(()=>immutableOriginal(name,make(name,changed)),
   /STOP_ORIGINAL_FUNCTION_VERSION_/);
 }
 assert.throws(()=>immutableOriginal('writeRecords',make(name)),/STOP_ORIGINAL_FUNCTION_VERSION_TARGET_UNKNOWN/);
 await assert.rejects(captureOriginal(async()=>({status:404})),
  /STOP_ORIGINAL_FUNCTION_VERSION_ORIGINAL_GET_NOT_SUCCESSFUL/);
 await assert.rejects(captureOriginal(async()=>{throw Error('private bearer token');}),
  /STOP_ORIGINAL_FUNCTION_VERSION_REMOTE_UNAVAILABLE/);
 await assert.rejects(captureOriginal(async()=>({status:200,json:async()=>{throw Error('private response');}})),
  /STOP_ORIGINAL_FUNCTION_VERSION_ORIGINAL_METADATA_INVALID/);
});
test('partial, malformed and changed original fingerprint inventory is rejected',()=>{
 const before=Object.fromEntries(ORIGINAL.map(n=>[n,immutableOriginal(n,make(n))]));
 assert.throws(()=>compareOriginalVersions(before,{}),/STOP_ORIGINAL_FUNCTION_VERSION_INVENTORY_INCOMPLETE/);
 assert.throws(()=>compareOriginalVersions(before,{...before,[ORIGINAL[0]]:'bad'}),
  /STOP_ORIGINAL_FUNCTION_VERSION_INVALID_FINGERPRINT/);
});
test('version guard cannot invoke Functions, deploy, access Firestore or leak secrets',()=>{
 const source=readFileSync(new URL('../tools/production/protect-original-functions-versions.mjs',import.meta.url),'utf8');
 assert.match(source,/method:'GET'/);
 assert.match(source,/safeToCutOverFinanceRules:false/);
 assert.doesNotMatch(source,/method:'POST'|method:'PUT'|method:'PATCH'|method:'DELETE'/);
 assert.doesNotMatch(source,/firebase deploy|firestore\.googleapis\.com|setDoc\(|updateDoc\(/);
 assert.doesNotMatch(source,/console\.log\(body|console\.log\(token|console\.log\(serviceConfig/);
});
