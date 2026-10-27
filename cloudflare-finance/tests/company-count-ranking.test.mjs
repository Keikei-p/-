import {test} from "node:test";
import assert from "node:assert/strict";
import {buildCompanyCountRanking} from "../src/company-count-ranking.mjs";
const companyId="company1", date="2026-10-27";
function record(id,uid,teamId,totalCount,day=date){
 return {id,companyId,uid,teamId,date:day,totalCount,totalRevenue:999999,
   results:{p:{count:totalCount,revenuePerUnit:999999}}};
}
test("whole-company COUNT ranking includes direct and partner team, never money",()=>{
 const records=[record("1","u1","directA",3),record("2","u2","partnerX",5),
   record("3","u3","directB",1),record("4","u4","partnerX",2),
   record("old","u5","directA",99,"2026-09-27")];
 const data=buildCompanyCountRanking(records,companyId,"2026-10");
 assert.equal(data.totalCount,11);
 assert.deepEqual(data.ranking.map(r=>[r.teamId,r.totalCount]),[
   ["partnerX",7],["directA",3],["directB",1]]);
 assert.equal(JSON.stringify(data).includes("revenue"),false);
 assert.equal(JSON.stringify(data).includes("999999"),false);
});
test("invalid or duplicate daily records stop instead of inflating company ranking",()=>{
 assert.throws(()=>buildCompanyCountRanking([
   record("a","same","directA",3),record("b","same","partnerX",2)
 ],companyId,"2026-10"),/duplicate_daily/);
 assert.throws(()=>buildCompanyCountRanking([record("a","u1","directA",-1)],companyId,"2026-10"),/invalid_count/);
});
test("cross-company data are excluded and historical data do not change",()=>{
 const old=record("1","u1","directA",1);
 const other={...record("2","u2","foreign",99),companyId:"foreign"};
 const original=JSON.stringify([old,other]);
 const actual=buildCompanyCountRanking([old,other],companyId,"2026-10");
 assert.equal(actual.totalCount,1);
 assert.equal(JSON.stringify([old,other]),original);
});
