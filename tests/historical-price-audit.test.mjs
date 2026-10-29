import test from "node:test";
import assert from "node:assert/strict";
import {auditHistoricPrices} from "../security/historical-price-audit.mjs";
const products=[
 {companyId:"nico",id:"tok",pricingOptions:[{cashback:0,revenuePerUnit:10000}]},
 {companyId:"nico",id:"ever",pricingOptions:[{cashback:0,revenuePerUnit:20000}]},
 {companyId:"nico",id:"nuro",pricingOptions:[
   {cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:22500}]}
];
const rec=(id,results,extra={})=>({
 id,uid:"sales1",companyId:"nico",teamId:"oldteam",date:"2026-10-23",
 results,totalCount:Object.values(results).reduce((sum,x)=>sum+x.count,0),
 totalRevenue:Object.values(results).reduce((sum,x)=>sum+x.count*x.revenuePerUnit,0),
 ...extra
});
const tok={productId:"tok",count:5,cashback:0,revenuePerUnit:2000};
const ever={productId:"ever",count:5,cashback:0,revenuePerUnit:16000};
const nuro0={productId:"nuro",count:2,cashback:0,revenuePerUnit:25000};
const nuro20={productId:"nuro",count:3,cashback:20000,revenuePerUnit:22500};
const audit=(records,p=products)=>auditHistoricPrices({companyId:"nico",records,products:p});
test("historical 5 deals 10k yen and 5 deals 80k yen are FLAGGED, never repriced",()=>{
 const records=[rec("oldtok",{tok}),rec("oldever",{ever})];
 const before=JSON.stringify({records,products});
 const result=audit(records);
 assert.equal(result.rateDrifts,2);
 assert.equal(result.totalStoredLineAmount,90000);
 assert.equal(result.mismatchedTotals,0);
 const t=result.findings.find(x=>x.recordId==="oldtok");
 assert.equal(t.kind,"SAVED_VS_CURRENT_RATE_DIFFERENCE");
 assert.equal(t.savedUnit,2000);assert.equal(t.currentCatalogUnit,10000);
 assert.equal(t.savedLineAmount,10000);assert.equal(t.currentCatalogLineAmount,50000);
 const e=result.findings.find(x=>x.recordId==="oldever");
 assert.equal(e.savedLineAmount,80000);assert.equal(e.currentCatalogLineAmount,100000);
 assert.equal(JSON.stringify({records,products}),before);
 assert.equal(result.productionDataChanged,false);
 assert.equal(result.correctionAuthorized,false);
 assert.equal(result.sourceCoverageVerified,false);
});
test("NURO cashback 0 and 20k are never mistaken for earned revenue",()=>{
 const r=rec("nuroday",{zero:nuro0,twenty:nuro20});
 const x=audit([r]);
 assert.equal(x.totalStoredLineAmount,117500);
 assert.equal(x.rateDrifts,0);
 assert.equal(x.unresolvedRates,0);
 assert.equal(x.findings.length,0);
});
test("zero-yen historical unit is retained and flagged, not silently set to current rate",()=>{
 const r=rec("zero",{a:{productId:"tok",count:5,cashback:0,revenuePerUnit:0}});
 const x=audit([r]);
 assert.equal(x.totalStoredLineAmount,0);
 assert.equal(x.findings[0].savedUnit,0);
 assert.equal(x.findings[0].currentCatalogUnit,10000);
});
test("unknown cashback or missing master cannot be falsely certified",()=>{
 const r=rec("unknown",{a:{...nuro20,cashback:15777},
   b:{productId:"retired",count:1,revenuePerUnit:5000,cashback:0}});
 const x=audit([r]);
 assert.equal(x.unresolvedRates,2);
 assert(x.findings.some(v=>v.kind==="CASHBACK_NOT_VERIFIED"));
 assert(x.findings.some(v=>v.kind==="PRODUCT_OR_PLAN_UNVERIFIED"));
});
test("stored count and amount mismatches are flagged without any repair",()=>{
 const records=[rec("wrong",{a:tok},{totalCount:8,totalRevenue:15000})];
 const before=JSON.stringify(records);
 const x=audit(records);
 assert.equal(x.mismatchedTotals,1);
 const row=x.findings.find(v=>v.kind==="STORED_TOTAL_MISMATCH_OR_MISSING");
 assert.equal(row.derivedCount,5);assert.equal(row.derivedSavedRevenue,10000);
 assert.equal(JSON.stringify(records),before);
});
test("duplicate records, cross-company rows, invalid dates and malformed money fail closed",()=>{
 const r=rec("a",{a:tok});
 assert.throws(()=>audit([r,r]),/record_scope/);
 assert.throws(()=>audit([{...r,companyId:"other"}]),/record_scope/);
 assert.throws(()=>audit([{...r,date:"2026-02-30"}]),/record_scope/);
 assert.throws(()=>audit([rec("bad",{a:{...tok,revenuePerUnit:null}})]),/missing_saved_unit/);
 assert.throws(()=>audit([rec("negative",{a:{...tok,count:-1}})]),/count/);
 assert.throws(()=>audit([rec("large",{a:{...tok,count:Number.MAX_SAFE_INTEGER}})]),/amount_overflow/);
 assert.throws(()=>audit([r],[{...products[0],pricingOptions:[
   {cashback:0,revenuePerUnit:10000},{cashback:0,revenuePerUnit:20000}]},...products.slice(1)]),/ambiguous_cashback/);
});
test("team movement never changes stored team attribution in owner-only audit",()=>{
 const before=rec("before",{a:tok},{date:"2026-09-19",teamId:"teamA"});
 const after=rec("after",{a:ever},{date:"2026-10-19",teamId:"teamB"});
 const x=audit([before,after]);
 assert.deepEqual(x.findings.map(f=>f.teamId),["teamA","teamB"]);
});
