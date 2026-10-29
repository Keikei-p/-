import test from "node:test";
import assert from "node:assert/strict";
import {projectCountRecord,projectPublicProduct,projectCountCorrection,projectRankOnly,projectPublicRecordHeader,projectPublicRecordLines,projectPublicCorrectionFlat,projectPublicRankEntries,assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";

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

test("rank-only publication strips money and counts while preserving ordering",()=>{
 const ranks=projectRankOnly({companyId:"c1",period:"2026-10",kind:"member",participants:[
  {id:"a",name:"A",score:80000,count:3,revenue:80000},
  {id:"b",name:"B",score:100000,count:5,revenue:100000},
  {id:"c",name:"C",score:80000,count:3,revenue:80000}
 ]});
 assert.deepEqual(ranks.ranks.map(x=>x.rank),[1,2,2]);
 assert.deepEqual(ranks.ranks.map(x=>x.name),["B","A","C"]);
 assert.equal(JSON.stringify(ranks).includes("100000"),false);
 assert.ok(auditNoFinancialKeys(ranks));
});
test("invalid numeric ranking inputs fail closed",()=>{
 assert.throws(()=>projectRankOnly({companyId:"c1",period:"2026-10",kind:"member",participants:[{id:"x",score:""}]}));
});

test("legacy product names never expose CB or yen-denominated tiers",()=>{
 const p=projectPublicProduct({...product,name:"電気 CB20000円"});
 assert.equal(p.name,"名称は管理者確認中");
 const r=projectCountRecord({...record,results:{p1:{productId:"p1",productName:"光 2万円CB",count:5,revenuePerUnit:20000}}});
 assert.equal(r.results[0].productName,"商材名はオーナー確認中");
});

test("publishable record header contains no nested results or money",()=>{
 const doc=projectPublicRecordHeader(record);
 assert.equal(doc.totalCount,5);
 assert.equal("results" in doc,false);
 assert.ok(assertPublicSchema("publicRecords",[doc]));
});
test("product counts are separate flat documents without price",()=>{
 const lines=projectPublicRecordLines(record);
 assert.equal(lines.length,1);
 assert.equal(lines[0].count,5);
 assert.equal(lines[0].productId,"p1");
 assert.ok(assertPublicSchema("publicRecordLines",lines));
});
test("flat correction drops before/after financial maps",()=>{
 const doc=projectPublicCorrectionFlat(correction);
 assert.equal("before" in doc,false);
 assert.equal(doc.afterTotalCount,5);
 assert.ok(assertPublicSchema("publicRecordCorrections",[doc]));
});
test("rank entries contain neither monetary score nor count",()=>{
 const entries=projectPublicRankEntries({companyId:"c1",period:"2026-10",kind:"member",participants:[{id:"u",name:"User",score:1000000,count:22}]});
 assert.deepEqual(entries.map(x=>x.rank),[1]);
 assert.ok(assertPublicSchema("publicRankEntries",entries));
 assert.equal(JSON.stringify(entries).includes("1000000"),false);
});
test("unexpected nested fields are rejected by public schema",()=>{
 const doc=projectPublicRecordHeader(record);
 assert.throws(()=>assertPublicSchema("publicRecords",[{...doc,revenue:99999}]),/schema mismatch/);
 assert.throws(()=>assertPublicSchema("publicRecords",[{...doc,results:{revenue:10000}}]),/schema mismatch/);
});


test("money embedded in product IDs, record IDs, employee labels and locations blocks publication",()=>{
 const cases=[
  ["publicRecordLines",projectPublicRecordLines(record)[0],"productId","NURO_CB20000"],
  ["publicRecordLines",projectPublicRecordLines(record)[0],"sourceId","record-CB:10000"],
  ["publicRecords",projectPublicRecordHeader(record),"teamId","team-売上20000"],
  ["publicRecords",projectPublicRecordHeader(record),"sourceId","2026-10-27_¥20000"],
  ["publicRecords",projectPublicRecordHeader(record),"workLocation","会場 2万円"],
  ["publicRankEntries",projectPublicRankEntries({
   companyId:"c1",period:"2026-10",kind:"member",participants:[{id:"u",name:"正常",score:10}]
  })[0],"sourceId","uid-commission5000"],
  ["publicProducts",projectPublicProduct(product),"sourceId","product-単価:12000"]
 ];
 for(const [collection,row,key,secret] of cases){
   assert.throws(()=>assertPublicSchema(collection,[{...row,[key]:secret}]),
     /monetary details/,collection+" "+key+" must be blocked");
 }
});

test("legitimate IDs with numbers and numeric-looking team labels remain intact",()=>{
 const row=projectPublicRecordHeader(record);
 assert.ok(assertPublicSchema("publicRecords",[
   {...row,sourceId:"company2026_user123_2026-10-28",teamId:"team04",teamNameSnapshot:"第2班"}
 ]));
});
