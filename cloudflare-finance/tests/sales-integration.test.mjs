import {test} from "node:test";
import assert from "node:assert/strict";
import {makeProtectedSalesBridge} from "../client/sales-integration.mjs";
const liveURLs=["https://nico-factory.web.app","https://keikei-p.github.io"];
const gateway="https://sales-finance-gateway.owner-preview.workers.dev";
test("new and old URLs fetch protected view and submit ONLY counts",async()=>{
  for(const origin of liveURLs){
    let syncTrigger,errors=0;
    const calls=[];
    const bridge=makeProtectedSalesBridge({
      origin,gatewayUrl:gateway,companyId:"factory",
      currentUser:{getIdToken:async()=>"fixture"},
      subscribeToSignal:(_cid,onSignal)=>{syncTrigger=onSignal;return()=>{}},
      applySnapshot:()=>{},onError:()=>errors++,explicitCutover:true,
      fetcher:async(url,opts)=>{
        calls.push({url,opts});
        if(opts.method==="GET")return Response.json({
          policy:{canViewRevenue:false,canViewUnitPrice:false},
          products:[{id:"sim",name:"SIM",active:true,planIds:["plan_0"]}],
          records:[],revenueGoals:[]});
        return Response.json({saved:true,recordId:"factory_staff_2026-10-22",totalCount:2});
      }
    });
    const result=await bridge.submit({
      selection:{uid:"staff",date:"2026-10-22",teamId:"A",workLocation:"店舗",reportStatus:"submitted"},
      inputs:[{dataset:{productId:"sim",cashback:"0",revenuePerUnit:"500000"},value:"2"}],
      products:[{id:"sim",active:true,securePlanIds:["plan_0"],pricingOptions:[{cashback:0,revenuePerUnit:0}]}]
    });
    assert.equal(result.saved,true);
    assert.equal(calls.some(c=>c.opts.method==="GET"),true);
    const post=calls.find(c=>c.opts.method==="POST");
    assert.deepEqual(JSON.parse(post.opts.body).entries,[{productId:"sim",planId:"plan_0",count:2}]);
    assert.equal(post.opts.body.includes("500000"),false);
    syncTrigger();bridge.close();
    assert.equal(errors,0);
  }
});
test("No cloud API call is possible while cutover flag is off",()=>{
  assert.throws(()=>makeProtectedSalesBridge({
    origin:liveURLs[0],gatewayUrl:gateway,explicitCutover:false
  }),/protected_sales_cutover_not_approved/);
});
