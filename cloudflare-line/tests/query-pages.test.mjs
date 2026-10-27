import test from "node:test";
import assert from "node:assert/strict";
import {collectLineQueryPages} from "../src/query-pages.js";
const project="sales-management-cc116",col="records",companyId="coA";
const root="projects/"+project+"/databases/(default)/documents/"+col+"/";
const time="2026-10-28T05:00:00.000000Z";
const make=(i,cid=companyId)=>({
 name:root+"d"+String(i).padStart(7,"0"),
 fields:{companyId:{stringValue:cid},count:{integerValue:"1"},
  results:{mapValue:{fields:{a:{mapValue:{fields:{count:{integerValue:"1"},revenuePerUnit:{integerValue:"10000"}}}}}}}}
});
test("LINE report queries 2,501 historical records across six pages with one snapshot",async()=>{
 const docs=Array.from({length:2501},(_,i)=>make(i));const requests=[];
 const found=await collectLineQueryPages(async({cursor,readTime,pageSize})=>{
  requests.push({cursor,readTime});
  const start=cursor?Number(cursor.slice(-7))+1:0;
  const rows=docs.slice(start,start+pageSize);
  return rows.map(document=>({document,readTime:time}));
 },{root,companyId});
 assert.equal(found.length,2501);
 assert.equal(new Set(found.map(x=>x.name)).size,2501);
 assert.equal(found.reduce((sum,x)=>sum+Number(x.fields.count.integerValue),0),2501);
 assert.equal(requests.length,6);
 assert.equal(requests[0].readTime,"");
 assert(requests.slice(1).every(r=>r.readTime===time));
});
test("LINE report query protects against partial page, cursor repetition, and other companies",async()=>{
 await assert.rejects(collectLineQueryPages(async()=>[{document:make(0,"coB"),readTime:time}],
   {root,companyId,pageSize:2}),/cross_company/);
 await assert.rejects(collectLineQueryPages(async()=>[{document:make(0),readTime:time}],
   {root,companyId,pageSize:1,maxPages:3}),/cursor_invalid/);
 await assert.rejects(collectLineQueryPages(async()=>[{document:make(0)}],
   {root,companyId,pageSize:2}),/snapshot_missing/);
 let called=0;
 await assert.rejects(collectLineQueryPages(async({pageSize})=>{
  called++;
  return Array.from({length:pageSize},(_,i)=>({document:make((called-1)*pageSize+i),
    readTime:called===1?time:"2026-10-28T05:05:00.000000Z"}));
 },{root,companyId,pageSize:2}),/snapshot_changed/);
});
test("LINE report will NEVER silently send partial output after resource ceiling",async()=>{
 let called=0;
 await assert.rejects(collectLineQueryPages(async({pageSize})=>{
  const start=called++*pageSize;
  return Array.from({length:pageSize},(_,j)=>({document:make(start+j),readTime:time}));
 },{root,companyId,pageSize:500,maxPages:3}),/safety_limit/);
 assert.equal(called,3);
});
