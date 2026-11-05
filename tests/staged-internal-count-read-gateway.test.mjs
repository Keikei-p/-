import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStagedInternalCountReadGateway} from '../security/staged-internal-count-read-gateway.mjs';

const ORIGIN='https://nico-factory.web.app',TOKEN='x'.repeat(70);
const now='2026-11-05T09:30:00Z';
const day='2026-11-05',cid='demo-direct',uid='owner';
const product={id:'nuro',companyId:cid,name:'NURO光',active:true,
 revenue:20000,pricingOptions:[{cashback:10000,revenuePerUnit:20000}]};
const one=i=>({id:'sale'+String(i).padStart(4,'0'),companyId:cid,uid,
 date:day,teamId:'team1',memberNameSnapshot:'担当者',
 teamNameSnapshot:'1班',workLocation:'店舗',totalCount:2,totalRevenue:40000,
 reportStatus:'submitted',results:{nuro__cb_1:{
  productId:'nuro',productName:'NURO光',count:2,revenuePerUnit:20000,cashback:10000
 }}});
function request(extra='',{token=TOKEN,origin=ORIGIN,method='GET'}={}){
 return new Request(ORIGIN+'/v1/internal-counts?day='+day+extra,{
  method,headers:{Origin:origin,Authorization:'Bearer '+token}
 });
}
function setup({records=[one(1)],products=[product],complete=true,
 snapshotTime=now,mutateDocs=()=>{},mutateAuth=x=>x}={}){
 const docs=new Map([
  ['users/'+uid,{uid,companyId:cid,companyRole:'owner',active:true}],
  ['companies/'+cid,{ownerUid:uid,companyKind:'internal',active:true}],
  ['companies/'+cid+'/members/'+uid,{uid,companyId:cid,companyRole:'owner',active:true}]
 ]);
 mutateDocs(docs);
 const audit={reads:[],queries:[],tokens:0,admin:0};
 const server=createStagedInternalCountReadGateway({
  enabled:true,
  authenticateBearer:async token=>{audit.tokens++;
   if(token!==TOKEN)throw Error('signature invalid');
   return {uid,emailVerified:true,authTime:1760000000};
  },
  loadAuthUser:async name=>{audit.admin++;
   return mutateAuth({uid:name,disabled:false,emailVerified:true,
    tokensValidAfterTime:'2025-01-01T00:00:00Z'});
  },
  readDocument:async path=>{audit.reads.push(path);
   assert(!/^(records|products|recordCorrections|revenueGoals)\//.test(path));
   return docs.get(path)??null;
  },
  loadCountPage:async options=>{
   audit.queries.push(options);
   assert.equal(options.companyId,cid);
   const page=records.filter(r=>r.id>options.cursor).slice(0,options.limit);
   return {complete,readTime:snapshotTime,products,records:page};
  }
 });
 return {server,audit,docs};
}
test('disabled default does not initialize credentials or touch records',async()=>{
 const gateway=createStagedInternalCountReadGateway();
 const response=await gateway(request());
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'service_disabled'});
});
test('enabled route refuses missing server-owned capabilities',()=>{
 assert.throws(()=>createStagedInternalCountReadGateway({enabled:true}),
  /INTERNAL_COUNT_SERVER_ADAPTER_MISSING/);
});
test('internal owner receives exact historical CB counts but no original prices',async()=>{
 const f=setup(),before=JSON.stringify([one(1),product]);
 const res=await f.server(request());
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.records.length,1);
 assert.equal(body.records[0].totalCount,2);
 assert.equal(body.lines[0].productId,'nuro');
 assert.equal(body.lines[0].count,2);
 assert.equal(body.products[0].name,'NURO光');
 assert.equal(body.nextCursor,null);
 assert.equal(body.snapshotTime,now);
 const response=JSON.stringify(body);
 for(const s of ['40000','20000','10000','totalRevenue','revenuePerUnit',
  'cashback','pricingOptions','unitPrice'])assert(!response.includes(s),s);
 assert.equal(JSON.stringify([one(1),product]),before);
 assert.equal(f.audit.queries.length,1);
 assert(f.audit.reads.includes('partnerWorkspaceContexts/owner'));
 assert.equal(f.audit.admin,1);
});
test('secondary old owner, partner markers, inactive and revoked account all fail BEFORE raw query',async()=>{
 for(const opts of [
  {mutateDocs:d=>d.set('partnerWorkspaceContexts/owner',{active:true})},
  {mutateDocs:d=>d.set('partnerWorkspaceContexts/owner',{active:false})},
  {mutateDocs:d=>d.get('users/owner').accessKind='partner'},
  {mutateDocs:d=>d.get('companies/demo-direct').companyKind='partner'},
  {mutateDocs:d=>d.get('companies/demo-direct/members/owner').active=false},
  {mutateAuth:a=>({...a,disabled:true})},
  {mutateAuth:a=>({...a,tokensValidAfterTime:'2026-11-05T00:00:00Z'})}
 ]){
  const f=setup(opts),res=await f.server(request());
  assert.equal(res.status,403);
  assert.equal(f.audit.queries.length,0);
 }
});
test('untrusted origin, token and arbitrary company/collection URL never query Firestore',async()=>{
 const f=setup();
 const bad=[
  request('',{origin:'https://evil.example'}),
  request('',{token:'z'.repeat(70)}),
  request('&companyId=demo-direct'),
  request('&collection=records'),
  request('&limit=500'),
  request('',{method:'POST'}),
  new Request('https://evil.example/v1/internal-counts?day='+day,{
   headers:{Origin:ORIGIN,Authorization:'Bearer '+TOKEN}})
 ];
 for(const q of bad){
  const res=await f.server(q);
  assert.notEqual(res.status,200);
  assert(!JSON.stringify(await res.json()).includes('20000'));
 }
 assert.equal(f.audit.queries.length,0);
});
test('2501 records return stable, nontruncated count pages without money',async()=>{
 const f=setup({records:Array.from({length:2501},(_,i)=>one(i))});
 let cursor='',snapshot='',count=0,seen=new Set(),pages=0;
 do{
  const suffix=cursor?'&cursor='+cursor+'&snapshot='+encodeURIComponent(snapshot):'';
  const result=await f.server(request(suffix));
  assert.equal(result.status,200,'must not return partial result');
  const response=await result.json();
  pages++;
  for(const row of response.records){
   assert(!seen.has(row.sourceId));
   seen.add(row.sourceId);count+=row.totalCount;
  }
  assert(!JSON.stringify(response).includes('totalRevenue'));
  cursor=response.nextCursor??'';
  snapshot=response.snapshotTime;
  assert(pages<55,'must finish');
 }while(cursor);
 assert.equal(count,5002);
 assert.equal(seen.size,2501);
 assert.equal(pages,51);
 assert(f.audit.queries.every(x=>x.limit===50&&x.companyId===cid));
 assert(f.audit.queries.slice(1).every(x=>x.snapshotTime===now));
});
test('mismatched saved count, missing catalog, truncated query and stale snapshot fail closed',async()=>{
 const cases=[
  {records:[{...one(1),totalCount:3}]},
  {products:[]},
  {complete:false},
  {records:[one(2),one(1)]},
  {records:[{...one(1),companyId:'other'}]},
  {records:[{...one(1),date:'2026-10-30'}]}
 ];
 for(const c of cases){
  const f=setup(c),res=await f.server(request());
  assert.equal(res.status,503,JSON.stringify(c));
  assert.deepEqual(await res.json(),{error:'request_blocked'});
 }
 const f=setup();
 const stale=await f.server(request('&cursor=sale0001&snapshot=2026-10-30T09%3A00%3A00Z'));
 assert.equal(stale.status,503);
});
test('staged route is not referenced by firebase deploy, Hosting or live Function export',()=>{
 const root=readFileSync(new URL('../firebase.json',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../functions-partner-workspace/index.js',import.meta.url),'utf8');
 const release=readFileSync(new URL('../.github/workflows/firebase-production-deploy.yml',import.meta.url),'utf8');
 assert(!root.includes('staged-internal-count-read-gateway'));
 assert(!worker.includes('staged-internal-count-read-gateway'));
 assert(!release.includes('staged-internal-count-read-gateway'));
 const src=readFileSync(new URL('../security/staged-internal-count-read-gateway.mjs',import.meta.url),'utf8');
 assert(!/firebase\s+deploy|admin\.initializeApp\(|writeBatch\(|deleteDoc\(|setDoc\(/.test(src));
});
