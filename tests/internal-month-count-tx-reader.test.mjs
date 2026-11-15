import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
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

// Exercise the actual existing form producer, including its CB variant keys.
function currentFormResults(rows){
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8")
  .replace(/\r\n/g,"\n");
 const source=name=>{
  const start=html.indexOf(`function ${name}(`),end=html.indexOf("\n}",start);
  assert(start>=0&&end>start,"existing form producer is present");
  return html.slice(start,end+2);
 };
 const inputs=rows.map(([productId,cashback,count])=>({value:String(count),
  dataset:{productId,cashback:String(cashback),productName:productId,
   revenuePerUnit:"271828"}}));
 const ctx=vm.createContext({productInputList:{querySelectorAll:selector=>{
  assert.equal(selector,'input[data-product-id]');return inputs;
 }}});
 const results=vm.runInContext(source("resultVariantKey")+"\n"+
  source("getCurrentInputResults")+"\ngetCurrentInputResults()",ctx);
 return JSON.parse(JSON.stringify(results));
}
const variantFixture=()=>{
 const x=base();x.records[0].value.results=currentFormResults([
  ["nuro",314159,3],["nuro",731903,2],["air",0,2],["air",5000,0]
 ]);return x;
};
const dashboard=source=>buildVerifiedCountDashboard({
 context,hubCompanyId:hub,approvedCompanyIds:[hub],sources:[source],
 productGroups:[
  {companyId:hub,productId:"nuro",groupId:"nuro",groupName:"NURO光"},
  {companyId:hub,productId:"air",groupId:"air",groupName:"SoftBank Air"}
 ],period:{kind:"day",day:"2026-11-09",asOf:"2026-11-09"}
});

test("actual form CB variants join the real product ID once in product and individual rankings",()=>{
 const original=variantFixture(),before=structuredClone(original);
 assert.equal(Object.keys(original.records[0].value.results).length,3);
 const source=buildInternalMonthCountSource(original),view=dashboard(source);
 assert.deepEqual(source.lines.map(x=>[x.productId,x.count]),[["nuro",5],["air",2]]);
 assert.equal(source.records[0].totalCount,7);
 assert.deepEqual(view.summary,{own:7,partner:0,total:7,unidentified:0});
 assert.equal(view.memberRanking.find(x=>x.id==="hub:uid1").count,7);
 assert.deepEqual(view.productRanking.map(x=>[x.id,x.count]),[["nuro",5],["air",2]]);
 assert.deepEqual(original,before,"reading variants never changes stored counts, CB or sales");
 const json=JSON.stringify({source,view});
 for(const forbidden of ["__cb_","cashback","revenue","unitPrice","314159","731903","271828"])
  assert(!json.includes(forbidden),"private variant metadata cannot leave the reader: "+forbidden);
 assert.deepEqual(source.lines.map(x=>x.sourceId),[
  "hub_uid1_2026-11-09__0","hub_uid1_2026-11-09__1"]);
});

test("a form variant correction replaces the same original record rather than adding its old counts",()=>{
 const x=variantFixture(),first=dashboard(buildInternalMonthCountSource(x));
 x.records[0].value.results=currentFormResults([
  ["nuro",314159,4],["nuro",731903,2],["air",0,2]
 ]);x.records[0].value.totalCount=8;
 const next=dashboard(buildInternalMonthCountSource(x));
 assert.equal(first.productRanking.find(x=>x.id==="nuro").count,5);
 assert.equal(next.productRanking.find(x=>x.id==="nuro").count,6);
 assert.equal(next.memberRanking.find(x=>x.id==="hub:uid1").count,8);
 assert.equal(x.records.length,1);
});

test("noncanonical variant identities, unknown products and ambiguous legacy mixtures remain rejected",()=>{
 for(const [key,value]of [
  ["nuro__cb_0314159",{productId:"nuro",cashback:314159,count:7}],
  ["nuro__cb_3.14159e5",{productId:"nuro",cashback:314159,count:7}],
  ["nuro__cb_314159",{productId:"air",cashback:314159,count:7}],
  ["other__cb_314159",{productId:"nuro",cashback:314159,count:7}],
  ["nuro__cb_314159",{productId:"nuro",cashback:"314159",count:7}],
  ["nuro__cb_314159",{productId:"nuro",count:7}],
  ["nuro__cb_0",{cashback:0,count:7}],
  ["nuro__cb_0",{productId:"nuro",cashback:-0,count:7}],
  ["nuro__cb_-1",{productId:"nuro",cashback:-1,count:7}],
  ["nuro__cb_0.5",{productId:"nuro",cashback:.5,count:7}],
  ["nuro__cb_NaN",{productId:"nuro",cashback:NaN,count:7}],
  ["nuro__cb_Infinity",{productId:"nuro",cashback:Infinity,count:7}],
  ["nuro__cb_9007199254740992",{productId:"nuro",cashback:9007199254740992,count:7}],
  ["unknown__cb_0",{productId:"unknown",cashback:0,count:7}]
 ]){
  const x=base();x.records[0].value.results={[key]:value};
  assert.throws(()=>buildInternalMonthCountSource(x),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 }
 const x=base();x.records[0].value.results={nuro:{count:3},
  nuro__cb_0:{productId:"nuro",cashback:0,count:4}};
 assert.throws(()=>buildInternalMonthCountSource(x),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 // Arrays still have no canonical variant key proving two rows are distinct.
 x.records[0].value.results=[{productId:"nuro",count:3},{productId:"nuro",count:4}];
 assert.throws(()=>buildInternalMonthCountSource(x),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
});

test("variant aggregation refuses overflow and still requires the saved total to match",()=>{
 const overflow=variantFixture();overflow.records[0].value.results=currentFormResults([
  ["nuro",0,Number.MAX_SAFE_INTEGER],["nuro",5000,1]
 ]);overflow.records[0].value.totalCount=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>buildInternalMonthCountSource(overflow),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
 const changed=variantFixture();changed.records[0].value.totalCount=6;
 assert.throws(()=>buildInternalMonthCountSource(changed),/INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED/);
});

test("direct legacy maps, distinct-product arrays and legacy single-product rows stay compatible",()=>{
 for(const results of [
  {nuro:{productId:"nuro",count:5},air:{count:2}},
  [{productId:"nuro",count:5},{productId:"air",count:2}]
 ]){
  const x=base();x.records[0].value.results=results;
  assert.deepEqual(buildInternalMonthCountSource(x).lines.map(v=>[v.productId,v.count]),
   [["nuro",5],["air",2]]);
 }
 const x=base();delete x.records[0].value.results;
 x.records[0].value.productId="nuro";x.records[0].value.count=7;
 assert.equal(buildInternalMonthCountSource(x).lines[0].count,7);
});

test("the deployed ranking package uses the identical variant-aware reader",()=>{
 assert.equal(readFileSync(new URL("../ranking/internal-month-count-tx-reader.mjs",import.meta.url),"utf8"),
  readFileSync(new URL("../functions-ranking-approvals/ranking/internal-month-count-tx-reader.mjs",import.meta.url),"utf8"));
});
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
