import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {makeCountDayFirestoreReader} from "../src/internal-count-rest-reader.mjs";
const path="projects/sales-management-cc116/databases/(default)/documents/records/";
const day="2026-10-31",stamp="2026-10-31T06:00:00.000000Z";
function document(id,cid="direct",when=day){
 return {name:path+id,fields:{companyId:{stringValue:cid},date:{stringValue:when},
   totalRevenue:{integerValue:"999999"}},updateTime:stamp};
}
test("OFF-by-default deployed Worker route cannot touch credentials or Firestore",async()=>{
 const req=new Request("https://sales-finance-gateway.test/v1/internal-counts?day="+day,{
  headers:{origin:"https://nico-factory.web.app",authorization:"Bearer "+"a".repeat(30)}});
 const response=await worker.fetch(req,{FIREBASE_PROJECT_ID:"sales-management-cc116",
  FINANCE_GATEWAY_ENABLED:"disabled",INTERNAL_COUNT_PAGE_ENABLED:"disabled"});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:"count_cutover_not_approved"});
});
test("REST count page cannot be steered to other collections/companies and uses bounded 51-row query",async()=>{
 const seen=[],many=Array.from({length:51},(_,i)=>({
  document:document("record_"+String(i).padStart(3,"0")),readTime:stamp
 }));
 const adapter=makeCountDayFirestoreReader({
  getServiceToken:async()=>"server-only-token",
  decodeDocument:raw=>({id:raw.name.slice(path.length),
    companyId:raw.fields.companyId.stringValue,date:raw.fields.date.stringValue}),
  fetcher:async (url,opts)=>{
   seen.push({url,opts});
   return {ok:true,json:async()=>many};
  }
 });
 const page=await adapter({companyId:"direct",date:day,pageSize:50});
 assert.equal(page.records.length,50);
 assert.equal(page.hasMore,true);
 assert.equal(page.nextCursor,"record_049");
 assert.equal(page.readTime,stamp);
 const q=JSON.parse(seen[0].opts.body);
 assert.equal(q.structuredQuery.from[0].collectionId,"records");
 assert.equal(q.structuredQuery.limit,51);
 assert.deepEqual(q.structuredQuery.where.compositeFilter.filters.map(x=>x.fieldFilter.value.stringValue),["direct",day]);
 assert.deepEqual(q.structuredQuery.orderBy.map(x=>x.field.fieldPath),["date","__name__"]);
 assert(seen[0].url.endsWith("/documents:runQuery"));
 assert.equal(seen[0].opts.headers.Authorization,"Bearer server-only-token");
 await assert.rejects(adapter({companyId:"../partner",date:day}),/snapshot_unavailable/);
 await assert.rejects(adapter({companyId:"direct",date:day,pageSize:500}),/snapshot_unavailable/);
});
test("REST page validates exact snapshot, document scope, ordering and cursor rather than returning partial counts",async()=>{
 for(const bad of [
  [{document:document("a","other"),readTime:stamp}],
  [{document:document("a","direct","2026-10-30"),readTime:stamp}],
  [{document:document("b"),readTime:stamp},{document:document("a"),readTime:stamp}],
  [{document:document("a"),readTime:stamp},{document:document("b"),readTime:"2026-10-31T06:01:00Z"}],
  [{document:document("a"),readTime:stamp,skippedResults:1}],
  [{document:{...document("a"),name:"projects/other/databases/(default)/documents/records/a"},readTime:stamp}],
  [{document:document("a")}],
 ]){
  const api=makeCountDayFirestoreReader({
   getServiceToken:async()=>"token",
   decodeDocument:d=>({id:d.name.slice(path.length),
    companyId:d.fields.companyId.stringValue,date:d.fields.date.stringValue}),
   fetcher:async()=>({ok:true,json:async()=>bad})
  });
  await assert.rejects(api({companyId:"direct",date:day}),/snapshot_unavailable/);
 }
});
test("pagination requires consistent source document name and read timestamp",async()=>{
 let query=null;
 const reader=makeCountDayFirestoreReader({
  getServiceToken:async()=>"token",
  decodeDocument:d=>({id:d.name.slice(path.length),
   companyId:d.fields.companyId.stringValue,date:d.fields.date.stringValue}),
  fetcher:async (_url,opts)=>{
   query=JSON.parse(opts.body);
   return {ok:true,json:async()=>[{document:document("record_051"),readTime:stamp}]};
  }
 });
 const res=await reader({companyId:"direct",date:day,cursor:"record_050",
  readTime:stamp,pageSize:50});
 assert.equal(res.records.length,1);
 assert.equal(res.hasMore,false);
 assert.equal(res.nextCursor,null);
 assert.equal(query.readTime,stamp);
 assert.deepEqual(query.structuredQuery.startAt.values,[
  {stringValue:day},{referenceValue:path+"record_050"}
 ]);
});
