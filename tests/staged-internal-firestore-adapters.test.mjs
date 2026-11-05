import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
 buildStagedInternalRunQuery,decodeStagedInternalRunQuery,
 createStagedInternalFirestoreReader
} from '../security/staged-internal-firestore-reader.mjs';
import {
 createStagedInternalFirebaseAdapters,createStagedInternalFirebaseCountGateway,
 assertStagedInternalTransportQuery
} from '../security/staged-internal-firebase-adapters.mjs';
const DB='projects/sales-management-cc116/databases/(default)/documents';
const FIRESTORE_URL='https://firestore.googleapis.com/v1/'+DB+':runQuery';
const TIME='2026-11-05T02:30:00.000000Z';
const companyId='direct',day='2026-11-05';
const string=s=>({stringValue:s}),int=n=>({integerValue:String(n)});
const fields=(x)=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,v]));
const product=(id='nuro',company=companyId)=>({
 document:{name:DB+'/products/'+id,fields:fields({
  companyId:string(company),name:string('NURO光'),active:{booleanValue:true},
  sortOrder:int(0)})},readTime:TIME});
const record=(id='sale0001',company=companyId)=>({
 document:{name:DB+'/records/'+id,fields:fields({
  companyId:string(company),uid:string('owner'),date:string(day),teamId:string('t1'),
  memberNameSnapshot:string('担当者'),teamNameSnapshot:string('1班'),
  workLocation:string('店舗'),reportStatus:string('submitted'),totalCount:int(2),
  results:{mapValue:{fields:{nuro__cb_1:{mapValue:{fields:{
   productId:string('nuro'),count:int(2),productName:string('NURO光'),
   revenuePerUnit:int(50000),cashback:int(10000),
   customerPhone:string('private-phone')
  }}}}}}
 })},readTime:TIME});
