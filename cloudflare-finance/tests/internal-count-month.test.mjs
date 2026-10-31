import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fetchVerifiedInternalCountMonth} from "../client/internal-count-month.mjs";

const origin="https://nico-factory.web.app";
const gateway="https://sales-finance-gateway.jyhokei0124.workers.dev/";
const companyId="directCompany";
const user={getIdToken:async()=>("a".repeat(30))};
const product={companyId,sourceId:"nuro",name:"NURO",active:true,sortOrder:1};
const readTime="2026-02-01T00:00:00Z";
function row(day,i=0){
 const sourceId=day.replaceAll("-","")+"_"+String(i).padStart(4,"0");
 return {companyId,sourceId,uid:"member",date:day,teamId:"t1",
  totalCount:1,reportStatus:"submitted",memberNameSnapshot:"社員",
  teamNameSnapshot:"1班",workLocation:"会場"};
}
function line(r){
 return {companyId,sourceId:r.sourceId+"__0000",recordId:r.sourceId,
  date:r.date,uid:r.uid,teamId:r.teamId,productId:"nuro",count:1};
}
function page(day,items=[]){
 return {companyId,day,readTime,records:items,
  lines:items.map(line),products:[product],catalogIncluded:true,
  hasMore:false,nextCursor:null};
}
function setup(mapper=(day)=>page(day,[row(day)])){
 const calls=[];
 const fetcher=async(url)=>{
   const parsed=new URL(url),day=parsed.searchParams.get("day");
   calls.push({day,cursor:parsed.searchParams.get("cursor")});
   const output=mapper(day,parsed,calls.length);
   if(output instanceof Error)throw output;
   return {ok:true,status:200,json:async()=>output};
 };
 return {fetcher,calls};
}
const load=(fetcher,values={})=>fetchVerifiedInternalCountMonth({
 user,origin,gatewayUrl:gateway,month:"2026-02",
 enabled:true,fetcher,...values
});
test("all 28 days are required, with exact totals, no money, no truncation",async()=>{
 const f=setup();
 const res=await load(f.fetcher);
 assert.equal(res.daysVerified,28);
 assert.equal(res.totalCount,28);
 assert.equal(res.records.length,28);
 assert.equal(res.lines.length,28);
 assert.equal(res.totalPages,28);
 assert.equal(res.snapshotScope,"per_day");
 assert.equal(res.complete,true);
 assert.equal(Object.keys(res.dailyReadTimes).length,28);
 assert.equal(f.calls.length,28);
 assert.equal(f.calls[0].day,"2026-02-01");
 assert.equal(f.calls.at(-1).day,"2026-02-28");
 assert.equal(JSON.stringify(res).includes("totalRevenue"),false);
});
test("leap year and months of 31 days are exact, including allowed zero days",async()=>{
 const f=setup(day=>page(day,day.endsWith("-15")?[]:[row(day)]));
 const leap=await load(f.fetcher,{month:"2028-02"});
 assert.equal(leap.daysVerified,29);
 assert.equal(leap.totalCount,28);
 const mar=await load(f.fetcher,{month:"2026-03"});
 assert.equal(mar.daysVerified,31);
 assert.equal(mar.totalCount,30);
});
test("disabled, invalid month, and page cap reject before auth or network",async()=>{
 let hits=0;
 const badUser={getIdToken:async()=>{hits++;return "a".repeat(30)}};
 const fetcher=async()=>{hits++;throw Error("bad_network")};
 const options={user:badUser,origin,gatewayUrl:gateway,fetcher};
 await assert.rejects(fetchVerifiedInternalCountMonth({...options,month:"2026-02"}),/cutover_disabled/);
 for(const m of ["2026-00","2026-13","2026-2","2101-01","1999-12","garbage"])
   await assert.rejects(fetchVerifiedInternalCountMonth({...options,month:m,enabled:true}),/invalid_month/);
 await assert.rejects(fetchVerifiedInternalCountMonth({...options,month:"2026-02",enabled:true,maxPagesPerDay:0}),/page_limit/);
 assert.equal(hits,0);
});
test("a missing middle day is an error, never a partial month or zero",async()=>{
 const f=setup(day=>day==="2026-02-12" ? new Error("fetch_unavailable") : page(day,[row(day)]));
 await assert.rejects(load(f.fetcher),/fetch_unavailable/);
 assert.equal(f.calls.length,12);
});
test("cross-company response and catalog mutation abort entire month",async()=>{
 for(const attack of [
  day=>day==="2026-02-03"?{...page(day,[row(day)]),companyId:"other"}:page(day,[row(day)]),
  day=>day==="2026-02-03"?{...page(day,[row(day)]),
   products:[{...product,name:"NURO changed"}]}:page(day,[row(day)])
 ]){
   const f=setup(attack);
   await assert.rejects(load(f.fetcher));
   assert.equal(f.calls.length,3);
 }
});
test("any monetary field, wrong total, or lost line fails instead of returning partial results",async()=>{
 for(const mod of [
  p=>({...p,records:[{...p.records[0],unitPrice:9000}]}),
  p=>({...p,records:[{...p.records[0],totalCount:2}]}),
  p=>({...p,lines:[]})
 ]){
  const f=setup(day=>day==="2026-02-05"?mod(page(day,[row(day)])):page(day,[row(day)]));
  await assert.rejects(load(f.fetcher));
  assert.equal(f.calls.length,5);
 }
});
test("2,051 records in one day are never cut at 2,000 and no 31-day gaps",async()=>{
 const all=Array.from({length:2051},(_,i)=>row("2026-02-01",i));
 let pageCalls=0;
 const fetcher=async(url)=>{
  const u=new URL(url),day=u.searchParams.get("day");
  if(day!=="2026-02-01")
   return {ok:true,status:200,json:async()=>page(day,[])};
  pageCalls++;
  const cursor=u.searchParams.get("cursor");
  const from=cursor===null?0:Number(cursor.split("_").at(-1))+1;
  const chunk=all.slice(from,from+50),hasMore=from+50<all.length;
  return {ok:true,status:200,json:async()=>({
   ...page(day,chunk),products:cursor===null?[product]:[],
   catalogIncluded:cursor===null,hasMore,
   nextCursor:hasMore?chunk.at(-1).sourceId:null
  })};
 };
 const result=await load(fetcher);
 assert.equal(result.daysVerified,28);
 assert.equal(result.totalCount,2051);
 assert.equal(result.records.length,2051);
 assert.equal(result.lines.length,2051);
 assert.equal(pageCalls,42);
 assert.equal(result.totalPages,69);
});
test("monthly reader is offline-only: no direct Firestore, mutation, billing or deployment",()=>{
 const source=readFileSync(new URL("../client/internal-count-month.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\b(?:getFirestore|getDocs|onSnapshot|setDoc|updateDoc|deleteDoc|runTransaction|firebase\s+deploy|wrangler\s+deploy)\s*\(/);
 assert.match(source,/fetchVerifiedInternalCountDay/);
 assert.match(source,/enabled=false/);
});
