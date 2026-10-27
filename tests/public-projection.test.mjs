import test from "node:test";
import assert from "node:assert/strict";
import {projectCountRecord,projectPublicProduct,projectCountCorrection,auditNoFinancialKeys} from "../security/public-projection.mjs";

const record={
 id:"c1_u1_2026-10-27",companyId:"c1",uid:"u1",date:"2026-10-27",
 teamId:"team1",teamNameSnapshot:"一班",memberNameSnapshot:"担当者",
 totalCount:5,totalRevenue:100000,workLocation:"会場A",reportStatus:"submitted",
 results:{p1:{productId:"p1",productName:"商品A",count:5,revenuePerUnit:20000,cashback:10000}}
};
const product={id:"p1",companyId:"c1",name:"商品A",active:true,revenue:20000,pricingOptions:[{cashback:10000,revenuePerUnit:20000}]};
const correction={id:"c1",companyId:"c1",recordId:"r1",recordDate:"2026-10-27",changedByUid:"owner",
 before:{teamId:"team1",totalRevenue:80000,totalCount:4,results:record.results},
 after:{teamId:"team2",totalRevenue:100000,totalCount:5,results:record.results}};
test("count projection contains no financial fields",()=>{
 const projected=projectCountRecord(record);
 assert.equal(projected.totalCount,5);
 assert.equal(projected.results[0].count,5);
 assert.equal(projected.results[0].revenuePerUnit,undefined);
 assert.ok(auditNoFinancialKeys(projected));
});
test("product projection does not expose unit price or plans",()=>{
 const projected=projectPublicProduct(product);
 assert.equal(projected.name,"商品A");
 assert.equal(projected.revenue,undefined);
 assert.ok(auditNoFinancialKeys(projected));
});
test("correction projection strips before and after finance",()=>{
 const projected=projectCountCorrection(correction);
 assert.equal(projected.before.totalCount,4);
 assert.equal(projected.after.teamId,"team2");
 assert.ok(auditNoFinancialKeys(projected));
});
test("corrupted totals reject publication",()=>{
 assert.throws(()=>projectCountRecord({...record,totalCount:6}),/mismatch/);
});
test("unknown/blank counts reject publication",()=>{
 assert.throws(()=>projectCountRecord({...record,results:{p1:{productId:"p1",count:""}}}),/count/);
});
test("unexpected financial key is detectable",()=>{
 assert.throws(()=>auditNoFinancialKeys({any:{revenuePerUnit:1}}),/leaked/);
});
test("zero-count report remains valid",()=>{
 const projected=projectCountRecord({...record,totalCount:0,totalRevenue:0,results:{},reportStatus:"no_result"});
 assert.equal(projected.totalCount,0);
 assert.equal(projected.reportStatus,"no_result");
});
