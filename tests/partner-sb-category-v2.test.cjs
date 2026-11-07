"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {LEGACY,LIGHT,AIR,UNCLASSIFIED,PARTS,
 breakdown,nextBreakdown,aggregateBreakdown}=require("../functions-partner-workspace/sb-category-v2.cjs");
const split=(light,air,unknown=0)=>({[LIGHT]:light,[AIR]:air,[UNCLASSIFIED]:unknown});
test("old combined SB counts remain unknown, NOT guessed as hikari or Air",()=>{
 assert.equal(LEGACY,"SB光・AIR");
 assert.deepEqual(PARTS,[LIGHT,AIR,UNCLASSIFIED]);
 assert.deepEqual(breakdown(5,undefined),split(0,0,5));
 assert.deepEqual(breakdown(5,null),split(0,0,5));
 assert.equal(Object.values(breakdown(5)).reduce((a,b)=>a+b,0),5);
});
test("new records explicitly split SB hikari/Air without duplicating counts",()=>{
 const result=breakdown(5,split(3,2));
 assert.deepEqual(result,split(3,2));
 assert.equal(result[LIGHT]+result[AIR]+result[UNCLASSIFIED],5);
 assert.equal(result[LEGACY],undefined);
 assert.deepEqual(nextBreakdown({previousLegacy:0,nextLegacy:5,
  requestedRaw:split(3,2)}),result);
});
test("manual reclassification of an old 5-count entry changes label, not total",()=>{
 assert.deepEqual(breakdown(5,null),split(0,0,5));
 const corrected=nextBreakdown({previousLegacy:5,previousRaw:undefined,
  nextLegacy:5,requestedRaw:split(2,3)});
 assert.deepEqual(corrected,split(2,3));
 assert.equal(Object.values(corrected).reduce((a,b)=>a+b,0),5);
});
test("older tab cannot erase or inflate a split entry when editing unrelated products",()=>{
 const prior=split(1,2,2);
 assert.deepEqual(nextBreakdown({previousLegacy:5,previousRaw:prior,
  nextLegacy:5}),prior);
 assert.throws(()=>nextBreakdown({previousLegacy:5,previousRaw:prior,nextLegacy:6}),
  /SB_SPLIT_OLD_CLIENT_MUST_REFRESH/);
 assert.equal(nextBreakdown({previousLegacy:5,nextLegacy:6}),null);
});
test("unknown old reports and newly separated entries aggregate exactly once",()=>{
 const aggregated=aggregateBreakdown({previousAggregate:5,
  priorLegacy:0,nextLegacy:3,nextRaw:split(1,2)});
 assert.deepEqual(aggregated,split(1,2,5));
 assert.equal(Object.values(aggregated).reduce((a,b)=>a+b,0),8);
 const corrected=aggregateBreakdown({previousAggregate:8,previousRaw:aggregated,
  priorLegacy:5,priorRaw:null,nextLegacy:5,nextRaw:split(4,1)});
 assert.deepEqual(corrected,split(5,3,0));
 assert.equal(Object.values(corrected).reduce((a,b)=>a+b,0),8);
});
test("subtract previous edition from summary on correction, with no double counting",()=>{
 const first=split(5,3,0);
 const current=aggregateBreakdown({previousAggregate:8,previousRaw:first,
  priorLegacy:3,priorRaw:split(2,1),nextLegacy:3,nextRaw:split(1,2)});
 assert.deepEqual(current,split(4,4,0));
 assert.equal(Object.values(current).reduce((a,b)=>a+b,0),8);
});
test("legacy client updates keep historical summary in unknown bucket",()=>{
 const current=aggregateBreakdown({previousAggregate:5,
  priorLegacy:5,priorRaw:undefined,
  nextLegacy:6,nextRaw:undefined});
 assert.deepEqual(current,split(0,0,6));
});
test("bad schema cannot silently create or remove count amounts",()=>{
 const invalid=[
  split(3,1),split(3,3),{[LIGHT]:2,[AIR]:2},
  {[LIGHT]:2,[AIR]:2,[UNCLASSIFIED]:1,extra:0},
  {[LIGHT]:-1,[AIR]:3,[UNCLASSIFIED]:3},
  {[LIGHT]:1.5,[AIR]:2,[UNCLASSIFIED]:1.5},
  {[LIGHT]:"3",[AIR]:2,[UNCLASSIFIED]:0},
  [],"5",null
 ];
 for(const x of invalid){
  if(x===null)continue;
  assert.throws(()=>breakdown(5,x),/SB_SPLIT_/);
 }
 assert.throws(()=>breakdown(10000),/SB_SPLIT_LEGACY_INVALID/);
 assert.throws(()=>breakdown(-1),/SB_SPLIT_LEGACY_INVALID/);
 assert.throws(()=>breakdown(0,split(0,1)),/SB_SPLIT_TOTAL_MISMATCH/);
 assert.throws(()=>breakdown(5,{__proto__:null,[LIGHT]:1,[AIR]:1,[UNCLASSIFIED]:3}),
  /SB_SPLIT_SCHEMA_INVALID/);
});
test("corrupt aggregate refuses subtraction rather than rewriting saved history",()=>{
 assert.throws(()=>aggregateBreakdown({previousAggregate:0,priorLegacy:2,
  priorRaw:split(2,0),nextLegacy:0,nextRaw:split(0,0)}),
  /SB_SPLIT_AGGREGATE_UNDERFLOW/);
 assert.throws(()=>aggregateBreakdown({previousAggregate:5,
  previousRaw:split(1,2,0),priorLegacy:0,nextLegacy:0}),
  /SB_SPLIT_TOTAL_MISMATCH/);
});
test("no money fields, financial records, Firestore side-effects or disclosure in helper",()=>{
 const code=readFileSync(require.resolve("../functions-partner-workspace/sb-category-v2.cjs"),"utf8");
 for(const x of ["getFirestore","runTransaction","writeBatch","collection(","totalRevenue",
  "revenuePerUnit","cashback","FieldValue","getAuth","deleteDoc","setDoc"])
  assert.equal(code.includes(x),false,x);
});
