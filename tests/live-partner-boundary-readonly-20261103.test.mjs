import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audit,permitted} from '../tools/production/verify-live-partner-boundary-readonly-20261103.mjs';

const approved=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const ROOT='https://firebaserules.googleapis.com/v1/projects/sales-management-cc116';
const release=ROOT+'/releases/cloud.firestore';
const liveName='projects/sales-management-cc116/rulesets/latest';
const doc={
  path:'records/test',
  value:{
   fields:{totalCount:{integerValue:'3'},results:{arrayValue:{values:[
    {mapValue:{fields:{count:{integerValue:'3'}}}}
   ]}},salesRevenue:{integerValue:'9999999'}},
   createTime:'2026-11-01T00:00:00Z',updateTime:'2026-11-02T00:00:00Z'
  }
};
const snapshot={projectId:'sales-management-cc116',
 format:'firestore-rest-typed-v1',documents:[doc]};
const now=Date.parse('2026-11-03T09:00:00Z');
function setup(){
 const calls=[];
 const request=async(method,url,body)=>{
  assert.equal(permitted(method,url,body),true);
  calls.push({method,url});
  if(url===release)return {rulesetName:liveName};
  if(url.endsWith('/rulesets/latest'))
   return {source:{files:[{name:'firestore.rules',content:approved}]}};
  throw Error('unexpected HTTP request');
 };
 return {calls,args:{request,clock:()=>now,
  backup:async()=>({readyBackups:7,latestReadySnapshot:new Date(now-3600e3).toISOString()}),
  inventory:async()=>structuredClone(snapshot)}};
}
test('readonly boundaries reject mutations and external hosts; allow only safe collection listing POST',()=>{
 const base='https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)/documents';
 for(const method of ['PATCH','PUT','DELETE'])assert.equal(permitted(method,release),false);
 assert.equal(permitted('POST',ROOT+'/rulesets',{source:{files:[]}}),false);
 assert.equal(permitted('GET',release),true);
 assert.equal(permitted('GET',ROOT+'/rulesets/latest'),true);
 assert.equal(permitted('POST',base+':listCollectionIds',{pageSize:50}),true);
 assert.equal(permitted('POST',base+'/records/test',{name:'leak'}),false);
 assert.equal(permitted('GET','https://evil.example/get'),false);
});
test('exact live Rules plus fresh managed backup, stable typed documents and matching counts pass',async()=>{
 const f=setup(),x=await audit(f.args);
 assert.equal(x.currentRulesVerified,true);
 assert.equal(x.productionDocumentWrites,0);
 assert.equal(x.productionRuleWrites,0);
 assert.equal(x.documentsVerified,1);
 assert.equal(x.savedDirectRecordCounts,3);
 assert.equal(x.independentlyMatchedDirectRecordTotals,1);
 assert.equal(x.unmatchedDirectRecordTotals,0);
 assert.equal(x.livePartnerAccountE2EVerified,false);
 assert.equal(x.liveOwnerFinanceUIVerified,false);
 assert.equal(f.calls.every(x=>x.method==='GET'),true);
 assert.doesNotMatch(JSON.stringify(x),/salesRevenue|9999999|test|firebase_service_account_json/i);
});
test('old/deviating Rules, absent/stale backup and live inventory changes stop without writes',async()=>{
 for(const scenario of ['oldRules','badName','noBackup','stale','invalidBackup','dataRace','countMismatch']){
  const f=setup(),orig=f.args.request;
  if(scenario==='oldRules')f.args.request=async(method,url,body)=>{
   const z=await orig(method,url,body);
   return url.endsWith('/rulesets/latest')?
    {source:{files:[{name:'firestore.rules',content:approved+'// changed'}]}}:z;
  };
  if(scenario==='badName')f.args.request=async(method,url,body)=>{
   const z=await orig(method,url,body);
   return url===release?{rulesetName:'projects/other-project/rulesets/unknown'}:z;
  };
  if(scenario==='noBackup')f.args.backup=async()=>({readyBackups:0,latestReadySnapshot:null});
  if(scenario==='invalidBackup')f.args.backup=async()=>({readyBackups:null,latestReadySnapshot:new Date(now).toISOString()});
  if(scenario==='stale')f.args.backup=async()=>({readyBackups:1,latestReadySnapshot:new Date(now-49*3600e3).toISOString()});
  if(scenario==='dataRace'){let n=0;f.args.inventory=async()=>{n++;const v=structuredClone(snapshot);v.documents[0].value.updateTime='2026-11-0'+n+'T00:00:00Z';return v;};}
  if(scenario==='countMismatch')f.args.inventory=async()=>{
   const v=structuredClone(snapshot);
   v.documents[0].value.fields.totalCount.integerValue='4';return v;
  };
  await assert.rejects(audit(f.args),/STOP_/,
   'safety gate must reject '+scenario);
  assert.equal(f.calls.every(x=>x.method==='GET'),true);
 }
});
