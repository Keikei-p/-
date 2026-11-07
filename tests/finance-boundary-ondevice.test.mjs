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