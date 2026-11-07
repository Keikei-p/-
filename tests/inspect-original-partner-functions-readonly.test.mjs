import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORIGINAL,inspectOriginal,classifyOriginal} from '../tools/production/inspect-original-partner-functions-readonly.mjs';
const root='projects/sales-management-cc116/locations/asia-northeast1/functions/';
const response=(status,body)=>({status,json:async()=>body});
test('all original 6 in gen2, no invocations, no finance writes and never certifies deployment',async()=>{
 const seen=[];
 const result=await inspectOriginal(async url=>{
  seen.push(url);
  const name=url.split('/').at(-1),v=url.includes('/v2/')?'v2':'v1';
  return v==='v2'?response(200,{name:root+name,state:'ACTIVE'}):{status:404};
 });
 assert.equal(seen.length,12);
 assert.equal(result.allOriginalFunctionsPresent,true);
 assert.equal(result.allOriginalFunctionsActive,true);
 assert.equal(result.originalFunctionInvocations,0);
 assert.equal(result.originalProductionWrites,0);
 assert.equal(result.livePartnerCountSubmissionVerified,false);
 assert.equal(result.safeToDeployNewFour,false);
 assert.equal(result.safeToCutOverFinanceRules,false);
});
test('mixed Gen1 and Gen2 original Functions can exist safely, but unknowns remain blockers',async()=>{
 const result=await inspectOriginal(async url=>{
  const name=url.split('/').at(-1),v=url.includes('/v2/')?'v2':'v1';
  const wanted=v===('v2');
  const shouldExist=(ORIGINAL.indexOf(name)%2===0)===wanted;
  return shouldExist?response(200,v==='v2'?{name:root+name,state:'ACTIVE'}:
   {name:root+name,status:'ACTIVE'}):{status:404};
 });
 assert.equal(result.allOriginalFunctionsPresent,true);
 assert.equal(result.allOriginalFunctionsActive,true);
 const missing=await inspectOriginal(async url=>{
  const name=url.split('/').at(-1);
  if(name==='getPartnerQuickCounts')return {status:404};
  return url.includes('/v2/')?response(200,{name:root+name,state:'ACTIVE'}):{status:404};
 });
 assert.equal(missing.allOriginalFunctionsPresent,false);
 assert.equal(missing.allOriginalFunctionsActive,false);
 assert.equal(missing.functions.getPartnerQuickCounts.present,false);
});
test('wrong region, inactive versions or resource names cannot be certified',()=>{
 const name=ORIGINAL[0];
 for(const v of ['v1','v2']){
  assert.deepEqual(classifyOriginal(name,v,null,404),{present:false,active:false});
  assert.equal(classifyOriginal(name,v,{name:root+name,state:'DEPLOYING',status:'FAILED'},200).active,false);
  assert.equal(classifyOriginal(name,v,{name:'projects/other/locations/else/functions/'+name,
   state:'ACTIVE',status:'ACTIVE'},200).present,false);
 }
 assert.throws(()=>classifyOriginal('deleteRecords','v2',{name:'bad'},200),
 /STOP_ORIGINAL_PARTNER_FUNCTIONS_UNKNOWN_TARGET/);
});
test('auth errors, throttling, JSON and transport errors never get mistaken for absent Functions',async()=>{
 for(const status of [401,403,429,500]){
  await assert.rejects(inspectOriginal(async()=>({status})),/STOP_ORIGINAL_PARTNER_FUNCTIONS_/);
 }
 await assert.rejects(inspectOriginal(async()=>{throw Error('secrets must never leak');}),
 /STOP_ORIGINAL_PARTNER_FUNCTIONS_REMOTE_READ_UNVERIFIED/);
 await assert.rejects(inspectOriginal(async()=>response(200,{json:async()=>{throw Error('secrets');}})),
 /STOP_ORIGINAL_PARTNER_FUNCTIONS_/);
});
test('only metadata GET calls; never Firestore writes, deploy or output sensitive response',()=>{
 const code=readFileSync(new URL('../tools/production/inspect-original-partner-functions-readonly.mjs',import.meta.url),'utf8');
 assert.match(code,/method:'GET'/);
 assert.match(code,/safeToCutOverFinanceRules:false/);
 assert.doesNotMatch(code,/method:'POST'|method:'PATCH'|method:'DELETE'|method:'PUT'/);
 assert.doesNotMatch(code,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|console\.log\(response|console\.log\(token/);
});
