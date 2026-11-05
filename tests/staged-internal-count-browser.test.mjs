import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStagedInternalCountBrowserReader} from '../security/staged-internal-count-browser.mjs';
import {createInternalCountPage} from '../cloudflare-finance/src/internal-count-page.mjs';
const DAY='2026-11-05',CID='direct',UID='member',TIME='2026-11-05T09:30:00Z';
const token='a'.repeat(64);
const product={companyId:CID,sourceId:'nuro',name:'NURO光',active:true,sortOrder:0};
const makeRecord=i=>({companyId:CID,sourceId:'record'+String(i).padStart(5,'0'),
 uid:UID,date:DAY,teamId:'team1',totalCount:2,reportStatus:'submitted',
 memberNameSnapshot:'担当者',teamNameSnapshot:'第一班',workLocation:'店舗'});
const makeLine=(r,i)=>({companyId:CID,recordId:r.sourceId,
 sourceId:r.sourceId+'__0000',date:DAY,uid:r.uid,teamId:r.teamId,
 productId:product.sourceId,count:2});
function setup({items=[makeRecord(1)],mutate=()=>{},scope={uid:UID,companyId:CID,mode:'internal'}}={}){
 let current={...scope},calls=[],tokens=0;
 const fetchPage=async(url,options)=>{
  calls.push({url,options});
  const u=new URL(url);
  const cursor=u.searchParams.get('cursor')||'';
  const records=items.filter(x=>x.sourceId>cursor).slice(0,50);
  const lines=records.map(makeLine);
  const hasMore=records.length===50&&
   items.some(x=>x.sourceId>records.at(-1).sourceId);
  const correct={day:DAY,companyId:CID,records,lines,
   products:cursor?[]:[product],catalogIncluded:!cursor,
   hasMore,nextCursor:hasMore?records.at(-1).sourceId:null,
   readTime:TIME};
  const changed=mutate(correct,calls.length);
  const body=changed===undefined?correct:changed;
  return {ok:true,status:200,
   headers:{get:()=> 'application/json; charset=utf-8'},
   json:async()=>body};
 };
 const read=createStagedInternalCountBrowserReader({enabled:true,
  getActiveScope:()=>current,getIdToken:async()=>{tokens++;return token;},fetchPage});
 return {read,scope:()=>current,setScope:next=>{current=next;},calls,tokenCount:()=>tokens};
}
const run=x=>x.read({day:DAY});
test('disabled staged reader is inert and does not request a token',async()=>{
 let calls=0;
 const read=createStagedInternalCountBrowserReader({getIdToken:()=>{calls++;}});
 await assert.rejects(read({day:DAY}),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
 assert.equal(calls,0);
});
test('future internal member can read only approved count rows, not owner finance data',async()=>{
 const f=setup(),result=await run(f);
 assert.equal(result.totalRecords,1);
 assert.equal(result.companyId,CID);
 assert.equal(result.records[0].totalCount,2);
 assert.equal(result.lines[0].count,2);
 assert.equal(result.products[0].name,'NURO光');
 assert.equal(f.calls.length,1);
 assert.equal(new URL(f.calls[0].url).searchParams.has('companyId'),false);
 assert.equal(f.calls[0].options.redirect,'error');
 assert.equal(f.calls[0].options.credentials,'omit');
 const payload=JSON.stringify(result);
 for(const key of ['unitPrice','totalRevenue','revenuePerUnit','cashback','pricingOptions'])
  assert(!payload.includes(key),key);
});
test('2,501 saved daily entries are read in 51 pages without duplicate or missing counts',async()=>{
 const f=setup({items:Array.from({length:2501},(_,i)=>makeRecord(i))});
 const result=await run(f);
 assert.equal(result.totalRecords,2501);
 assert.equal(result.records.length,2501);
 assert.equal(result.lines.reduce((n,r)=>n+r.count,0),5002);
 assert.equal(f.calls.length,51);
 assert.equal(f.tokenCount(),1);
 for(let i=1;i<f.calls.length;i++){
  const u=new URL(f.calls[i].url);
  assert.equal(u.searchParams.get('readTime'),TIME);
  assert.equal(u.searchParams.get('cursor'),result.records[i*50-1].sourceId);
 }
 assert(Object.isFrozen(result));
});
test('invalid page, private fields, altered counts and stale snapshot all reject without partial UI',async()=>{
 const mutations=[
  b=>({...b,records:[{...b.records[0],totalRevenue:100000}]}),
  b=>({...b,lines:[{...b.lines[0],unitPrice:50000}]}),
  b=>({...b,records:[{...b.records[0],totalCount:3}]}),
  b=>({...b,lines:[{...b.lines[0],count:3}]}),
  b=>({...b,lines:[{...b.lines[0],uid:'another'}]}),
  b=>({...b,lines:[{...b.lines[0],productId:'missing'}]}),
  b=>({...b,records:[{...b.records[0],companyId:'other'}]}),
  b=>({...b,products:[{...b.products[0],pricingOptions:[10000]}]}),
  b=>({...b,records:[],lines:[],nextCursor:'fakeCursor'}),
  b=>({...b,nextCursor:'unexpected'}),
  b=>({...b,leakedFinance:50000})
 ];
 for(const mutate of mutations){
  const f=setup({mutate});
  await assert.rejects(run(f),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
 }
 const items=Array.from({length:51},(_,i)=>makeRecord(i));
 const f=setup({items,mutate:(b,n)=>n===2?{...b,readTime:'2026-11-05T09:40:00Z'}:b});
 await assert.rejects(run(f),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
});
test('exactly 50 records is a valid completed Worker page without a cursor',async()=>{
 const f=setup({items:Array.from({length:50},(_,i)=>makeRecord(i))});
 const result=await run(f);
 assert.equal(result.totalRecords,50);
 assert.equal(f.calls.length,1);
 assert.equal(result.lines.length,50);
});
test('later Worker pages cannot resend private catalog or change page flags',async()=>{
 const items=Array.from({length:51},(_,i)=>makeRecord(i));
 for(const mutate of [
  (b,n)=>n===2?{...b,products:[product]}:b,
  (b,n)=>n===2?{...b,catalogIncluded:true}:b,
  (b,n)=>n===2?{...b,hasMore:true,nextCursor:'wrong'}:b,
  (b,n)=>n===2?{...b,companyId:'partner'}:b,
  (b,n)=>n===2?{...b,readTime:'2026-11-05T09:40:00Z'}:b,
  (b,n)=>n===2?{...b,products:[{...product,price:50000}]}:b
 ]){
  const f=setup({items,mutate});
  await assert.rejects(run(f),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
  assert.equal(f.calls.length,2);
 }
});
test('actual Worker page projection and staged browser reader agree on paged count-only contract',async()=>{
 const rows=Array.from({length:51},(_,i)=>({
  id:'record'+String(i).padStart(5,'0'),companyId:CID,uid:UID,
  date:DAY,teamId:'team1',memberNameSnapshot:'担当者',
  teamNameSnapshot:'第一班',totalCount:2,totalRevenue:100000,
  results:{NURO_CB_20000:{productId:'nuro',productName:'NURO光',count:2,
   revenuePerUnit:50000,cashback:20000}}
 }));
 const financeProduct={id:'nuro',companyId:CID,name:'NURO光',
  active:true,pricingOptions:[{cashback:20000,revenuePerUnit:50000}]};
 let catalogQueries=0,dayQueries=0;
 const server=createInternalCountPage({
  enabled:true,authenticate:async()=>({uid:UID,emailVerified:true}),
  loadMembership:async()=>({
   uid:UID,companyId:CID,firebaseIdTokenVerified:true,
   emailVerified:true,serverMembershipVerified:true,
   serverVerifiedInternalCompany:true,
   user:{uid:UID,companyId:CID,active:true,companyRole:'member'},
   member:{uid:UID,companyId:CID,active:true,companyRole:'member'},
   company:{active:true,companyKind:'internal'}
  }),
  queryDailyRecords:async({companyId,date,cursor,readTime,pageSize})=>{
   dayQueries++;
   assert.equal(companyId,CID);assert.equal(date,DAY);
   assert.equal(pageSize,50);
   if(cursor)assert.equal(readTime,TIME);
   const rest=rows.filter(x=>x.id>cursor);
   const records=rest.slice(0,50);
   return {records,readTime:TIME,hasMore:rest.length>50,
    nextCursor:rest.length>50?records.at(-1).id:null};
  },
  queryProducts:async()=>{catalogQueries++;return [financeProduct];}
 });
 const scope={uid:UID,companyId:CID,mode:'internal'};
 const reader=createStagedInternalCountBrowserReader({
  enabled:true,getActiveScope:()=>scope,getIdToken:async()=>token,
  fetchPage:async requestUrl=>{
   const u=new URL(requestUrl);
   const payload=await server({bearer:token,
    day:u.searchParams.get('day'),
    cursor:u.searchParams.get('cursor')||'',
    readTime:u.searchParams.get('readTime')||''});
   return {ok:true,status:200,headers:{get:()=> 'application/json'},
    json:async()=>payload};
  }
 });
 const x=await reader({day:DAY});
 assert.equal(x.totalRecords,51);
 assert.equal(x.lines.length,51);
 assert.equal(x.lines.reduce((n,row)=>n+row.count,0),102);
 assert.equal(dayQueries,2);
 assert.equal(catalogQueries,1,'catalog is only returned on first page');
 for(const sensitive of ['totalRevenue','revenuePerUnit','cashback',
    '100000','50000','20000','pricingOptions'])
  assert(!JSON.stringify(x).includes(sensitive),sensitive);
});
test('authenticated context change while reading rejects the whole count result',async()=>{
 for(const patch of [
  {uid:'second',companyId:CID,mode:'internal'},
  {uid:UID,companyId:'foreign',mode:'internal'},
  {uid:UID,companyId:CID,mode:'partner'}
 ]){
  let current={uid:UID,companyId:CID,mode:'internal'};
  const f=createStagedInternalCountBrowserReader({enabled:true,
   getActiveScope:()=>current,getIdToken:async()=>token,
   fetchPage:async()=>{current=patch;return {ok:true,status:200,
    headers:{get:()=> 'application/json'},json:async()=>({})};}
  });
  await assert.rejects(f({day:DAY}),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
 }
});
test('bad date, missing token and aborted request never fetch internal counts',async()=>{
 let fetched=0;
 const base={enabled:true,
  getActiveScope:()=>({uid:UID,companyId:CID,mode:'internal'}),
  getIdToken:async()=>token,fetchPage:async()=>{fetched++;}};
 const read=createStagedInternalCountBrowserReader(base);
 await assert.rejects(read({day:'2026-02-31'}),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
 await assert.rejects(read({day:DAY,signal:{aborted:true}}),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
 const bad=createStagedInternalCountBrowserReader({...base,getIdToken:async()=>''});
 await assert.rejects(bad({day:DAY}),/STAGED_INTERNAL_COUNT_BROWSER_BLOCKED/);
 assert.equal(fetched,0);
});
test('future browser adapter is not loaded by production HTML, Hosting, Functions or Rules',()=>{
 const files=['../index.html','../firebase.json',
  '../functions-partner-workspace/index.js','../firestore.rules'];
 for(const file of files)
  assert(!readFileSync(new URL(file,import.meta.url),'utf8')
   .includes('staged-internal-count-browser'),file);
 const src=readFileSync(new URL('../security/staged-internal-count-browser.mjs',import.meta.url),'utf8');
 assert(!/setDoc\(|deleteDoc\(|updateDoc\(|runTransaction\(|firebase\s+deploy/.test(src));
});
