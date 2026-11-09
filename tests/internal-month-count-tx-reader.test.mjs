import test from "node:test";
import assert from "node:assert/strict";
import {buildInternalMonthCountSource,createInternalMonthTransactionReader}
 from "../ranking/internal-month-count-tx-reader.mjs";
import {buildVerifiedCountDashboard}
 from "../ranking/verified-dual-count-dashboards.mjs";
const TIME="2026-11-09T00:00:00.000Z",hub="hub",month="2026-11";
const base=()=>({
 hubCompanyId:hub,month,readTime:TIME,
 company:{ownerUid:"owner",active:true,companyKind:"internal",name:"本社"},
 products:[
  {id:"nuro",value:{companyId:hub,name:"NURO光",active:true,sortOrder:1,
   revenue:25000,cashbackOptions:[5000]}},
  {id:"air",value:{companyId:hub,name:"SoftBank Air",active:true,sortOrder:2,
   unitPrice:25000}}
 ],
 teams:[{id:"teamA",value:{companyId:hub,name:"広島班"}}],
 users:[{id:"uid1",value:{companyId:hub,uid:"uid1",name:"営業担当",
  teamId:"teamA",active:true}}],
 records:[{id:"hub_uid1_2026-11-09",value:{companyId:hub,uid:"uid1",
  date:"2026-11-09",teamId:"teamA",memberNameSnapshot:"営業担当",
  teamNameSnapshot:"広島班",
  results:{nuro:{count:5,unitPrice:25000,revenue:125000,
    cashback:5000},air:{count:2,revenuePerUnit:10000}},
  totalCount:7,totalRevenue:145000,reportStatus:"submitted"}}]
});
const context={serverVerified:true,viewerUid:"owner",viewerCompanyId:hub,
 hubCompanyId:hub,approvedCompanyIds:[hub],role:"hub_owner",
 userActive:true,memberActive:true,companyActive:true,
 reciprocalOwnersApproved:true,completeSnapshotBudgetApproved:true,
 individualNamesApproved:true};
