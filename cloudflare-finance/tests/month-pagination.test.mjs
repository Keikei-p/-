import test from "node:test";
import assert from "node:assert/strict";
import {validQueryMonth,collectFirestoreMonthPages} from "../src/index.js";

const PROJECT="sales-management-cc116";
const PREFIX="projects/"+PROJECT+"/databases/(default)/documents/records/";
const SNAPSHOT="2026-10-29T00:00:00.000000Z";
const COMPANY="coA";
function doc(n,date="2026-10-10",company=COMPANY){
 const id="row"+String(n).padStart(8,"0");
 return {name:PREFIX+id,fields:{
  companyId:{stringValue:company},
  date:{stringValue:date},
  uid:{stringValue:"u"+n},
  totalCount:{integerValue:"1"},
  totalRevenue:{integerValue:"10000"},
  results:{mapValue:{fields:{nuro:{mapValue:{fields:{
    productId:{stringValue:"nuro"},
    count:{integerValue:"1"},
    revenuePerUnit:{integerValue:"10000"}
  }}}}}
 }}};
}
function fakePageReader(rows,{time=SNAPSHOT}={}){
 let calls=0;const history=[];
 const ordered=[...rows].sort((a,b)=>{
  const aDate=a.fields.date.stringValue,bDate=b.fields.date.stringValue;
  return aDate.localeCompare(bDate)||a.name.localeCompare(b.name);
 });
 const read=async ({cursor,pageSize,start,end,readTime})=>{
  calls++;history.push({cursor,pageSize,start,end,readTime});
  const matching=ordered.filter(x=>x.fields.date.stringValue>=start &&
   x.fields.date.stringValue<end);
  let index=0;
  if(cursor){
   index=matching.findIndex(x=>x.fields.date.stringValue>cursor.date ||
      (x.fields.date.stringValue===cursor.date && x.name>cursor.name));
   if(index===-1)index=matching.length;
  }
  const slice=matching.slice(index,index+pageSize);
  return slice.length?slice.map(document=>({document,readTime:time})):
   [{readTime:time,done:true}];
 };
 return {read,history,get calls(){return calls;}};
}
test("month boundaries including December are exact",()=>{
 assert.deepEqual(validQueryMonth("2026-10"),{start:"2026-10-01",end:"2026-11-01"});
 assert.deepEqual(validQueryMonth("2026-12"),{start:"2026-12-01",end:"2027-01-01"});
 for(const invalid of ["2026-00","2026-13","2026-1","9999-01",null,123]){
  assert.throws(()=>validQueryMonth(invalid),/invalid_month/);
 }
});
test("25,001 records in one month return once, with exact full financial totals",async()=>{
 const rows=Array.from({length:25001},(_,i)=>doc(i,
  i%2===0?"2026-10-01":"2026-10-29"));
 const reader=fakePageReader(rows);
 const output=await collectFirestoreMonthPages(reader.read,{
  companyId:COMPANY,month:"2026-10",pageSize:500
 });
 assert.equal(output.length,25001);
 assert.equal(new Set(output.map(x=>x.id)).size,25001);
 assert.equal(output.reduce((sum,x)=>sum+x.totalCount,0),25001);
 assert.equal(output.reduce((sum,x)=>sum+x.totalRevenue,0),250010000);
 assert.equal(reader.calls,51);
 assert.equal(reader.history[0].readTime,"");
 assert(reader.history.slice(1).every(x=>x.readTime===SNAPSHOT));
 assert(reader.history.every(x=>x.start==="2026-10-01"&&x.end==="2026-11-01"));
});
test("1,999, 2,000, 2,001 and empty months never silently lose rows",async()=>{
 for(const size of [0,1999,2000,2001]){
  const reader=fakePageReader(Array.from({length:size},(_,i)=>doc(i)));
  const output=await collectFirestoreMonthPages(reader.read,{
   companyId:COMPANY,month:"2026-10",pageSize:250
  });
  assert.equal(output.length,size);
 }
});
test("only selected month is returned, not records in adjacent years or months",async()=>{
 const rows=[doc(1,"2025-10-10"),doc(2,"2026-09-30"),
  doc(3,"2026-10-01"),doc(4,"2026-10-31"),
  doc(5,"2026-11-01"),doc(6,"2027-10-10")];
 const reader=fakePageReader(rows);
 const output=await collectFirestoreMonthPages(reader.read,{companyId:COMPANY,month:"2026-10",pageSize:2});
 assert.deepEqual(output.map(x=>x.id),["row00000003","row00000004"]);
});
test("cross-company response, out-of-month response, duplicate and reordering are refused",async()=>{
 const base={companyId:COMPANY,month:"2026-10",pageSize:2};
 for(const document of [doc(1,"2026-10-10","other"),
                        doc(2,"2026-11-02")]){
  await assert.rejects(
   collectFirestoreMonthPages(async()=>[{document,readTime:SNAPSHOT}],base),
   /month_company_date_or_document_mismatch/);
 }
 const page=[doc(2,"2026-10-03"),doc(1,"2026-10-01")];
 await assert.rejects(collectFirestoreMonthPages(async()=>page.map(document=>({
  document,readTime:SNAPSHOT})),base),/month_invalid_cursor/);
 const repeating=doc(1);
 await assert.rejects(collectFirestoreMonthPages(async()=>[
   {document:repeating,readTime:SNAPSHOT},
   {document:repeating,readTime:SNAPSHOT}],base),/month_company_date_or_document_mismatch/);
});
test("mixed snapshots, incomplete pagination and missing read time fail closed",async()=>{
 const base={companyId:COMPANY,month:"2026-10",pageSize:2};
 const docs=[doc(0),doc(1),doc(2)];
 let calls=0;
 await assert.rejects(collectFirestoreMonthPages(async()=>[
  {document:docs[calls++],readTime:calls===1?SNAPSHOT:"2026-10-29T00:01:00.000000Z"}
 ],{...base,pageSize:1}),/month_snapshot_changed/);
 await assert.rejects(collectFirestoreMonthPages(async()=>[
  {document:doc(0)}],base),/month_snapshot_unavailable/);
 await assert.rejects(collectFirestoreMonthPages(
  fakePageReader(docs).read,{...base,maxPages:1}),
  /month_resource_limit/);
});
