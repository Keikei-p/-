import {test} from "node:test";
import assert from "node:assert/strict";
import {projectSafeView,secureCountRows,buildSafeFormIntent} from "../client/finance-browser-contract.mjs";
const prod={id:"sim",companyId:"c",name:"SIM",active:true,sortOrder:1,planIds:["plan_0","plan_1"]};
const rec={id:"r1",companyId:"c",uid:"staff",teamId:"A",date:"2026-10-22",totalCount:3,
  recordVersion:"2026-10-22T01:00:00.000123Z",results:{
    item_0:{productId:"sim",planId:"plan_0",productName:"SIM",count:2},
    item_1:{productId:"sim",planId:"plan_1",productName:"SIM",count:1}}};
const sample=(policy={canViewRevenue:false,canViewUnitPrice:false})=>
  ({policy,products:[prod],records:[rec],revenueGoals:[]});
test("No-price browser preserves all count groups using opaque plan IDs",()=>{
  const m=projectSafeView(sample());
  assert.deepEqual(m.products[0].pricingOptions,[{cashback:0,revenuePerUnit:0},{cashback:1,revenuePerUnit:0}]);
  assert.equal(Object.values(m.records[0].results).reduce((a,r)=>a+r.count,0),3);
  assert.deepEqual(secureCountRows(Object.values(m.records[0].results)),
    [{productId:"sim",planId:"plan_0",count:2},{productId:"sim",planId:"plan_1",count:1}]);
  assert.equal(m.records[0].secureReadOnly,false);
  assert.equal(m.records[0].totalRevenue,undefined);
});
test("Revenue permission remains separate from prices",()=>{
  const v=sample({canViewRevenue:true,canViewUnitPrice:false});
  v.records[0]={...rec,totalRevenue:30000};
  v.revenueGoals=[{id:"goal",targetRevenue:100000}];
  const m=projectSafeView(v);
  assert.equal(m.records[0].totalRevenue,30000);
  assert.equal(m.revenueGoals[0].targetRevenue,100000);
  assert.equal(m.products[0].pricingOptions[1].revenuePerUnit,0);
});
test("Gateway cannot accidentally send amounts to unapproved viewers",()=>{
  let v=sample();v.products=[{...prod,revenue:25000}];
  assert.throws(()=>projectSafeView(v),/financial_view_contract_violation/);
  v=sample();v.records=[{...rec,totalRevenue:9999}];
  assert.throws(()=>projectSafeView(v),/financial_view_contract_violation/);
  v=sample();v.records=[{...rec,results:{item_0:{...rec.results.item_0,cashback:5000}}}];
  assert.throws(()=>projectSafeView(v),/financial_view_contract_violation/);
});
test("Unknown historical plans cannot silently change the saved product rate",()=>{
  let v=sample();v.records=[{...rec,results:{item_0:{productId:"sim",planId:null,productName:"Old",count:3}}}];
  const m=projectSafeView(v);
  assert.equal(m.records[0].secureReadOnly,true);
  assert.throws(()=>secureCountRows(Object.values(m.records[0].results)),/financial_view_contract_violation/);
  v=sample();v.records=[{...rec,recordVersion:null}];
  assert.equal(projectSafeView(v).records[0].secureReadOnly,true);
});
test("Reject invalid, duplicate or negative-count rows",()=>{
  assert.throws(()=>secureCountRows([{productId:"sim",securePlanId:"plan_0",count:1},
    {productId:"sim",securePlanId:"plan_0",count:2}]),/financial_view_contract_violation/);
  assert.throws(()=>secureCountRows([{productId:"sim",securePlanId:"plan_0",count:-1}]),/financial_view_contract_violation/);
});

test("Existing mobile input DOM maps to count-only API body without amounts",()=>{
  const model=projectSafeView(sample());
  const inputs=[{dataset:{productId:"sim",cashback:"0",revenuePerUnit:"90000"},value:"2"},
    {dataset:{productId:"sim",cashback:"1",revenuePerUnit:"12000"},value:"1"}];
  const body=buildSafeFormIntent({uid:"staff",date:"2026-10-22",teamId:"A",workLocation:"店舗",
    reportStatus:"submitted",existingRecord:model.records[0]},inputs,model.products);
  assert.equal(body.recordId,"r1");
  assert.equal(body.expectedRecordUpdateTime,rec.recordVersion);
  assert.equal(JSON.stringify(body).includes("90000"),false);
  assert.equal(JSON.stringify(body).includes("12000"),false);
  assert.deepEqual(body.entries,[
    {productId:"sim",planId:"plan_0",count:2},
    {productId:"sim",planId:"plan_1",count:1}
  ]);
});
test("Approved price viewer maps real cashback number to opaque plan index",()=>{
  const v=sample({canViewRevenue:true,canViewUnitPrice:true});
  v.products=[{id:"sim",companyId:"c",name:"SIM",active:true,revenue:12000,
    pricingOptions:[{cashback:3000,revenuePerUnit:9000},{cashback:0,revenuePerUnit:12000}],
    planIds:["plan_0","plan_1"]}];
  const products=projectSafeView(v).products;
  const body=buildSafeFormIntent({uid:"staff",date:"2026-10-22",teamId:"A",
    workLocation:"店舗",reportStatus:"submitted"},
    [{dataset:{productId:"sim",cashback:"3000",revenuePerUnit:"9000"},value:"2"}],products);
  assert.deepEqual(body.entries,[{productId:"sim",planId:"plan_1",count:2}]);
  assert.equal(JSON.stringify(body).includes("9000"),false);
});
test("Unsafe past record edit cannot silently replace unknown plans",()=>{
  const v=sample();v.records=[{...rec,recordVersion:null}];
  const m=projectSafeView(v);
  assert.throws(()=>buildSafeFormIntent({uid:"staff",date:"2026-10-22",teamId:"A",
      workLocation:"店舗",reportStatus:"submitted",existingRecord:m.records[0]},[],m.products),
    /historical_plan_requires_owner_review/);
});
test("Submitted zero-count cannot clear saved history without explicitly choosing no-result",()=>{
  const m=projectSafeView(sample());
  const inputs=[{dataset:{productId:"sim",cashback:"0"},value:"0"}];
  assert.throws(()=>buildSafeFormIntent({uid:"staff",date:"2026-10-22",teamId:"A",
    reportStatus:"submitted"},inputs,m.products),/financial_view_contract_violation/);
  const zero=buildSafeFormIntent({uid:"staff",date:"2026-10-22",teamId:"A",
    reportStatus:"no_result"},inputs,m.products);
  assert.deepEqual(zero.entries,[]);
});

