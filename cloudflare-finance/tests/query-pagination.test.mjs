import test from "node:test";
import assert from "node:assert/strict";
import {collectFirestoreQueryPages} from "../src/index.js";

const project="sales-management-cc116";
const company="coA",other="coB",col="records",readTime="2026-10-28T08:00:00.000000Z";
const prefix="projects/"+project+"/databases/(default)/documents/"+col+"/";
function document(n,cid=company){
 const id="row"+String(n).padStart(7,"0");
 return {name:prefix+id,updateTime:readTime,fields:{
  companyId:{stringValue:cid},uid:{stringValue:"u"+n},date:{stringValue:"2026-10-01"},
  totalCount:{integerValue:"1"},
  results:{mapValue:{fields:{p:{mapValue:{fields:{
   productId:{stringValue:"NURO"},count:{integerValue:"1"},
   revenuePerUnit:{integerValue:"25000"},cashback:{integerValue:"0"}
  }}}}}}
 }};
}
function readerFor(docs,{time=readTime}={}){
 let calls=0,seen=[];
 const reader=async ({cursor,readTime:requested,pageSize})=>{
  calls++;seen.push({cursor,requested,pageSize});
  const start=cursor?docs.findIndex(d=>d.name===cursor)+1:0;
  if(cursor && start===0)throw Error("invalid test cursor");
  const page=docs.slice(start,start+pageSize);
  return page.length?page.map(document=>({document,readTime:time})):[{readTime:time,done:true}];
 };
 return {reader,history:seen,calls:()=>calls};
}
test("2,501 company records return completely, once, over six seek pages plus stop page",async()=>{
 const docs=Array.from({length:2501},(_,i)=>document(i));
 const r=readerFor(docs);
 const actual=await collectFirestoreQueryPages(r.reader,{collectionId:col,companyId:company,pageSize:500});
 assert.equal(actual.length,2501);
 assert.equal(new Set(actual.map(x=>x.id)).size,2501);
 assert.equal(actual.reduce((a,x)=>a+x.totalCount,0),2501);
 assert.equal(actual.reduce((a,x)=>a+x.results.p.count*x.results.p.revenuePerUnit,0),62525000);
 assert.equal(r.calls(),6);
 assert.equal(r.history[0].requested,"");
 for(const call of r.history.slice(1)){
  assert.equal(call.requested,readTime,"all subsequent requests pinned to first snapshot");
  assert(call.cursor.startsWith(prefix));
 }
 assert.equal(actual[0].uid,"u0");
 assert.equal(actual.at(-1).uid,"u2500");
});
test("Exactly 2,000 and 2,001 rows both load with no invisible drop",async()=>{
 for(const size of [1999,2000,2001]){
  const r=readerFor(Array.from({length:size},(_,i)=>document(i)));
  const actual=await collectFirestoreQueryPages(r.reader,{collectionId:col,companyId:company,pageSize:500});
  assert.equal(actual.length,size);
 }
});
test("Company isolation and duplicate pages fail closed before any leaderboard",async()=>{
 const page=[document(0),document(1,other)];
 await assert.rejects(
   collectFirestoreQueryPages(async()=>page.map(document=>({document,readTime})),
     {collectionId:col,companyId:company,pageSize:10}),/firestore_query_company_mismatch/);
 const repeated=[document(0)];
 await assert.rejects(
   collectFirestoreQueryPages(async()=>[{document:repeated[0],readTime}],
     {collectionId:col,companyId:company,pageSize:1,maxPages:3}),/firestore_query_invalid_cursor/);
});
test("Pages cannot be mixed from different snapshots, even during concurrent edits",async()=>{
 const docs=Array.from({length:4},(_,i)=>document(i));let calls=0;
 await assert.rejects(collectFirestoreQueryPages(async ({pageSize})=>{
  calls++;
  return docs.slice((calls-1)*pageSize,calls*pageSize).map(document=>({
   document,readTime:calls===1?readTime:"2026-10-28T08:00:01.000000Z"
  }));
 },{collectionId:col,companyId:company,pageSize:2}),/firestore_snapshot_changed/);
 assert.equal(calls,2);
});
test("Missing readTime, malformed rows and oversized pages are rejected",async()=>{
 const args={collectionId:col,companyId:company,pageSize:2};
 await assert.rejects(collectFirestoreQueryPages(async()=>[{document:document(0)}],args),/snapshot_unavailable/);
 await assert.rejects(collectFirestoreQueryPages(async()=>({nextPageToken:"x"}),args),/invalid_page/);
 await assert.rejects(collectFirestoreQueryPages(async()=>[0,1,2].map(i=>({document:document(i),readTime})),args),/excess_page/);
 await assert.rejects(collectFirestoreQueryPages(async()=>[{document:{
  ...document(0),name:"projects/"+project+"/databases/(default)/documents/users/u1"
 },readTime}],args),/invalid_cursor/);
});
test("Resource ceiling fails loudly; no partial financial results returned",async()=>{
 let calls=0;
 await assert.rejects(collectFirestoreQueryPages(async ({cursor,pageSize})=>{
  const start=cursor?Number(cursor.slice(-7))+1:0;
  calls++;
  return Array.from({length:pageSize},(_,k)=>({document:document(start+k),readTime}));
 },{collectionId:col,companyId:company,pageSize:500,maxPages:3}),/resource_limit/);
 assert.equal(calls,3);
});
