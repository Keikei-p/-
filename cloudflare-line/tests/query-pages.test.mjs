import test from "node:test";
import assert from "node:assert/strict";
import {collectLineQueryPages,collectLineMonthQueryPages} from "../src/query-pages.js";
import {readFileSync} from "node:fs";
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


const monthStart="2026-10-01",throughDate="2026-10-30";
const makeMonthly=(id,date,cid=companyId)=>({
 ...make(id,cid),
 name:root+"d"+String(id).padStart(7,"0"),
 fields:{...make(id,cid).fields,date:{stringValue:date}}
});
test("month-to-date report pages date then document ID, not global historical IDs",async()=>{
 const docs=[
  makeMonthly(999,"2026-10-01"),makeMonthly(1,"2026-10-02"),
  makeMonthly(15,"2026-10-03"),makeMonthly(2,"2026-10-30")
 ];
 const requests=[];
 const result=await collectLineMonthQueryPages(async({cursor,readTime,pageSize})=>{
  requests.push({cursor,readTime,pageSize});
  const idx=cursor?docs.findIndex(d=>d.name===cursor.documentName)+1:0;
  return docs.slice(idx,idx+pageSize).map(document=>({document,readTime:time}));
 },{root,companyId,monthStart,throughDate,pageSize:2});
 assert.deepEqual(result.map(d=>d.fields.date.stringValue),[
  "2026-10-01","2026-10-02","2026-10-03","2026-10-30"]);
 assert.equal(requests.length,3);
 assert.equal(requests[0].readTime,"");
 assert.deepEqual(requests[1].cursor,{date:"2026-10-02",documentName:docs[1].name});
 assert(requests.slice(1).every(x=>x.readTime===time));
});
test("month-to-date report refuses incomplete, foreign and out-of-range pages",async()=>{
 const good=makeMonthly(1,"2026-10-02");
 const opts={root,companyId,monthStart,throughDate,pageSize:2};
 const one=doc=>[{document:doc,readTime:time}];
 await assert.rejects(collectLineMonthQueryPages(async()=>one(makeMonthly(1,"2026-09-30")),opts),/out_of_scope/);
 await assert.rejects(collectLineMonthQueryPages(async()=>one(makeMonthly(1,"2026-10-31")),opts),/out_of_scope/);
 await assert.rejects(collectLineMonthQueryPages(async()=>one(makeMonthly(1,"2026-10-02","wrong")),opts),/cross_company/);
 await assert.rejects(collectLineMonthQueryPages(async()=>[{document:good}],opts),/snapshot_missing/);
 await assert.rejects(collectLineMonthQueryPages(async()=>[{document:good,readTime:time,skippedResults:1}],opts),/skipped_records/);
 await assert.rejects(collectLineMonthQueryPages(async()=>[
  {document:makeMonthly(2,"2026-10-03"),readTime:time},
  {document:good,readTime:time}
 ],opts),/cursor_invalid/);
 let calls=0;
 await assert.rejects(collectLineMonthQueryPages(async({pageSize})=>{
  calls++;
  return Array.from({length:pageSize},(_,i)=>({
   document:makeMonthly(calls===1?i+1:i+3,"2026-10-02"),
   readTime:calls===1?time:"2026-10-30T06:00:00Z"
  }));
 },{...opts,maxDocuments:5}),/snapshot_changed/);
});
test("month-to-date report never sends a partly capped summary",async()=>{
 const docs=Array.from({length:6},(_,i)=>makeMonthly(i,"2026-10-03"));
 let calls=0;
 await assert.rejects(collectLineMonthQueryPages(async({cursor,pageSize})=>{
  calls++;
  const index=cursor?docs.findIndex(d=>d.name===cursor.documentName)+1:0;
  return docs.slice(index,index+pageSize).map(document=>({document,readTime:time}));
 },{root,companyId,monthStart,throughDate,pageSize:2,maxDocuments:4}),/read_budget_exceeded/);
 assert.equal(calls,3);
});
test("scheduled report is month-scoped instead of reading lifetime records",()=>{
 const code=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 assert.match(code,/queryMonthRecords\(env,company\.id,date\)/);
 assert.doesNotMatch(code,/query\(env,"records",\[strFilter\("companyId",company\.id\)\]\)/);
 assert.match(code,/monthField\("GREATER_THAN_OR_EQUAL",monthStart\)/);
 assert.match(code,/monthField\("LESS_THAN_OR_EQUAL",date\)/);
 assert.match(code,/fieldPath:"date"\},direction:"ASCENDING"/);
 assert.match(code,/referenceValue:cursor\.documentName/);
 assert.match(code,/if\(readTime\)body\.readTime=readTime/);
 assert.match(code,/AUTO_REPORTS_ENABLED!=="OWNER_APPROVED_REPORT_SENDING"/);
});
