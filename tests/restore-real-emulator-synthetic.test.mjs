import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreToLocalEmulator,TEST_PROJECT} from '../tools/readonly-backup/restore-emulator.mjs';
import {PROJECT,fingerprint} from '../tools/readonly-backup/backup.mjs';

/**
 * This test uses a real LOCAL Firestore emulator REST API, NOT a mocked fetch.
 * Every value is explicitly synthetic. No archive/credential/production read.
 * This is not a proof that an actual live backup has been restored.
 */
const stamp='2026-11-05T00:00:00Z';
const doc=(path,fields)=>({path,value:{
 fields,createTime:stamp,updateTime:stamp
}});
const str=s=>({stringValue:s});
const int=n=>({integerValue:String(n)});
const syntheticArchive=()=>({
 projectId:PROJECT,format:'firestore-rest-typed-v1',
 documents:[
  doc('companies/synthetic-direct',{
   companyKind:str('internal'),active:{booleanValue:true},
   ownerUid:str('synthetic-owner')}),
  doc('companies/synthetic-direct/members/synthetic-owner',{
   uid:str('synthetic-owner'),companyRole:str('owner'),
   teamHistory:{arrayValue:{values:[str('synthetic-first-team'),str('synthetic-second-team')]}}}),
  doc('products/synthetic-nuro',{
   companyId:str('synthetic-direct'),name:str('synthetic-product'),
   pricingOptions:{arrayValue:{values:[{mapValue:{fields:{
    cashback:int(10000),revenuePerUnit:int(20000)
   }}}]}}}),
  doc('records/synthetic-sale',{
   companyId:str('synthetic-direct'),totalCount:int(2),totalRevenue:int(40000),
   results:{mapValue:{fields:{synthetic_cb:{mapValue:{fields:{
    productId:str('synthetic-nuro'),count:int(2),revenuePerUnit:int(20000)
   }}}}}}}),
  doc('recordCorrections/synthetic-correction',{
   recordId:str('synthetic-sale'),before:{mapValue:{fields:{totalCount:int(1)}}},
   after:{mapValue:{fields:{totalCount:int(2)}}}}),
  doc('users/synthetic-owner',{
   companyId:str('synthetic-direct'),companyRole:str('owner')})
 ]
});
function localSend(host){
 const expected='http://'+host+'/v1/projects/'+TEST_PROJECT+'/databases/(default)/documents/';
 const observed=[];
 const send=async(url,init)=>{
  assert.equal(typeof url,'string');
  assert(url.startsWith(expected),'firestore REST must stay on localhost demo project');
  assert(!url.includes(PROJECT),'never target production Firestore');
  assert(['GET','PATCH'].includes(init?.method));
  assert.equal(init.redirect,'error');
  assert.equal(init.headers?.Authorization,'Bearer owner');
  if(init.method==='PATCH')assert(url.endsWith('?currentDocument.exists=false'),
   'every write must be create-only and confined to emulator');
  observed.push({method:init.method,url});
  return fetch(url,init);
 };
 return {send,observed};
}
test('real emulator round-trips archived count, finance and history fields without overwriting originals',async()=>{
 const host=process.env.FIRESTORE_EMULATOR_HOST;
 assert.match(host??'',/^127\.0\.0\.1:[1-9]\d{0,4}$/,'local test emulator only');
 assert.equal(process.env.GCLOUD_PROJECT,TEST_PROJECT,'never run in production project');
 const original=syntheticArchive();
 const bytes=JSON.stringify(original);
 const originalHash=fingerprint(original);
 const {send,observed}=localSend(host);
 const result=await restoreToLocalEmulator(original,{
  emulatorHost:host,projectId:TEST_PROJECT,send,maxDocuments:100
 });
 assert.equal(result.destinationProject,TEST_PROJECT);
 assert.equal(result.documentCount,original.documents.length);
 assert.equal(result.sourceInventoryFingerprint,originalHash);
 assert.equal(result.fieldsAndIdsVerified,true);
 assert.equal(result.metadataTimestampsPreserved,false);
 assert.equal(result.productionTouched,false);
 assert.equal(JSON.stringify(original),bytes,'source snapshot is never changed');
 assert.equal(observed.length,original.documents.length*3);
 assert.deepEqual(
  ['GET','PATCH','GET'].map((method,i)=>
   observed.slice(i*original.documents.length,(i+1)*original.documents.length)
    .every(q=>q.method===method)),
  [true,true,true]);
 // A second restore must STOP before any write, not overwrite counts or prices.
 observed.length=0;
 await assert.rejects(
  restoreToLocalEmulator(original,{
   emulatorHost:host,projectId:TEST_PROJECT,send,maxDocuments:100
  }),
  /BLOCK: emulator destination is not proven empty/
 );
 assert(observed.length>0);
 assert(observed.every(q=>q.method==='GET'));
 const recordUrl='http://'+host+'/v1/projects/'+TEST_PROJECT+
  '/databases/(default)/documents/records/synthetic-sale';
 const record=await (await send(recordUrl,{
  method:'GET',redirect:'error',headers:{Authorization:'Bearer owner'}
 })).json();
 assert.equal(record.fields.totalCount.integerValue,'2');
 assert.equal(record.fields.totalRevenue.integerValue,'40000');
 assert.equal(record.fields.results.mapValue.fields.synthetic_cb.mapValue.fields.count.integerValue,'2');
});
test('wrong project or cloud host is rejected before even a synthetic request',async()=>{
 let networkCalls=0;
 const send=async()=>{networkCalls++;throw Error('must not call network');};
 for(const [host,projectId] of [
  ['firestore.googleapis.com:443',TEST_PROJECT],
  ['127.0.0.1:8080',PROJECT],
  ['localhost:8080',TEST_PROJECT]
 ]){
  await assert.rejects(restoreToLocalEmulator(syntheticArchive(),{
   emulatorHost:host,projectId,send,maxDocuments:100
  }),/BLOCK/);
 }
 assert.equal(networkCalls,0);
});
