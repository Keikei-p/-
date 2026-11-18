import test from "node:test";
import assert from "node:assert/strict";
import {planTsubasaElectricReclassification as plan} from
  "../tools/production/plan-tsubasa-electric-reclassification.mjs";

const companyId="hub_nico";
const products=()=>[
  {id:"tsubasa_old",companyId,name:"つばさ",active:false,revenue:20000},
  {id:"tsubasa_electric",companyId,name:"つばさ電気",active:true,revenue:20000},
  {id:"nuro",companyId,name:"NURO",active:true,revenue:10000}
];
const old=(count=3)=>({productId:"tsubasa_old",productName:"つばさ",count,
  cashback:0,revenuePerUnit:20000});
const target=(count=2)=>({productId:"tsubasa_electric",productName:"つばさ電気",
  count,cashback:0,revenuePerUnit:20000});
const other=(count=4)=>({productId:"nuro",productName:"NURO",
  count,cashback:0,revenuePerUnit:10000});
const record=(id,results,teamId="team1",date="2026-10-15")=>{
  const rows=Object.values(results);
  return {id,companyId,uid:"user_"+id,teamId,date,
    memberNameSnapshot:"変更禁止",results,
    totalCount:rows.reduce((n,v)=>n+v.count,0),
    totalRevenue:rows.reduce((n,v)=>n+v.count*v.revenuePerUnit,0)};
};
const run=records=>plan({companyId,products:products(),records});
const stopped=(fn,why)=>assert.throws(fn,new RegExp("STOP_TSUBASA_RECLASS_"+why));

test("all teams and original dates are preserved; only つばさ rows move",()=>{
  const originals=[
    record("r1",{tsubasa_old__cb_0:old(3),nuro__cb_0:other(4)},"team1","2026-10-15"),
    record("r2",{tsubasa_old__cb_0:old(5)},"team4","2025-04-02"),
    record("r3",{nuro__cb_0:other(7)},"team2","2026-01-01")
  ];
  const source=structuredClone(originals);
  const result=run(originals);
  assert.equal(result.affectedRecords,2);
  assert.equal(result.movedCount,8);
  assert.equal(result.deletes,0);
  assert.equal(result.otherProductChanges,0);
  assert.deepEqual(originals,source);
  assert.deepEqual(result.updates.map(x=>[x.teamId,x.date]),[
    ["team1","2026-10-15"],["team4","2025-04-02"]
  ]);
  for(const update of result.updates) {
    assert.equal(update.nextResults.tsubasa_electric__cb_0.productId,"tsubasa_electric");
    assert.equal(Object.keys(update.nextResults).includes("tsubasa_old__cb_0"),false);
    assert.equal(update.unchangedTotalCount,
      Object.values(update.nextResults).reduce((sum,x)=>sum+x.count,0));
    assert.equal(update.unchangedTotalRevenue,
      Object.values(update.nextResults).reduce((sum,x)=>sum+x.count*x.revenuePerUnit,0));
  }
  assert.deepEqual(result.updates[0].nextResults.nuro__cb_0,source[0].results.nuro__cb_0);
});

test("same day and same plan: merge counts without overwriting target price or unrelated rows",()=>{
  const a=record("r1",{tsubasa_old__cb_0:old(3),
    tsubasa_electric__cb_0:target(7),nuro__cb_0:other(4)});
  const before=structuredClone(a);
  const result=run([a]);
  assert.equal(result.movedCount,3);
  assert.equal(result.mergedLines,1);
  assert.equal(result.updates[0].nextResults.tsubasa_electric__cb_0.count,10);
  assert.deepEqual(result.updates[0].nextResults.nuro__cb_0,before.results.nuro__cb_0);
  assert.deepEqual(a,before);
});

test("records in any other company are excluded even with matching product IDs",()=>{
  const foreign=record("foreign",{tsubasa_old__cb_0:old(900)});
  foreign.companyId="partner_foreign";
  const valid=record("valid",{tsubasa_old__cb_0:old(1)});
  const result=run([foreign,valid]);
  assert.equal(result.affectedRecords,1);
  assert.equal(result.movedCount,1);
  assert.equal(result.updates[0].recordId,"valid");
});

