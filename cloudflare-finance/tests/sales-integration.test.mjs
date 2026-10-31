import {test} from "node:test";
import assert from "node:assert/strict";
import {makeProtectedSalesBridge} from "../client/sales-integration.mjs";
const liveURLs=["https://nico-factory.web.app"];
const gateway="https://sales-finance-gateway.owner-preview.workers.dev";
test("NICO official URL fetches protected view and submits ONLY counts",async()=>{
  for(const origin of liveURLs){
    let syncTrigger,errors=0;
    const calls=[];
    const bridge=makeProtectedSalesBridge({
      origin,gatewayUrl:gateway,companyId:"factory",getMonth:()=>"2026-10",
      currentUser:{getIdToken:async()=>"fixture"},
      subscribeToSignal:(_cid,onSignal)=>{syncTrigger=onSignal;return()=>{}},
      applySnapshot:()=>{},onError:()=>errors++,explicitCutover:true,
      fetcher:async(url,opts)=>{
        calls.push({url,opts});
        if(opts.method==="GET")return Response.json({
          month:"2026-10",policy:{canViewRevenue:false,canViewUnitPrice:false},
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
    assert.equal(calls.some(c=>c.opts.method==="GET" &&
      c.url===gateway+"/v1/financial-view?month=2026-10"),true);
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

test("month switch cannot render old snapshot and no fallback to raw money Firestore",async()=>{
 let selected="2026-09",view=[],errors=[];
 let releases=[];
 const bridge=makeProtectedSalesBridge({
  origin:liveURLs[0],gatewayUrl:gateway,companyId:"factory",
  currentUser:{getIdToken:async()=> "fixture"},
  getMonth:()=>selected,
  subscribeToSignal:()=>()=>{},
  applySnapshot:x=>view.push(x.month),onError:e=>errors.push(e.message),
  explicitCutover:true,
  fetcher:(url)=>{
    const requested=new URL(url).searchParams.get("month");
    return new Promise(resolve=>releases.push(()=>resolve(Response.json({
      month:requested,
      products:[],records:[],revenueGoals:[],
      policy:{canViewRevenue:false,canViewUnitPrice:false}
    }))));
  }
 });
 await Promise.resolve();
 selected="2026-10";
 const next=bridge.refresh();
 await Promise.resolve();
 assert.equal(releases.length,1);
 releases.shift()();
 await next;
 await Promise.resolve();
 for(let i=0;i<30&&!errors.length;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.length,0,"stale September must not replace current October");
 assert.ok(errors.includes("selected_finance_month_changed"));
 for(let i=0;i<10&&releases.length<1;i++)await Promise.resolve();
 assert.equal(releases.length,1);
 releases.shift()();
 for(let i=0;i<10&&view.length===0;i++)await Promise.resolve();
 assert.deepEqual(view,["2026-10"]);
 bridge.close();
});
