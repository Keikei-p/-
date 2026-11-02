import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {releaseBoundary,permitted} from '../tools/production/release-partner-boundary.mjs';
import {fingerprint} from '../tools/readonly-backup/backup.mjs';
const reviewed=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const old=readFileSync(new URL('./fixtures/partner-boundary-before.rules',import.meta.url),'utf8');
const root='https://firebaserules.googleapis.com/v1/projects/sales-management-cc116';
const oldName='projects/sales-management-cc116/rulesets/old',newName='projects/sales-management-cc116/rulesets/new';
function fixture(){
 let current=oldName,reads=0;
 const writes=[],logs=[];
 const data={projectId:'sales-management-cc116',format:'firestore-rest-typed-v1',documents:[
  {path:'records/synthetic',value:{fields:{count:{integerValue:'3'}},createTime:'2026-01-01',updateTime:'2026-01-02'}}]};
 const options={reviewed,apply:true,log:x=>logs.push(x),
  backup:async()=>({readyBackups:1,latestReadySnapshot:new Date().toISOString()}),
  snapshot:async()=>{reads++;return structuredClone(data);},
  restore:async snapshot=>({fieldsAndIdsVerified:true,productionTouched:false,documentCount:1,sourceInventoryFingerprint:fingerprint(snapshot)}),
  request:async(method,url,body)=>{
   assert.equal(permitted(method,url,body),true);
   if(method==='GET'){
    if(url.endsWith('/releases/cloud.firestore'))return {rulesetName:current};
    return {source:{files:[{content:url.endsWith('/old')?old:reviewed}]}};
   }
   writes.push({method,url,body});
   if(method==='POST')return {name:newName};
   current=body.release.rulesetName;return body.release;
  }};
 return {options,writes,logs,data,current:()=>current,reads:()=>reads,setCurrent:value=>current=value};
}
test('approved surgical rule switch restores every field, compares inventories and reads back release',async()=>{
 const f=fixture(),result=await releaseBoundary(f.options);
 assert.equal(result.applied,true);assert.equal(result.fullInventoryStableAfter,true);
 assert.equal(f.reads(),3);assert.equal(f.current(),newName);
 assert.deepEqual(f.writes.map(w=>w.method),['POST','PATCH']);
 assert.equal(result.productionDocumentWrites,0);
 assert.doesNotMatch(JSON.stringify(f.logs),/synthetic|integerValue|2026-01/);
});
test('verify mode does not create or activate a Ruleset',async()=>{
 const f=fixture();f.options.apply=false;
 const result=await releaseBoundary(f.options);
 assert.equal(result.applied,false);assert.equal(f.writes.length,0);assert.equal(f.reads(),2);
});
test('missing backup, failed restore, unreviewed candidate and moving inventory all stop before any remote write',async()=>{
 for(const failure of ['backup','restore','source','data']){
  const f=fixture();
  if(failure==='backup')f.options.backup=async()=>({readyBackups:0});
  if(failure==='restore')f.options.restore=async()=>({fieldsAndIdsVerified:false});
  if(failure==='source')f.options.reviewed+='\n// unexpected';
  if(failure==='data'){let n=0;f.options.snapshot=async()=>{
   const v=structuredClone(f.data);v.documents[0].value.updateTime=String(n++);return v;};}
  await assert.rejects(releaseBoundary(f.options));assert.equal(f.writes.length,0);
 }
});
test('post-release data mismatch restores old Rules only and never writes data',async()=>{
 const f=fixture(),read=f.options.snapshot;
 f.options.snapshot=async()=>{const v=await read();if(f.reads()===3)v.documents[0].value.updateTime='changed';return v;};
 await assert.rejects(releaseBoundary(f.options),/DATA_CHANGED_AFTER_RELEASE/);
 assert.equal(f.current(),oldName);assert.equal(f.writes.length,3);
 assert.equal(f.logs.at(-1).rulesRolledBack,true);
});
test('uncertain PATCH response is read back and rolled back to the exact original Rules',async()=>{
 const f=fixture(),request=f.options.request;
 f.options.request=async(method,url,body)=>{
  const result=await request(method,url,body);
  if(method==='PATCH'&&body.release.rulesetName===newName)throw Error('simulated transport loss');
  return result;
 };
 await assert.rejects(releaseBoundary(f.options));assert.equal(f.current(),oldName);
});
test('concurrent operator release is never overwritten during rollback',async()=>{
 const f=fixture(),request=f.options.request;
 f.options.request=async(method,url,body)=>{
  const result=await request(method,url,body);
  if(method==='PATCH'){f.setCurrent('projects/sales-management-cc116/rulesets/other');throw Error('race');}
  return result;
 };
 await assert.rejects(releaseBoundary(f.options),/CONCURRENT_RELEASE/);
 assert.equal(f.writes.length,2);
});
test('API transport rejects Firestore writes, other projects, arbitrary Rules and hosts',()=>{
 for(const method of ['POST','PATCH','DELETE'])assert.equal(permitted(method,'https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)/documents/users/test',{}),false);
 assert.equal(permitted('POST',root+'/rulesets',{source:{files:[{name:'firestore.rules',content:'allow read: if true;'}]}}),false);
 assert.equal(permitted('GET',root.replace('sales-management-cc116','other')+'/releases/cloud.firestore'),false);
 assert.equal(permitted('GET','https://evil.example/'),false);
});
