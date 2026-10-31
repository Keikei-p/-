import test from "node:test";
import assert from "node:assert/strict";
import {fetchVerifiedInternalCountDay} from "../client/internal-count-day.mjs";
const gateway="https://sales-finance-gateway.jyhokei0124.workers.dev/";
const origin="https://nico-factory.web.app",day="2026-10-31";
const companyId="directCompany",readTime="2026-10-31T06:45:01.000000Z";
const user={getIdToken:async(force)=>{assert.equal(force,true);return "verified-token";}};
const mk=(i)=>{
 const id="record_"+String(i).padStart(4,"0");
 return {companyId,sourceId:id,uid:"member",date:day,teamId:"team1",
  totalCount:1,reportStatus:"submitted",memberNameSnapshot:"社員",
  teamNameSnapshot:"第一班",workLocation:"会場"};
};
const line=(r,i)=>({companyId,recordId:r.sourceId,
 sourceId:r.sourceId+"__0000",date:day,uid:r.uid,teamId:r.teamId,
 productId:"nuro",count:1});
const product={companyId,sourceId:"nuro",name:"NURO",
 active:true,sortOrder:1};
const rowset=(n,start=0)=>Array.from({length:n},(_,i)=>mk(i+start));
const first=rowset(50),last=rowset(1,50);
const pages=[
 {companyId,day,readTime,records:first,lines:first.map(line),
  products:[product],catalogIncluded:true,hasMore:true,nextCursor:first.at(-1).sourceId},
 {companyId,day,readTime,records:last,lines:last.map(line),
  products:[],catalogIncluded:false,hasMore:false,nextCursor:null}
];
function fake(source=pages){
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  return {ok:true,status:200,json:async()=>source[calls.length-1]};
 };
 return {fetcher,calls};
}
async function read(fetcher,extra={}){
 return fetchVerifiedInternalCountDay({user,origin,gatewayUrl:gateway,day,
  enabled:true,fetcher,...extra});
}
test("fetches all 51 day records over 2 snapshot-pinned pages with no lost counts",async()=>{
 const f=fake();
 const result=await read(f.fetcher);
 assert.equal(result.records.length,51);
 assert.equal(result.lines.length,51);
 assert.equal(result.totalCount,51);
 assert.equal(result.pages,2);
 assert.deepEqual(result.products,[product]);
 assert.equal(result.readTime,readTime);
 assert.equal(f.calls.length,2);
 const second=new URL(f.calls[1].url);
 assert.equal(second.searchParams.get("cursor"),first.at(-1).sourceId);
 assert.equal(second.searchParams.get("readTime"),readTime);
 assert.equal(f.calls[0].opts.headers.Authorization,"Bearer verified-token");
 assert.equal(f.calls[1].opts.headers.Authorization,"Bearer verified-token");
 assert.equal(f.calls[0].opts.method,"GET");
 assert.equal(f.calls[0].opts.cache,"no-store");
});
test("disabled contract never invokes Firebase Auth or network",async()=>{
 let called=false;
 await assert.rejects(fetchVerifiedInternalCountDay({
  user:{getIdToken:async()=>{called=true;return "token";}},
  origin,gatewayUrl:gateway,day,fetcher:async()=>{called=true;return {}}
 }),/cutover_disabled/);
 assert.equal(called,false);
});
test("foreign origin and injected gateway are rejected before any network call",async()=>{
 let called=false;
 for(const bad of [
  {origin:"https://fake-nico.example"},
  {gatewayUrl:"http://sales-finance-gateway.jyhokei0124.workers.dev/"},
  {gatewayUrl:"https://evil.example/"},
  {gatewayUrl:gateway+"v1/financial-view"},
  {gatewayUrl:gateway+"?redirect=evil"},
  {gatewayUrl:"https://user:pass@sales-finance-gateway.jyhokei0124.workers.dev/"}
 ]){
  await assert.rejects(read(async()=>{called=true;return {}},bad),
   /untrusted_origin/);
 }
 assert.equal(called,false);
});
test("money-bearing raw fields, wrong company, missing lines and duplicate ID prevent partial display",async()=>{
 for(const attack of [
  {...pages[0],records:[{...first[0],totalRevenue:20000},...first.slice(1)]},
  {...pages[0],products:[{...product,revenuePerUnit:50000}]},
  {...pages[0],records:[{...first[0],companyId:"partner"},...first.slice(1)]},
  {...pages[0],records:[first[0],first[0],...first.slice(2)]},
  {...pages[0],lines:pages[0].lines.slice(1)},
  {...pages[0],lines:[{...pages[0].lines[0],count:2},...pages[0].lines.slice(1)]},
  {...pages[0],catalogIncluded:false},
  {...pages[0],readTime:""},
  {...pages[0],nextCursor:""},
 ]){
  let fetches=0;
  await assert.rejects(read(async()=>{fetches++;return {ok:true,status:200,json:async()=>attack}}));
  assert.equal(fetches,1);
 }
});
test("second page invalidation aborts whole day; never falls back to old raw Firestore",async()=>{
 for(const attack of [
  {...pages[1],readTime:"2026-10-31T06:45:02Z"},
  {...pages[1],products:[product]},
  {...pages[1],records:[first[0]],lines:[line(first[0])]},
  {...pages[1],hasMore:true,nextCursor:last[0].sourceId,
   records:[...last,...rowset(49,51)],lines:[...last,...rowset(49,51)].map(line)}
 ]){
  const f=fake([pages[0],attack]);
  await assert.rejects(read(f.fetcher));
  assert.equal(f.calls.length,2);
 }
});
test("reporting over upper bound cannot silently truncate, errors cannot become zero",async()=>{
 const f=fake();
 await assert.rejects(read(f.fetcher,{maxPages:1}),/page_limit_exceeded/);
 const fail=async()=>({ok:false,status:503});
 await assert.rejects(read(fail),/page_http_503/);
 await assert.rejects(read(async()=>({ok:true,status:200,json:async()=>null})),/page_contract/);
});
test("source contract contains no Firestore SDK direct reads or writes",async()=>{
 const {readFileSync}=await import("node:fs");
 const src=readFileSync(new URL("../client/internal-count-day.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/\b(?:getFirestore|getDocs|onSnapshot|setDoc|updateDoc|deleteDoc|runTransaction)\s*\(/);
 assert.doesNotMatch(src,/firebase deploy|wrangler deploy/);
});