const options={companyId,day,cursor:'',snapshotTime:null,limit:50};
function makeReader({products=[product()],records=[record()],mutate=()=>{}}={}){
 const audit=[];
 const executeRunQuery=async req=>{
  audit.push(req);
  const q=req.body.structuredQuery,table=q.from[0].collectionId;
  const response=(table==='products'?products:records);
  return mutate(response,req)??response;
 };
 return {reader:createStagedInternalFirestoreReader({executeRunQuery}),audit};
}
test('fixed REST query projects only fields needed for counts; no company/collection override',()=>{
 const prod=buildStagedInternalRunQuery({table:'products',companyId,limit:201});
 const rec=buildStagedInternalRunQuery({table:'records',companyId,day,
  cursor:'sale0001',snapshotTime:TIME,limit:50});
 assert.equal(prod.endpoint,FIRESTORE_URL);assert.equal(rec.method,'POST');
 assert.deepEqual(prod.body.structuredQuery.from,[{collectionId:'products'}]);
 assert.equal(prod.body.structuredQuery.limit,201);
 assert.deepEqual(prod.body.structuredQuery.select.fields.map(x=>x.fieldPath),
  ['companyId','name','active','sortOrder']);
 assert.equal(rec.body.structuredQuery.where.compositeFilter.filters.length,2);
 assert.deepEqual(rec.body.structuredQuery.startAt,{
  before:false,values:[{referenceValue:DB+'/records/sale0001'}]});
 assert.equal(rec.body.readTime,TIME);
 const serialized=JSON.stringify(rec);
 for(const s of ['totalRevenue','revenuePerUnit','cashback','pricingOptions','unitPrice'])
  assert(!serialized.includes(s),s);
 for(const bad of [
  {table:'recordCorrections',companyId,day,limit:50},
  {table:'revenueGoals',companyId,limit:50},
  {table:'records',companyId:'other/a',day,limit:50},
  {table:'records',companyId,day:'2026-02-31',limit:50},
  {table:'records',companyId,day,cursor:'../price',limit:50},
  {table:'products',companyId,day,limit:201},
  {table:'products',companyId,limit:202}
 ])assert.throws(()=>buildStagedInternalRunQuery(bad),/STAGED_INTERNAL_FIRESTORE_READ_BLOCKED/);
});
test('actual REST-shaped legacy results lose price and CB values BEFORE old-count projection',async()=>{
 const before=JSON.stringify(record());
 const {reader,audit}=makeReader();
 const result=await reader(options);
 assert.equal(result.complete,true);
 assert.equal(result.readTime,TIME);
 assert.equal(result.records.length,1);
 assert.equal(result.records[0].results.nuro__cb_1.count,2);
 assert.equal(result.records[0].results.nuro__cb_1.productId,'nuro');
 assert.equal(result.products[0].name,'NURO光');
 const text=JSON.stringify(result);
 for(const s of ['50000','10000','cashback','revenuePerUnit','customerPhone',
  'private-phone','pricingOptions','totalRevenue'])assert(!text.includes(s),s);
 assert.equal(JSON.stringify(record()),before);
 assert.equal(audit.length,2);
 assert.equal(audit[1].body.readTime,TIME);
});
test('empty day is a verified empty response; missing readTime and split snapshots stop',async()=>{
 const r=makeReader({records:[{readTime:TIME}]});
 assert.deepEqual((await r.reader(options)).records,[]);
 for(const bad of [
  {products:[]},
  {products:[{...product(),readTime:'2026-11-05T02:31:00Z'}],
   records:[record()]},
  {products:[product()],records:[{...record(),readTime:'2026-11-05T02:31:00Z'}]},
  {products:[product('a'),product('a')]},
  {products:[product('a'),product('b','other')]},
  {products:Array.from({length:201},(_,i)=>product('p'+i))},
  {records:[record('sale0002'),record('sale0001')]},
  {records:[record('sale0001','other')]},
  {records:[{...record(),document:{...record().document,
   name:DB+'/records/../../products/secret'}}]}
 ]){
  await assert.rejects(makeReader(bad).reader(options),
   /STAGED_INTERNAL_FIRESTORE_READ_BLOCKED/);
 }
});
test('pinning a readTime on the second page covers both catalog and records',async()=>{
 const {reader,audit}=makeReader();
 const page=await reader({...options,cursor:'sale0000',snapshotTime:TIME});
 assert.equal(page.records.length,1);
 assert.equal(audit.length,2);
 assert.equal(audit[0].body.readTime,TIME);
 assert.equal(audit[1].body.readTime,TIME);
 const stale=makeReader({products:[{...product(),readTime:'2026-11-05T02:31:00Z'}]});
 await assert.rejects(stale.reader({...options,snapshotTime:TIME}),
  /STAGED_INTERNAL_FIRESTORE_READ_BLOCKED/);
});
test('the privileged Firebase transport rejects finance field selection and OR-filter bypasses',()=>{
 const good=buildStagedInternalRunQuery({
  table:'records',companyId,day,cursor:'sale0001',snapshotTime:TIME,limit:50});
 const catalog=buildStagedInternalRunQuery({
  table:'products',companyId,snapshotTime:TIME,limit:201});
 assert.equal(assertStagedInternalTransportQuery(good),good);
 assert.equal(assertStagedInternalTransportQuery(catalog),catalog);
 const changes=[
  q=>q.body.structuredQuery.select.fields.push({fieldPath:'totalRevenue'}),
  q=>q.body.structuredQuery.select.fields.push({fieldPath:'revenuePerUnit'}),
  q=>q.body.structuredQuery.where.compositeFilter.op='OR',
  q=>q.body.structuredQuery.where.compositeFilter.filters[0].fieldFilter.value.stringValue='../other',
  q=>q.body.structuredQuery.orderBy[0].direction='DESCENDING',
  q=>q.body.structuredQuery.startAt.before=true,
  q=>q.body.structuredQuery.startAt.values[0].referenceValue=DB+'/products/private',
  q=>q.body.structuredQuery.limit=100,
  q=>q.body.structuredQuery.from[0].collectionId='recordCorrections',
  q=>q.body.readTime='not-a-snapshot'
 ];
 for(const mutate of changes){
  const forged=structuredClone(good);
  mutate(forged);
  assert.throws(()=>assertStagedInternalTransportQuery(forged),
   /STAGED_INTERNAL_FIREBASE_ADAPTER_DENIED/);
 }
 const priceProduct=structuredClone(catalog);
 priceProduct.body.structuredQuery.select.fields.push({fieldPath:'pricingOptions'});
 assert.throws(()=>assertStagedInternalTransportQuery(priceProduct),
  /STAGED_INTERNAL_FIREBASE_ADAPTER_DENIED/);
});
test('backend adapters use Admin Auth/ACL documents only, fixed service REST and no writes',async()=>{
 const audit={auth:[],docs:[],queries:[]};
 const docs=new Map([
  ['users/owner',{uid:'owner',companyId,companyRole:'owner',active:true}],
  ['companies/direct',{ownerUid:'owner',companyKind:'internal',active:true}],
  ['companies/direct/members/owner',{uid:'owner',companyId,companyRole:'owner',active:true}]
 ]);
 const adapter=createStagedInternalFirebaseAdapters({
  auth:{getUser:async uid=>{audit.auth.push(uid);return {uid}}},
  db:{doc:path=>({get:async()=>{audit.docs.push(path);return {
   exists:docs.has(path),data:()=>docs.get(path)};}})},
  getAccessToken:async()=> 's'.repeat(70),
  fetchFirestore:async (url,init)=>{
   audit.queries.push({url,init});
   const table=JSON.parse(init.body).structuredQuery.from[0].collectionId;
   return {ok:true,json:async()=>table==='products'?[product()]:[record()]};
  }
 });
 assert.deepEqual(await adapter.loadAuthUser('owner'),{uid:'owner'});
 assert.deepEqual(await adapter.readDocument('users/owner'),docs.get('users/owner'));
 assert.equal(await adapter.readDocument('partnerWorkspaceContexts/owner'),null);
 assert.equal((await adapter.loadCountPage(options)).records.length,1);
 assert.equal(audit.queries.length,2);
 assert(audit.queries.every(x=>x.url===FIRESTORE_URL&&x.init.method==='POST'));
 assert.equal(audit.queries[1].init.headers.Authorization,'Bearer '+'s'.repeat(70));
 const returned=JSON.stringify(audit.queries.map(x=>JSON.parse(x.init.body)));
 assert(!returned.includes('totalRevenue'));
 await assert.rejects(adapter.readDocument('records/private'),/STAGED_INTERNAL_FIREBASE_ADAPTER_DENIED/);
 await assert.rejects(adapter.readDocument('companies/direct/members/owner/other'),/STAGED_INTERNAL_FIREBASE_ADAPTER_DENIED/);
 assert.equal(audit.docs.length,2);
});
test('disabled gateway avoids Firebase clients and raw collection reads',async()=>{
 const handler=createStagedInternalFirebaseCountGateway();
 const response=await handler(new Request('https://nico-factory.web.app/v1/internal-counts?day='+day));
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'service_disabled'});
});
test('signed Firebase token can traverse Admin ACL + REST reader without exposing finance',async()=>{
 const key=generateKeyPairSync('rsa',{modulusLength:2048});
 const publicKey={...key.publicKey.export({format:'jwk'}),
  kid:'test',use:'sig',alg:'RS256'};
 const now=Math.floor(Date.parse('2026-11-05T02:45:00Z')/1000);
 const signed=h=>{
  const a=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
  const b=Buffer.from(JSON.stringify({aud:'sales-management-cc116',
   iss:'https://securetoken.google.com/sales-management-cc116',sub:'owner',
   email_verified:true,iat:now-100,auth_time:now-200,exp:now+1000})).toString('base64url');
  return a+'.'+b+'.'+sign('RSA-SHA256',Buffer.from(a+'.'+b),key.privateKey).toString('base64url');
 };
 const bearer=signed();
 const docs=new Map([
  ['users/owner',{uid:'owner',companyId,companyRole:'owner',active:true}],
  ['companies/direct',{ownerUid:'owner',companyKind:'internal',active:true}],
  ['companies/direct/members/owner',{uid:'owner',companyId,companyRole:'owner',active:true}]
 ]);
 const audit={serverReads:[],queries:[]};
 const server=createStagedInternalFirebaseCountGateway({
  enabled:true,
  auth:{getUser:async uid=>({uid,disabled:false,emailVerified:true,
   tokensValidAfterTime:'2025-01-01T00:00:00Z'})},
  db:{doc:path=>({get:async()=>{
   audit.serverReads.push(path);
   return {exists:docs.has(path),data:()=>docs.get(path)};
  }})},
  getAccessToken:async()=> 's'.repeat(70),
  fetchFirestore:async (url,init)=>{
   audit.queries.push(JSON.parse(init.body));
   const table=JSON.parse(init.body).structuredQuery.from[0].collectionId;
   return {ok:true,json:async()=>table==='products'?[product()]:[record()]};
  },
  fetchKeys:async()=>new Response(JSON.stringify({keys:[publicKey]}),{
   status:200,headers:{'Cache-Control':'max-age=90'}
  }),
  subtle:webcrypto.subtle,nowSeconds:()=>now
 });
 const req=()=>new Request('https://nico-factory.web.app/v1/internal-counts?day='+day,{
  headers:{Origin:'https://nico-factory.web.app',Authorization:'Bearer '+bearer}
 });
 const res=await server(req());
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.records[0].totalCount,2);
 assert.equal(body.lines[0].count,2);
 assert.equal(body.products[0].name,'NURO光');
 for(const s of ['50000','10000','totalRevenue','cashback','revenuePerUnit','unitPrice'])
  assert(!JSON.stringify(body).includes(s),s);
 assert.equal(audit.queries.length,2);
 // The exact same now-signed user loses access immediately after
 // secondary partner context appears in authoritative Firestore.
 docs.set('partnerWorkspaceContexts/owner',{active:false});
 const blocked=await server(req());
 assert.equal(blocked.status,403);
 assert.equal(audit.queries.length,2);
 assert.deepEqual(await blocked.json(),{error:'request_blocked'});
});
test('new modules are absent from live deployed Function/Hosting/Rules entries',()=>{
 for(const file of ['../firebase.json','../functions-partner-workspace/index.js',
  '../.github/workflows/firebase-production-deploy.yml']){
  const content=readFileSync(new URL(file,import.meta.url),'utf8');
  for(const name of ['staged-internal-firebase-adapters','staged-internal-firestore-reader'])
   assert(!content.includes(name),file);
 }
});
