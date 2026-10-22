import {test} from "node:test";
import assert from "node:assert/strict";
import {projectSafeView,secureCountRows} from "../client/finance-browser-contract.mjs";
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
