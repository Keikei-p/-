"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {projectCombinedMonth}=require("../functions-partner-workspace/combined-saved-month-ranking.cjs");
const {KEYS}=require("../functions-partner-workspace/service.cjs");
const zero=()=>Object.fromEntries(KEYS.map(x=>[x,0]));
const row=n=>({...zero(),NURO:n});
const person=(key,name,n)=>({key:key.repeat(64),name,totalCount:n,counts:row(n)});
const direct=(n=4)=>({totalCount:n,otherCount:0,counts:row(n),
 people:[person("a","佐藤",n)],teams:[],peopleVerified:true,recordsVerified:1});
const partner=(id,companyName,score,staffId="b")=>({
 id,name:companyName,data:{
  scope:"partner_saved_month_counts_only",month:"2026-10",complete:false,
  totalCount:score,counts:row(score),verifiedEntryRows:1,
  people:[person(staffId,"田中",score)]
 }
});
const call=(patch={})=>projectCombinedMonth({
 month:"2026-10",hubId:"hub",keys:KEYS,direct:direct(),
 partners:[partner("partner1","協力店A",4)],
 ...patch
});
test("joint individual and product standings tie fairly and sum saved amounts",()=>{
 const result=call();
 assert.equal(result.grandTotal,8);
 assert.equal(result.directTotal,4);
 assert.equal(result.partnerTotal,4);
 assert.equal(result.people.length,2);
 assert.deepEqual(result.people.map(p=>p.rank),[1,1]);
 assert.equal(result.products.find(p=>p.name==="NURO").totalCount,8);
 assert.equal(result.provisional,true);
 assert.equal(result.complete,false);
 assert.equal(result.productionDocumentWrites,0);
 assert.doesNotMatch(JSON.stringify(result),/revenue|unitPrice|cashback|email|12345|@/i);
 assert.equal(result.people.every(p=>/^[a-f0-9]{64}$/.test(p.key)),true);
});
test("unreported partner is marked unreported, not treated as verified zero competitor",()=>{
 const untouched=partner("missing","協力店B",0);untouched.data.people=[];untouched.data.verifiedEntryRows=0;
 const result=call({partners:[untouched]});
 assert.equal(result.partnerCount,1);
 assert.equal(result.companies[0].reported,false);
 assert.equal(result.people.length,1);
 assert.equal(result.provisional,true);
});
test("direct other verified original products remain explicit; not mapped to false nine category",()=>{
 const d=direct(5);
 d.otherCount=1;d.counts=row(4);
 d.people[0].totalCount=5; // Five verified counts; four known NURO.
 const result=call({direct:d});
 assert.equal(result.grandTotal,9);
 assert.equal(result.products.some(p=>p.name==="その他（直営）"&&p.totalCount===1),true);
 assert.equal(result.products.reduce((n,x)=>n+x.totalCount,0),9);
});
test("refuse partial direct identities, damaged counts or duplicate partner companies",()=>{
 const p=partner("partner1","協力店A",4);
 const invalid=[
  {direct:{...direct(),peopleVerified:false}},
  {direct:{...direct(),people:[]}},
  {direct:{...direct(),otherCount:99}},
  {partners:[p,p]},
  {partners:[{...p,id:"hub"}]},
  {partners:[{...p,data:{...p.data,totalCount:5}}]},
  {partners:[{...p,name:"売上100万円"}]},
  {partners:[{...p,data:{...p.data,people:[{...p.data.people[0],totalCount:99}]}}]},
  {partners:[{...p,data:{...p.data,complete:true}}]}
 ];
 for(const patch of invalid)
  assert.throws(()=>call(patch),/COMBINED_MONTH_UNVERIFIED/);
});
test("all sources and source objects remain untouched",()=>{
 const d=direct(),p=partner("partner1","協力店A",4);
 const before=JSON.stringify({d,p});
 call({direct:d,partners:[p]});
 assert.equal(JSON.stringify({d,p}),before);
});


test("months with NO saved rows have no fabricated 0-count product standings",()=>{
 const emptyDirect={...direct(0),recordsVerified:0,people:[],counts:row(0)};
 const missing=partner("missing","協力店B",0);
 missing.data.people=[];missing.data.verifiedEntryRows=0;
 const r=call({direct:emptyDirect,partners:[missing]});
 assert.equal(r.hasSavedRows,false);
 assert.deepEqual(r.people,[]);
 assert.deepEqual(r.products,[]);
 assert.equal(r.complete,false);
 assert.equal(r.companies[0].reported,false);
 const reported={...missing,data:{...missing.data,verifiedEntryRows:1}};
 const savedZero=call({direct:emptyDirect,partners:[reported]});
 assert.equal(savedZero.hasSavedRows,true);
 assert.equal(savedZero.products.length,9);
 assert.equal(savedZero.products.every(x=>x.totalCount===0),true);
});
