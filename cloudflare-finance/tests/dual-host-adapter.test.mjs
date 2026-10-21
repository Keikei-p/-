import {test} from "node:test";
import assert from "node:assert/strict";
import {SALES_HOST_ORIGINS,makeCountIntent,submitCountIntent,CountEntryConflict,getSafeFinancialView}
  from "../client/dual-host-adapter.mjs";
const gateway="https://sales-finance-gateway.owner-subdomain.workers.dev";
const user={async getIdToken(forceRefresh){assert.equal(forceRefresh,true);return "mock-id-token";}};
const input={uid:"staff",date:"2026-10-22",teamId:"A",workLocation:"店舗",
  reportStatus:"submitted",rows:[{productId:"sim",planId:"plan_0",count:2}]};
test("unchanged input forms can map to only COUNT intent without money fields",()=>{
  const p=makeCountIntent(input);
  assert.deepEqual(p,{uid:"staff",date:"2026-10-22",teamId:"A",workLocation:"店舗",
    reportStatus:"submitted",entries:[{productId:"sim",planId:"plan_0",count:2}]});
  assert.equal(JSON.stringify(p).includes("revenue"),false);
});
test("both legacy and NICO Factory origins use the same secure API adapter",async()=>{
  assert.equal(SALES_HOST_ORIGINS.length,2);
  for(const origin of SALES_HOST_ORIGINS){
    let calls=0;
    const res=await submitCountIntent({gatewayUrl:gateway,origin,user,input:makeCountIntent(input),
      explicitCutover:true,fetcher:async(url,options)=>{
        calls++;
        assert.equal(url,gateway+"/v1/count-record");
        assert.equal(options.method,"POST");
        assert.equal(options.cache,"no-store");
        assert.equal(options.headers.Authorization,"Bearer mock-id-token");
        assert.equal(JSON.parse(options.body).entries[0].count,2);
        return Response.json({saved:true,recordId:"factory_staff_2026-10-22",totalCount:2});
      }});
    assert.equal(res.totalCount,2);
    assert.equal(calls,1);
  }
});
test("history edits include the original ID and exact Firestore server revision",()=>{
  const old={id:"legacy-id",uid:"staff",date:"2026-10-22",
    recordVersion:"2026-10-22T01:00:00.123456Z",
    results:{x:{productId:"sim",planId:"plan_0",count:1}}};
  const p=makeCountIntent({...input,existingRecord:old});
  assert.equal(p.recordId,"legacy-id");
  assert.equal(p.expectedRecordUpdateTime,old.recordVersion);
  assert.throws(()=>makeCountIntent({...input,existingRecord:{...old,recordVersion:null}}),/missing_server_record_version/);
  assert.throws(()=>makeCountIntent({...input,existingRecord:{...old,uid:"wrong"}}),/record_identity_changed/);
});
test("no-result count accepted only when entries are truly zero",()=>{
  const req=makeCountIntent({...input,reportStatus:"no_result",
    rows:[{productId:"sim",planId:"plan_0",count:0}]});
  assert.deepEqual(req.entries,[]);
  assert.throws(()=>makeCountIntent({...input,reportStatus:"no_result"}),/zero_report_has_count/);
});
test("bad rows and historical unmapped plan do not silently change saved numbers",()=>{
  assert.throws(()=>makeCountIntent({...input,rows:[{productId:"sim",planId:"plan_0",count:-1}]}),/invalid_count_row/);
  assert.throws(()=>makeCountIntent({...input,rows:[{productId:"sim",planId:"plan_0",count:2,price:1}]}),/invalid_count_row/);
  const old={id:"original",uid:"staff",date:"2026-10-22",
    recordVersion:"2026-10-22T01:00:00.123Z",results:{x:{productId:"sim",planId:null,count:1}}};
  assert.throws(()=>makeCountIntent({...input,existingRecord:old}),/historical_plan_not_editable/);
});
test("disabled clients do not send ID token, access remote API or fallback to unprotected Firestore",async()=>{
  let calls=0;
  await assert.rejects(submitCountIntent({gatewayUrl:gateway,origin:SALES_HOST_ORIGINS[0],
    user,input:makeCountIntent(input),fetcher:async()=>{calls++;throw Error("unexpected")}}),/safe_write_not_released/);
  assert.equal(calls,0);
  await assert.rejects(getSafeFinancialView({gatewayUrl:gateway,origin:SALES_HOST_ORIGINS[1],
    user,fetcher:async()=>{calls++;throw Error("unexpected")}}),/safe_gateway_not_released/);
  assert.equal(calls,0);
});
test("bearer token cannot be sent to other origins",async()=>{
  let requests=0;
  for(const url of ["https://attacker.example","http://sales-finance-gateway.owner-subdomain.workers.dev",
    "https://sales-finance-gateway.owner-subdomain.workers.dev.evil.example"]){
    await assert.rejects(submitCountIntent({gatewayUrl:url,origin:SALES_HOST_ORIGINS[0],
      user,input:makeCountIntent(input),explicitCutover:true,
      fetcher:async()=>{requests++;throw Error("request should have been blocked")}}),/gateway_url_invalid/);
  }
  assert.equal(requests,0);
  await assert.rejects(submitCountIntent({gatewayUrl:gateway,origin:"https://attacker.example",
    user,input:makeCountIntent(input),explicitCutover:true}),/origin_not_approved/);
});
test("409 edit collision is a hard failure requiring refresh and does not overwrite drafts",async()=>{
  await assert.rejects(submitCountIntent({gatewayUrl:gateway,origin:SALES_HOST_ORIGINS[0],
    user,input:makeCountIntent(input),explicitCutover:true,
    fetcher:async()=>new Response("conflict",{status:409})}),CountEntryConflict);
});
test("read endpoint returns only validated view shape; does not add monetary values",async()=>{
  const data=await getSafeFinancialView({gatewayUrl:gateway,origin:SALES_HOST_ORIGINS[0],
    user,explicitCutover:true,
    fetcher:async(url,options)=>{
      assert.equal(url,gateway+"/v1/financial-view");
      assert.equal(options.method,"GET");
      return Response.json({products:[{id:"sim",name:"SIM",planIds:["plan_0"]}],
        records:[{id:"record",results:{item_0:{productId:"sim",planId:"plan_0",count:2}}}]});
    }});
  assert.equal(data.records[0].results.item_0.count,2);
});