test("Orphaned historical products retain counts and are view-only, never break the full page",()=>{
  const v=sample();
  v.records[0]={...rec,totalCount:6,results:{
    item_0:{productId:null,planId:null,productName:"過去の商材",count:6}
  }};
  const projected=projectSafeView(v);
  assert.equal(projected.records[0].secureReadOnly,true);
  assert.equal(projected.records[0].totalCount,6);
  assert.equal(Object.values(projected.records[0].results)[0].count,6);
  assert.deepEqual(Object.keys(projected.records[0].results),["legacy_item_0"]);
  assert.throws(()=>secureCountRows(Object.values(projected.records[0].results)),
    /financial_view_contract_violation/);
});

test("Unrecognized financial and customer fields NEVER pass into projected browser records",()=>{
  for(const extra of [
    {grossProfit:300000}, {unitPrice:90000}, {customerPhone:"090-secret"},
    {confidential:{revenue:5000}},{recordCorrections:[{cashback:5000}]}
  ]){
    const v=sample();
    v.records=[{...rec,...extra}];
    assert.throws(()=>projectSafeView(v),/financial_view_contract_violation/);
  }
  const revenue=sample({canViewRevenue:true,canViewUnitPrice:false});
  revenue.records=[{...rec,totalRevenue:30000,staffPrivateEmail:"secret@example.test"}];
  assert.throws(()=>projectSafeView(revenue),/financial_view_contract_violation/);
  const owner=sample({canViewRevenue:true,canViewUnitPrice:true});
  owner.records=[{...rec,totalRevenue:30000,personalNotes:"private"}];
  assert.throws(()=>projectSafeView(owner),/financial_view_contract_violation/);
});

test("Nested future price keys and unauthorized product fields fail closed",()=>{
  const v=sample();
  v.records=[{...rec,results:{item_0:{...rec.results.item_0,grossPrice:80000}}}];
  assert.throws(()=>projectSafeView(v),/financial_view_contract_violation/);
  const p=sample();
  p.products=[{...prod,secretInvoiceAmount:12345}];
  assert.throws(()=>projectSafeView(p),/financial_view_contract_violation/);
  const r=sample({canViewRevenue:true,canViewUnitPrice:false});
  r.revenueGoals=[{id:"goal",companyId:"c",teamId:"A",month:"2026-10",
    targetRevenue:100000,internalBankAccount:"secret"}];
  assert.throws(()=>projectSafeView(r),/financial_view_contract_violation/);
});

test("Canonical approved Owner revenue and unit prices stay visible without raw extra keys",()=>{
  const v=sample({canViewRevenue:true,canViewUnitPrice:true});
  v.records=[{...rec,totalRevenue:30000,results:{
    item_0:{...rec.results.item_0,revenuePerUnit:10000,cashback:2000}
  }}];
  v.products=[{...prod,revenue:20000,cashbackOptions:[0,2000],
    pricingOptions:[{cashback:0,revenuePerUnit:20000},
      {cashback:2000,revenuePerUnit:18000}]}];
  v.revenueGoals=[{id:"goal",companyId:"c",teamId:"A",month:"2026-10",targetRevenue:100000}];
  const view=projectSafeView(v);
  assert.equal(view.records[0].totalRevenue,30000);
  assert.equal(view.records[0].results.item_0.revenuePerUnit,10000);
  assert.equal(view.products[0].pricingOptions[1].revenuePerUnit,18000);
  assert.equal(view.revenueGoals[0].targetRevenue,100000);
});
test("Contradictory permission flags are rejected, legitimate partner cashback envelope accepted",()=>{
  const conflicting=sample({canViewRevenue:false,canViewUnitPrice:true});
  assert.throws(()=>projectSafeView(conflicting),/financial_view_contract_violation/);
  const partner=sample({canViewRevenue:false,canViewUnitPrice:false,isPartner:true});
  partner.products=[{...prod,cashbackPlans:[{planId:"cb_5000",cashback:5000}]}];
  const view=projectSafeView(partner);
  assert.equal(view.records[0].totalCount,3);
  assert.equal(view.records[0].totalRevenue,undefined);
});
