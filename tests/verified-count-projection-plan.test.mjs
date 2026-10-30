import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {prepareVerifiedCountProjection}
 from "../security/verified-count-projection-plan.mjs";

const companyId="companyA",month="2026-10",sourceSnapshotTime="2026-10-30T06:00:00Z";
const product={id:"nuro",companyId,name:"NURO光",active:true,sortOrder:1,
 revenue:10000,pricingOptions:[{cashback:15000,revenuePerUnit:10000}],
 cashbackOptions:[{name:"15000円",cashback:15000}]};
const record=(id,date="2026-10-30")=>({
 id,companyId,uid:"user_"+id,date,teamId:"team1",
 teamNameSnapshot:"1班",memberNameSnapshot:"担当者",workLocation:"現場1",
 totalCount:1,totalRevenue:10000,
 results:{nuro:{productId:"nuro",productName:"NURO光",
  count:1,revenuePerUnit:10000,cashback:15000}},
 updatedAt:{seconds:123}
});
const build=overrides=>prepareVerifiedCountProjection({
 companyId,month,sourceSnapshotTime,records:[record("r1")],
 products:[product],expectedRecordCount:1,expectedProductCount:1,
 ...overrides
});
test("money-bearing originals become exact count-only flat payloads without changing source IDs",()=>{
 const original=record("r1"),productOriginal=structuredClone(product);
 const output=build({records:[original],products:[productOriginal]});
 assert.deepEqual(output.manifest,{
  companyId,month,sourceSnapshotTime,
  expectedRecordCount:1,expectedProductCount:1,
  publishedRecordCount:1,publishedLineCount:1,publishedProductCount:1,
  checkedTotalCount:1,noSourceWrites:true,productionApprovalGranted:false
 });
 assert.deepEqual(output.collections.publicRecords,[{
  companyId,sourceId:"r1",uid:"user_r1",date:"2026-10-30",
  teamId:"team1",totalCount:1,reportStatus:"submitted",
  memberNameSnapshot:"担当者",teamNameSnapshot:"1班",workLocation:"現場1"
 }]);
 assert.deepEqual(output.collections.publicRecordLines,[{
  companyId,recordId:"r1",sourceId:"r1__0000",
  date:"2026-10-30",uid:"user_r1",teamId:"team1",
  productId:"nuro",count:1
 }]);
 assert.deepEqual(output.collections.publicProducts,[{
  companyId,sourceId:"nuro",name:"NURO光",active:true,sortOrder:1
 }]);
 assert.equal(original.totalRevenue,10000,"existing sale unchanged");
 assert.equal(productOriginal.pricingOptions[0].revenuePerUnit,10000,
  "historical pricing not mutated");
 for(const sensitive of ["totalRevenue","cashback","revenuePerUnit","pricingOptions","unitPrice"])
  assert(!JSON.stringify(output).includes(sensitive));
});
test("more than 2,000 records on one day are planned without truncation",()=>{
 const rows=Array.from({length:2501},(_,i)=>record("r"+String(i).padStart(5,"0")));
 const result=build({
  records:rows,expectedRecordCount:rows.length
 });
 assert.equal(result.collections.publicRecords.length,2501);
 assert.equal(result.collections.publicRecordLines.length,2501);
 assert.equal(result.manifest.checkedTotalCount,2501);
 assert.equal(result.collections.publicRecords[0].sourceId,"r00000");
 assert.equal(result.collections.publicRecords.at(-1).sourceId,"r02500");
});
test("0件報告 preserves status and creates zero count lines",()=>{
 const report={...record("zero"),totalCount:0,totalRevenue:0,results:{},reportStatus:"no_result"};
 const data=build({records:[report]});
 assert.equal(data.collections.publicRecords[0].reportStatus,"no_result");
 assert.equal(data.collections.publicRecordLines.length,0);
 assert.equal(data.manifest.checkedTotalCount,0);
});
test("partial results, duplicate IDs, mismatched totals, wrong company and stale dates fail closed",()=>{
 const failures=[
  {expectedRecordCount:2},
  {expectedProductCount:2},
  {records:[record("x"),record("x")],expectedRecordCount:2},
  {records:[{...record("r1"),companyId:"foreign"}]},
  {records:[{...record("r1"),date:"2026-09-30"}]},
  {records:[{...record("r1"),totalCount:2}]},
  {records:[{...record("r1"),results:{nuro:{count:2}}}]},
  {products:[{...product,id:"nuro_CB20000"}]},
  {products:[{...product,companyId:"foreign"}]},
  {records:[{...record("r1"),id:"illegal_CB20000"}]},
  {sourceSnapshotTime:"no-snapshot"},
  {records:null}
 ];
 for(const change of failures)
  assert.throws(()=>build(change),/count_projection_reconciliation_failed/);
});
test("planner uses no Firebase, production writes, deletes or network connections",()=>{
 const src=readFileSync(new URL("../security/verified-count-projection-plan.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/\b(getFirestore|setDoc|deleteDoc|runTransaction|fetch\s*\(|firebase deploy|wrangler deploy)\b/);
 assert.match(src,/noSourceWrites:true,productionApprovalGranted:false/);
});
