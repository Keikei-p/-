"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {
  START,validateBreakdown,planSplitWrite,aggregateForRanking,productSwitchDisplay
}=require("../functions-partner-workspace/light-air-split.cjs");
const invalid=fn=>assert.throws(fn,/SB_LIGHT_AIR_SPLIT_CONTRACT_INVALID/);

test("cutover 2026-11-18 Tokyo date; no retroactive separate entry",()=>{
 assert.equal(START,"2026-11-18");
 invalid(()=>planSplitWrite({date:"2026-11-17",priorCount:5,combinedCount:5,
   requestedBreakdown:{"SB光":2,"SB AIR":3,"旧未分類":0},splitEnabled:true}));
 invalid(()=>validateBreakdown({"SB光":2,"SB AIR":3,"旧未分類":0},5,"2026-11-17"));
});
test("new separated 光3 + AIR2 are ONE legacy combined ranking item 5",()=>{
 const sb={"SB光":3,"SB AIR":2,"旧未分類":0};
 const p=planSplitWrite({date:START,splitEnabled:true,priorCount:0,
   combinedCount:5,requestedBreakdown:sb});
 assert.equal(p.useSplit,true);
 assert.deepEqual(p.breakdown,sb);
 const ranking=aggregateForRanking({date:START,combinedCount:5,breakdown:p.breakdown});
 assert.equal(ranking.name,"SB光・AIR");
 assert.equal(ranking.totalCount,5);
 assert.deepEqual(ranking.inputBreakdown,sb);
});
test("legacy combined 5 stays unclassified; 3 light + 2 air means rank 10 exactly once",()=>{
 const p=planSplitWrite({date:START,splitEnabled:true,priorCount:5,
  combinedCount:10,requestedBreakdown:{"SB光":3,"SB AIR":2,"旧未分類":5}});
 assert.deepEqual(p.breakdown,{"SB光":3,"SB AIR":2,"旧未分類":5});
 assert.equal(aggregateForRanking({date:START,combinedCount:10,breakdown:p.breakdown).totalCount,10);
 invalid(()=>planSplitWrite({date:START,splitEnabled:true,priorCount:5,
  combinedCount:5,requestedBreakdown:{"SB光":3,"SB AIR":2,"旧未分類":0}}));
});
test("separated counters can change separately without overwriting legacy",()=>{
 let old={"SB光":3,"SB AIR":2,"旧未分類":5};
 const p=planSplitWrite({date:START,splitEnabled:true,priorCount:10,
   priorBreakdown:old,combinedCount:12,
   requestedBreakdown:{"SB光":5,"SB AIR":2,"旧未分類":5}});
 assert.equal(p.breakdown["SB光"],5);
 assert.equal(p.breakdown["SB AIR"],2);
 assert.equal(p.breakdown["旧未分類"],5);
 assert.equal(old["SB光"],3);
});
test("OFF preserves existing counts and blocks changed split/unknown",()=>{
 const previous={"SB光":2,"SB AIR":1,"旧未分類":4};
 const p=planSplitWrite({date:START,splitEnabled:true,priorCount:7,
    priorBreakdown:previous,combinedCount:7,categoryEnabled:false});
 assert.deepEqual(p.breakdown,previous);
 invalid(()=>planSplitWrite({date:START,splitEnabled:true,priorCount:7,
    priorBreakdown:previous,combinedCount:8,categoryEnabled:false}));
 invalid(()=>planSplitWrite({date:START,splitEnabled:true,priorCount:7,
    priorBreakdown:previous,combinedCount:7,categoryEnabled:false,
    requestedBreakdown:previous}));
});
test("strict: combined mismatches and invented split are rejected",()=>{
 invalid(()=>validateBreakdown({"SB光":5,"SB AIR":5,"旧未分類":0},9,START));
 invalid(()=>validateBreakdown({"SB光":5,"SB AIR":5},10,START));
 invalid(()=>validateBreakdown({"SB光":5,"SB AIR":5,"旧未分類":0,price:5000},10,START));
 invalid(()=>validateBreakdown({"SB光":-1,"SB AIR":1,"旧未分類":0},0,START));
 invalid(()=>validateBreakdown({"SB光":1.5,"SB AIR":1.5,"旧未分類":0},3,START));
 invalid(()=>validateBreakdown({"SB光":10000,"SB AIR":0,"旧未分類":0},10000,START));
 invalid(()=>planSplitWrite({date:START,splitEnabled:true,priorCount:0,combinedCount:1}));
});
test("flag OFF keeps existing legacy save path unchanged",()=>{
 const p=planSplitWrite({date:START,splitEnabled:false,priorCount:5,combinedCount:7});
 assert.equal(p.useSplit,false);
 assert.equal(p.breakdown["旧未分類"],5);
 invalid(()=>planSplitWrite({date:START,splitEnabled:false,priorCount:5,
   combinedCount:7,requestedBreakdown:{"SB光":2,"SB AIR":0,"旧未分類":5}}));
});
test("unknown history cannot be changed by backdating or editing metadata",()=>{
 invalid(()=>validateBreakdown({"SB光":1,"SB AIR":0,"旧未分類":3},4,"2026-02-29"));
 invalid(()=>validateBreakdown(null,3,START));
});
test("old products stay visible only in archived/previous group, no physical deletes",()=>{
 const products=[
  {id:"old",name:"旧商材",active:false},
  {id:"new",name:"新商材",active:true}
 ];
 const v=productSwitchDisplay(products);
 assert.deepEqual(v.active.map(p=>p.id),["new"]);
 assert.deepEqual(v.history.map(p=>p.id),["old"]);
 assert.equal(products.length,2);
 invalid(()=>productSwitchDisplay([...products,products[0]]));
});
