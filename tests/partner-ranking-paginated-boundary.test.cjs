"use strict";
// Synthetic pagination and provisional-ranking contracts; no live project access.
const test=require("node:test"),assert=require("node:assert/strict");
const {readBoundedRankingRelations,MAX_RANKING_COMPANIES,PAGE_SIZE}=
 require("../functions-partner-workspace/bounded-ranking-relations.cjs");
const {projectCombinedMonth}=require("../functions-partner-workspace/combined-saved-month-ranking.cjs");
const {KEYS}=require("../functions-partner-workspace/service.cjs");
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
function fixture(count,mutatePage=docs=>docs){
 const records=Array.from({length:count},(_,i)=>{
  const id="partner_"+String(i+1).padStart(4,"0");
  return {id,detail:{partnerCompanyId:id,hubCompanyId:"hub",active:true,
   countSharingApproved:true,revenue:990000,unitPrice:54321}};
 });
 const queries=[];
 class Query{
  constructor(cursor=""){this.cursor=cursor;}
  where(field,op,value){assert.equal(field,"hubCompanyId");assert.equal(op,"==");
   assert.equal(value,"hub");return this;}
  orderBy(field){assert.equal(field,"__name__");return this;}
  startAfter(cursor){return new Query(cursor);}
  limit(n){assert.equal(n,26);return {get:async()=>{
   queries.push({cursor:this.cursor,limit:n});
   const offset=this.cursor?records.findIndex(r=>r.id===this.cursor)+1:0;
   if(offset<0)throw Error("bad_cursor");
   let docs=records.slice(offset,offset+n).map(r=>({
    id:r.id,data:()=>({...r.detail})
   }));
   docs=mutatePage(docs,queries.length);
   return {docs,size:docs.length};
  }};}
 }
 return {db:{collection:name=>{assert.equal(name,"partnerRelations");return new Query();}},queries};
}
test("zero, 20, 21, 124 and 125 companies use complete bounded pages",async()=>{
 for(const count of [0,20,21,25,26,124,125]){
  const {db,queries}=fixture(count);
  const docs=await readBoundedRankingRelations(db,"hub");
  assert.equal(docs.length,count);
  assert.equal(new Set(docs.map(x=>x.id)).size,count);
  assert.deepEqual(docs.map(x=>x.id),Array.from({length:count},(_,i)=>
   "partner_"+String(i+1).padStart(4,"0")));
  assert(queries.every(q=>q.limit===26));
  assert.equal(queries.length,Math.max(1,Math.ceil(count/PAGE_SIZE)));
 }
 assert.equal(MAX_RANKING_COMPANIES,125);
});
test("126th company is never silently omitted or counted as a complete rank",async()=>{
 for(const count of [126,200]){
  const {db,queries}=fixture(count);
  await assert.rejects(readBoundedRankingRelations(db,"hub"),/RANKING_RELATIONS_UNVERIFIED/);
  assert.equal(queries.length,5);
 }
});
test("mixed-hub, duplicate or misordered relation fails closed",async()=>{
 const tamper=[
  docs=>docs.map((d,i)=>i?d:{id:d.id,data:()=>({...d.data(),hubCompanyId:"other"})}),
  docs=>docs.map((d,i)=>i===1?{id:d.id,data:()=>({...d.data(),partnerCompanyId:"wrong"})}:d),
  docs=>docs.length>2?[docs[0],docs[0],...docs.slice(2)]:docs,
  docs=>docs.slice().reverse(),
  docs=>docs.slice(0,27).concat([docs[0]])
 ];
 for(const change of tamper){
  const {db}=fixture(30,change);
  await assert.rejects(readBoundedRankingRelations(db,"hub"),/RANKING_RELATIONS_UNVERIFIED/);
 }
});
test("125 companies rank all saved staff counts with no Quick ledger or finance output",()=>{
 const make=(n)=>({
  id:"partner_"+String(n).padStart(4,"0"),name:"協力店"+n,
  data:{scope:"partner_saved_month_counts_only",month:"2026-11",
   complete:false,totalCount:1,verifiedEntryRows:1,
   counts:{...zero(),NURO:1},
   people:[{key:"a".repeat(64),name:"担当者",totalCount:1,counts:{...zero(),NURO:1}}]}
 });
 const params={month:"2026-11",hubId:"hub",keys:KEYS,
  direct:{totalCount:0,otherCount:0,recordsVerified:0,
   people:[],teams:[],counts:zero(),peopleVerified:true},
  partners:Array.from({length:125},(_,i)=>make(i+1))};
 const output=projectCombinedMonth(params);
 assert.equal(output.partnerCount,125);
 assert.equal(output.partnerTotal,125);
 assert.equal(output.people.length,125);
 assert.equal(output.companies.length,125);
 assert.equal(output.products.find(x=>x.name==="NURO").totalCount,125);
 assert.equal(output.provisional,true);
 assert.equal(output.productionDocumentWrites,0);
 assert.doesNotMatch(JSON.stringify(output),/revenue|unitPrice|cashback|990000|54321|@/i);
 assert.deepEqual(params.partners[124].data.counts,{...zero(),NURO:1});
 assert.throws(()=>projectCombinedMonth({...params,partners:[...params.partners,make(126)]}),
  /COMBINED_MONTH_UNVERIFIED/);
});
