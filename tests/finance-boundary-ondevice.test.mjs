import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../finance-boundary-check.html',import.meta.url),'utf8');
const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(match,'diagnostic module is in new standalone HTML only');
const browser=match[1].replace(/^import \{[^\n]+\} from "[^"]+";\s*$/gm,'');
function load(probeFetch){
 const elements=new Map();
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,textContent:'',className:''
  });
  return elements.get(id);
 };
 const box={console:{log:()=>{throw Error('no console logs allowed')}},
  document:{getElementById:el},location:{origin:'https://nico-factory.web.app'},
  URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  initializeApp:()=>({}),getAuth:()=>({currentUser:null}),
  getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{}}),
  onAuthStateChanged:(_a,cb)=>cb(null),
  fetch:probeFetch};
 runInNewContext(browser+'\nthis.probes={readCompany,checkCollection,request};',box);
 return {probes:box.probes,elements};
}
const response=(status,body)=>({
 status,json:async()=>body
});
const base='projects/sales-management-cc116/databases/(default)/documents/';
test('diagnostic page never writes, exports a token, or reads unmasked finance values',()=>{
 for(const forbidden of [
  'setDoc(', 'updateDoc(', 'deleteDoc(', 'writeBatch(',
  'submitPartnerWorkspaceCounts','localStorage','sessionStorage',
  'fetch("https://','console.log(', 'navigator.sendBeacon(',
  'revenuePerUnit', 'totalRevenue', 'cashbackOptions'
 ])assert.equal(html.includes(forbidden),false,forbidden);
 assert.match(html,/mask\.fieldPaths/);
 assert.match(html,/fieldPath:"companyId"/);
 assert.match(html,/getIdToken\(true\)/);
 assert.match(html,/https:\/\/firestore\.googleapis\.com/);
 assert.match(html,/location\.origin!=="https:\/\/nico-factory\.web\.app"/);
 assert.match(html,/getPartnerWorkspace/);
 assert.doesNotMatch(html,/\b(?:eval|Function)\(/);
});
test('list + GET success uses only companyId projections, with no monetary content in HTTP',async()=>{
 const recorded=[];
 const {probes}=load(async(url,opt)=>{
  recorded.push({url,method:opt.method,auth:opt.headers.Authorization,body:opt.body});
  if(opt.method==='POST')return response(200,[{document:{
   name:base+'products/product-one',fields:{companyId:{stringValue:'owner_co'}}
  }}]);
  return response(200,{name:base+'products/product-one',
    fields:{companyId:{stringValue:'owner_co'}}});
 });
 const result=await probes.checkCollection('test-token','products','owner_co');
 assert.equal(result.listStatus,'allowed');
 assert.equal(result.getStatus,'allowed');
 assert.equal(recorded.length,2);
 assert.equal(recorded[0].method,'POST');
 assert.equal(recorded[1].method,'GET');
 assert.match(recorded[1].url,/mask\.fieldPaths=companyId/);
 assert.deepEqual(JSON.parse(recorded[0].body).structuredQuery.select.fields,
   [{fieldPath:'companyId'}]);
 for(const item of recorded)assert.equal(item.auth,'Bearer test-token');
});
test('a denied query alone can never falsely prove document GET denial',async()=>{
 const {probes}=load(async()=>response(403,{error:{code:403,status:'PERMISSION_DENIED'}}));
 const first=await probes.checkCollection('test-token','products','owner_co');
 assert.equal(first.listStatus,'denied');
 assert.equal(first.getStatus,'untested');
});
test('saved in-memory document ID permits GET+LIST denial recheck without persisting or printing it',async()=>{
 let closed=false,requests=0;
 const {probes}=load(async(url,opt)=>{
  requests++;
  if(closed)return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
  if(opt.method==='POST')return response(200,[{document:{
    name:base+'records/record-old',fields:{companyId:{stringValue:'owner_co'}}
  }}]);
  return response(200,{name:base+'records/record-old',
    fields:{companyId:{stringValue:'owner_co'}}});
 });
 const before=await probes.checkCollection('token','records','owner_co');
 assert.equal(before.getStatus,'allowed');
 closed=true;
 const after=await probes.checkCollection('token','records','owner_co');
 assert.equal(after.listStatus,'denied');
 assert.equal(after.getStatus,'denied');
 assert.equal(requests,4);
});
test('unexpected origins, 401, unrelated 403 and missing source documents fail closed',async()=>{
 const {probes}=load(async(_url,opt)=>{
  if(opt.method==='POST')return response(401,{error:{code:401,status:'UNAUTHENTICATED'}});
  return response(403,{error:{code:403,status:'UNAUTHENTICATED'}});
 });
 const status=await probes.checkCollection('token','products','owner_co');
 assert.equal(status.listStatus,'unknown');
 assert.equal(status.getStatus,'untested');
 await assert.rejects(()=>probes.request('https://evil.example/steal','GET','token'),/SCOPE/);
});
test('signed-in user profile checked with masked fields, never trusting arbitrary client company choice',async()=>{
 const seen=[];
 const {probes}=load(async(url,opt)=>{
  seen.push(url);
  if(url.includes('/users/'))return response(200,{fields:{
   active:{booleanValue:true},companyId:{stringValue:'internal_co'}}});
  if(url.includes('/companies/'))return response(200,{fields:{
   companyKind:{stringValue:'internal'},ownerUid:{stringValue:'owner_u'}}});
  throw Error('unexpected url');
 });
 const owner=await probes.readCompany('token','owner_u');
 assert.equal(owner.company,'internal_co');
 assert.equal(owner.role,'owner');
 assert.equal(seen.length,2);
 assert.ok(seen.every(x=>x.includes('mask.fieldPaths=')));
});
test('before-and-after real-session path survives old-company GET denial without declaring a different UID safe',async()=>{
 const user={uid:'secondary_u1',emailVerified:true,getIdToken:async()=> 'test-id-token'};
 let closed=false,financeRequests=[];
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,textContent:'',className:''
 });return elements.get(id);};
 const requests=async(url,opt)=>{
   const path=new URL(url).pathname;
   if(path.endsWith('/users/secondary_u1'))return response(200,{fields:{
     companyId:{stringValue:'company_internal'},active:{booleanValue:true}}});
   if(path.endsWith('/companies/company_internal')){
     if(closed)return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
     return response(200,{fields:{companyKind:{stringValue:'internal'},
       ownerUid:{stringValue:'owner_u2'}}});
   }
   const kind=opt.method==='POST'?
     JSON.parse(opt.body).structuredQuery.from[0].collectionId:
     path.includes('/products/')?'products':'records';
   financeRequests.push({kind,method:opt.method,url,closed});
   if(closed)return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
   if(opt.method==='POST')return response(200,[{document:{
     name:base+kind+'/'+kind+'-original',
     fields:{companyId:{stringValue:'company_internal'}}
   }}]);
   return response(200,{fields:{companyId:{stringValue:'company_internal'}}});
 };
 const box={console:{log:()=>{throw Error('no console logs')}},
   document:{getElementById:el},location:{origin:'https://nico-factory.web.app'},
   URL,Intl,Date,Map,RegExp,JSON,Error,Number,
   initializeApp:()=>({}),getAuth:()=>({currentUser:user}),
   getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{}}),
   onAuthStateChanged:(_a,cb)=>cb(user),
   fetch:requests};
 runInNewContext(browser,box);
 await el('run').onclick();
 assert.match(el('identity').textContent,/自社所属/);
 assert.match(el('products').textContent,/金額原票へのアクセス許可/);
 assert.match(el('records').textContent,/金額原票へのアクセス許可/);
 assert.equal(financeRequests.length,4);
 closed=true;
 await el('run').onclick();
 assert.match(el('identity').textContent,/切替前に検証済み/);
 assert.match(el('products').textContent,/LIST・GETともに拒否/);
 assert.match(el('records').textContent,/LIST・GETともに拒否/);
 assert.equal(financeRequests.length,8);
 assert.equal(financeRequests.filter(x=>x.closed&&x.method==='GET').length,2);
 for(const item of financeRequests)assert.ok(!item.url.includes('totalRevenue'));
});
test('fresh post-cutover partner without a previous GET must not assert complete denial',async()=>{
 const seen=[];
 const {probes}=load(async(url,opt)=>{
   seen.push({url,method:opt.method});
   if(url.includes('/users/'))return response(200,{fields:{
     active:{booleanValue:true},companyId:{stringValue:'company_a'}}});
   return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
 });
 const account=await probes.readCompany('token','random-user');
 assert.equal(account.role,'unknown');
 const results=await probes.checkCollection('token','products',account.company);
 assert.equal(results.listStatus,'denied');
 assert.equal(results.getStatus,'untested');
 assert.equal(seen.filter(x=>x.method==='GET').length,2);
});
test('inactive or missing self user cannot borrow an old successful company proof',async()=>{
 const {probes}=load(async(url)=>{
  if(url.includes('/users/'))return response(200,{fields:{
   active:{booleanValue:false},companyId:{stringValue:'company_a'}}});
  throw Error('Should never fetch a company for inactive user');
 });
 assert.equal(await probes.readCompany('token','user_a'),null);
});