test("one authoritative internal row projects count only with exact SKU split",()=>{
 const original=base(),before=structuredClone(original);
 const source=buildInternalMonthCountSource(original);
 assert.equal(source.kind,"own");
 assert.equal(source.records.length,1);
 assert.deepEqual(source.lines.map(v=>[v.productId,v.count]),[
  ["nuro",5],["air",2]]);
 assert.equal(source.records[0].totalCount,7);
 assert.deepEqual(original,before,"projection must never alter source record");
 const json=JSON.stringify(source);
 for(const value of ["cashback","unitPrice","totalRevenue","revenue", "125000","145000"])
  assert(!json.includes(value),value+" must not be included");
 const view=buildVerifiedCountDashboard({
  context,hubCompanyId:hub,approvedCompanyIds:[hub],
  sources:[source],productGroups:[
   {companyId:hub,productId:"nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:hub,productId:"air",groupId:"air",groupName:"SoftBank Air"}
  ],period:{kind:"day",day:"2026-11-09",asOf:"2026-11-09"}
 });
 assert.deepEqual(view.summary,{own:7,partner:0,total:7,unidentified:0});
 assert.deepEqual(view.productRanking.map(x=>[x.id,x.count]),
  [["nuro",5],["air",2]]);
});
test("record count corrections are replacements, not second historical additions",()=>{
 const x=base();
 const first=buildInternalMonthCountSource(x);
 x.records[0].value.results.nuro.count=6;
 x.records[0].value.totalCount=8;
 const corrected=buildInternalMonthCountSource(x);
 assert.equal(first.records[0].totalCount,7);
 assert.equal(corrected.records[0].totalCount,8);
 assert.equal(corrected.lines.find(x=>x.productId==="nuro").count,6);
 assert.equal(x.records.length,1);
});
test("duplicate uid/date, inconsistent total, unknown SKU and impossible date fail closed",()=>{
 for(const alter of [
  x=>x.records.push({id:"other",value:{...x.records[0].value}}),
  x=>x.records[0].value.totalCount=99,
  x=>x.records[0].value.results.other={count:1},
  x=>x.records[0].value.date="2026-11-31",
  x=>x.records[0].value.results.nuro.count=-1,
  x=>x.records[0].value.results.nuro.count="5",
  x=>x.records[0].value.results.air={count:1.5}
 ]){
  const x=base();alter(x);
  assert.throws(()=>buildInternalMonthCountSource(x),
   /INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 }
});
test("retired historical teams remain without reassigning or erasing the saved team",()=>{
 const x=base();x.teams=[];
 const source=buildInternalMonthCountSource(x);
 assert.equal(source.records[0].teamId,"teamA");
 assert.equal(source.teams.find(t=>t.id==="teamA").name,"広島班");
});
test("legacy positive record can project but ambiguous old zero record cannot",()=>{
 const x=base();delete x.records[0].value.reportStatus;
 assert.equal(buildInternalMonthCountSource(x).records[0].reportStatus,"submitted");
 x.records[0].value.results={};x.records[0].value.totalCount=0;
 assert.throws(()=>buildInternalMonthCountSource(x),
  /INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 x.records[0].value.reportStatus="no_result";
 assert.equal(buildInternalMonthCountSource(x).records[0].totalCount,0);
});
test("financial-looking product or company label always rejects",()=>{
 for(const update of [
  x=>x.company.name="売上3万円",
  x=>x.products[0].value.name="NURO単価25000円",
  x=>x.users[0].value.name="CB5000"
 ]){
  const x=base();update(x);
  assert.throws(()=>buildInternalMonthCountSource(x),
   /INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 }
});
function fakeTxFixture({differentTime=false,oversize=false}={}){
 const x=base(),seen=[];
 const query=(name,state={})=>({
  name,...state,
  where(field,operator,value){return query(name,{...this,conditions:[
   ...(this.conditions||[]),{field,operator,value}]})},
  limit(n){return query(name,{...this,limitCount:n})},
  doc(id){return {name,path:name+"/"+id}}
 });
 const db={collection:query};
 const timestamp=n=>({seconds:n,nanoseconds:0,toDate:()=>
  new Date(n*1000)});
 const docSnap=(value,id)=>({id,exists:true,data:()=>structuredClone(value),
  readTime:timestamp(1794182400)});
 const qSnap=(items)=>({docs:items.map(item=>docSnap(item.value,item.id)),
  readTime:timestamp(differentTime?1794182401:1794182400)});
 const byName={records:x.records,products:x.products,teams:x.teams,users:x.users};
 if(oversize)byName.records=Array.from({length:2001},(_,i)=>({
  id:"record_"+i,value:{...x.records[0].value,uid:"uid"+i}
 }));
 const tx={async get(ref){
  seen.push(ref.name+":"+(ref.path||"")+"|"+(ref.conditions||[]).length);
  if(ref.path==="companies/hub")return docSnap(x.company,"hub");
  return qSnap(byName[ref.name]||[]);
 }};
 return {db,tx,seen};
}
test("trusted transaction reads original root ledgers with no writes",async()=>{
 const f=fakeTxFixture();
 const source=await createInternalMonthTransactionReader({db:f.db})({
  tx:f.tx,hubCompanyId:hub,month,context
 });
 assert.equal(source.lines.length,2);
 assert.equal(source.records.length,1);
 assert.equal(f.seen.length,5);
 assert(f.seen.some(x=>x.startsWith("records:")&&x.endsWith("|3")));
 assert(f.seen.every(x=>!x.includes("revenueGoals")));
});
test("missing server context, mixed readTime and incomplete query reject before publishing",async()=>{
 const f=fakeTxFixture({differentTime:true});
 await assert.rejects(
  createInternalMonthTransactionReader({db:f.db})({
   tx:f.tx,hubCompanyId:hub,month,context
  }),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 const large=fakeTxFixture({oversize:true});
 await assert.rejects(
  createInternalMonthTransactionReader({db:large.db})({
   tx:large.tx,hubCompanyId:hub,month,context
  }),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 const valid=fakeTxFixture();
 await assert.rejects(
  createInternalMonthTransactionReader({db:valid.db})({
   tx:valid.tx,hubCompanyId:hub,month,
   context:{...context,serverVerified:false}
  }),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 assert.equal(valid.seen.length,0);
});
