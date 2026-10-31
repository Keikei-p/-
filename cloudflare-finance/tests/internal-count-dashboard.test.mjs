import test from "node:test";
import assert from "node:assert/strict";
import {buildVerifiedInternalCountDashboard as project} from "../client/internal-count-dashboard.mjs";

const companyId="internal_a",month="2026-02";
const readTime="2026-02-01T00:00:00Z";
const dailyReadTimes=Object.fromEntries(Array.from({length:28},(_,i)=>[
 month+"-"+String(i+1).padStart(2,"0"),readTime
]));
const product=(id,name)=>({companyId,sourceId:id,name,active:true,sortOrder:0});
const record=(id,uid,name,teamId,teamName,totalCount,date="2026-02-03")=>({
 companyId,sourceId:id,uid,date,teamId,totalCount,
 reportStatus:totalCount?"submitted":"no_result",
 memberNameSnapshot:name,teamNameSnapshot:teamName,workLocation:"会場"
});
const line=(r,productId,count)=>({
 companyId,sourceId:r.sourceId+"__"+productId,
 recordId:r.sourceId,uid:r.uid,date:r.date,teamId:r.teamId,
 productId,count
});
function make(){
 const a=record("a1","staff1","佐藤","team1","第一班",2);
 const b=record("b1","staff2","田中","team1","第一班",1);
 const c=record("c1","staff3","山田","team2","第二班",1);
 return {complete:true,snapshotScope:"per_day",month,companyId,dayCount:28,
  daysVerified:28,dailyReadTimes:{...dailyReadTimes},totalCount:4,
  records:[a,b,c],products:[product("nu","NURO"),product("sim","SIM")],
  lines:[line(a,"nu",2),line(b,"nu",1),line(c,"sim",1)]};
}
test("verified team and product totals use historical team snapshots, while revenue ranks stay server-only",()=>{
 const result=project(make());
 assert.equal(result.companyCount,4);
 assert.equal(result.dayCount,28);
 assert.deepEqual(result.teamCounts,[{name:"第一班",count:3},{name:"第二班",count:1}]);
 assert.deepEqual(result.productCounts,[{name:"NURO",count:3},{name:"SIM",count:1}]);
 assert.equal(result.individualRankingSource,"server_revenue_rank_only_required");
 assert.equal(Object.hasOwn(result,"individualRanks"),false);
 assert.doesNotMatch(JSON.stringify(result),/totalRevenue|unitPrice|cashback|revenuePerUnit|staff1|staff2|staff3/);
});
test("a missing day stops the whole month, never turns an unavailable day into zero",()=>{
 const v=make();delete v.dailyReadTimes["2026-02-12"];
 assert.throws(()=>project(v),/incomplete_days|day_snapshot_missing/);
});
test("product identity and catalog cannot be duplicated or changed by a label",()=>{
 const v=make();v.products.push(product("nu","別のNURO"));
 assert.throws(()=>project(v),/catalog/);
});
test("saved record ownership and sums remain checked even with a complete flag",()=>{
 for(const transform of [
  v=>{v.totalCount=5},
  v=>{v.lines.pop()},
  v=>{v.lines[0].count=3},
  v=>{v.lines[0].uid="foreign"},
  v=>{v.records[0].companyId="foreign"},
  v=>{v.records.push({...v.records[0]})}
 ]){
  const v=make();transform(v);
  assert.throws(()=>project(v));
 }
});
test("money hidden in a name, brand or location is refused",()=>{
 for(const transform of [
  v=>{v.products[0].name="NURO 10000円"},
  v=>{v.records[0].memberNameSnapshot="佐藤 売上50000"},
  v=>{v.records[0].workLocation="CB10000"}
 ]){
  const v=make();transform(v);
  assert.throws(()=>project(v),/unsafe_label/);
 }
});
test("empty month has explicit, verified 28 days and no guessed identities",()=>{
 const v=make();v.records=[];v.lines=[];v.totalCount=0;
 const p=project(v);
 assert.equal(p.companyCount,0);assert.equal(p.individualRankingSource,"server_revenue_rank_only_required");
 assert.equal(p.dayCount,28);
});
test("this is an additive, browser-only transformation, no raw Firestore or deployment",async()=>{
 const {readFileSync}=await import("node:fs");
 const source=readFileSync(new URL("../client/internal-count-dashboard.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\b(?:getDocs|onSnapshot|setDoc|updateDoc|deleteDoc|runTransaction|fetch)\s*\(/);
 assert.doesNotMatch(source,/firebase deploy|wrangler deploy|\.collection\(/);
});