test("an existing unrelated target key is never overwritten",()=>{
  const a=record("r1",{tsubasa_old__cb_0:old(2),
    tsubasa_electric__cb_0:{...other(8),productId:"nuro"}});
  stopped(()=>run([a]),"TARGET_KEY_COLLISION");
});

test("different pricing in target product always stops before any write",()=>{
  const p=products();
  p[1].revenue=25000;
  stopped(()=>plan({companyId,products:p,
    records:[record("r1",{tsubasa_old__cb_0:old(1)})]}),"DISPLAYED_REVENUE_DRIFT");
});

test("collision with different prices cannot silently merge",()=>{
  const a=record("r1",{tsubasa_old__cb_0:old(1),
    tsubasa_electric__cb_0:{...target(2),revenuePerUnit:25000}});
  stopped(()=>run([a]),"COLLISION_DIFFERENT_PRICE_OR_METADATA");
});

test("collision with distinct historical metadata cannot be collapsed",()=>{
  const a=record("r1",{tsubasa_old__cb_0:{...old(1),campaign:"A"},
    tsubasa_electric__cb_0:{...target(2),campaign:"B"}});
  stopped(()=>run([a]),"COLLISION_DIFFERENT_PRICE_OR_METADATA");
});

test("duplicate source product or target product blocks ambiguous IDs",()=>{
  const p=products();
  p.push({...p[0],id:"old_copy"});
  stopped(()=>plan({companyId,products:p,records:[]}),"PRODUCT_IDENTITY_SOURCE");
  p.pop();
  p.push({...p[1],id:"target_copy"});
  stopped(()=>plan({companyId,products:p,records:[]}),"PRODUCT_IDENTITY_TARGET");
});

test("source and target are exactly named, never つばさ・HTB or guessed alias",()=>{
  const p=products();
  p[0].name="つばさ・HTB";
  stopped(()=>plan({companyId,products:p,records:[]}),"PRODUCT_IDENTITY_SOURCE");
  const a=record("r1",{tsubasa_old__cb_0:{...old(3),productId:"unknown"}});
  stopped(()=>run([a]),"UNRESOLVED_HISTORIC_ALIAS");
});

test("old inconsistent totalCount/Revenue is a hard stop, no silent repair",()=>{
  const a=record("r1",{tsubasa_old__cb_0:old(2)});
  a.totalCount=999;
  stopped(()=>run([a]),"EXISTING_TOTAL_DRIFT");
  a.totalCount=2;
  a.totalRevenue=123;
  stopped(()=>run([a]),"EXISTING_TOTAL_DRIFT");
});

test("unvalidated cashback plan must not be re-priced",()=>{
  const p=products();
  p[0].pricingOptions=[{cashback:1000,revenuePerUnit:20000}];
  p[1].pricingOptions=[{cashback:0,revenuePerUnit:20000}];
  const a=record("r1",{tsubasa_old__cb_0:old(2)});
  stopped(()=>plan({companyId,products:p,records:[a]}),"PRICING_MISMATCH");
});

test("empty result never invents counts or deletes other records",()=>{
  const a=record("r1",{nuro__cb_0:other(8)});
  const result=run([a]);
  assert.equal(result.affectedRecords,0);
  assert.equal(result.movedCount,0);
  assert.deepEqual(result.updates,[]);
});

test("other product data and all source identity fields stay identical",()=>{
  const a=record("r1",{tsubasa_old__cb_0:old(2),nuro__cb_0:other(3)});
  a.workLocation="既存の稼働場所";
  a.reportStatus="submitted";
  a.createdByUid="original";
  const snapshot=structuredClone(a);
  const result=run([a]);
  assert.deepEqual(a,snapshot);
  assert.equal(result.updates[0].uid,a.uid);
  assert.equal(result.updates[0].date,a.date);
  assert.equal(result.updates[0].teamId,a.teamId);
  assert.equal(result.updates[0].nextResults.nuro__cb_0.productName,"NURO");
});
