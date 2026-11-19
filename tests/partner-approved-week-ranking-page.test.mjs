import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const backend=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const i=page.indexOf("function approvedRankingDateRange("),
 j=page.indexOf("async function loadApprovedCountRanking(){",i);
assert(i>0&&j>i,"reviewed ranking date range calculator missing");
const src=page.slice(i,j);
const scope=vm.createContext({Date});
vm.runInContext(src,scope);
const range=(month,period,selected,today)=>JSON.parse(
 JSON.stringify(scope.approvedRankingDateRange(month,period,selected,today)));
test("current month stops at JST today; past month includes its final day",()=>{
 assert.deepEqual(range("2026-11","month","2026-11-07","2026-11-19"),{
  date:"2026-11-19",start:"2026-11-01",end:"2026-11-19",period:"month"});
 assert.deepEqual(range("2026-10","month","2026-10-03","2026-11-19"),{
  date:"2026-10-31",start:"2026-10-01",end:"2026-10-31",period:"month"});
});
test("Mon-Sun week crosses month boundary without losing earlier month's saved counts",()=>{
 assert.deepEqual(range("2026-11","week","2026-11-01","2026-11-19"),{
  date:"2026-11-01",start:"2026-10-26",end:"2026-11-01",period:"week"});
 assert.deepEqual(range("2026-01","week","2026-01-01","2026-11-19"),{
  date:"2026-01-01",start:"2025-12-29",end:"2026-01-04",period:"week"});
});
test("current unfinished week only counts through current JST day",()=>{
 assert.deepEqual(range("2026-11","week","2026-11-19","2026-11-19"),{
  date:"2026-11-19",start:"2026-11-16",end:"2026-11-19",period:"week"});
 assert.deepEqual(range("2026-11","day","2026-11-19","2026-11-19"),{
  date:"2026-11-19",start:"2026-11-19",end:"2026-11-19",period:"day"});
});
test("future, non-existent day, wrong month, unknown mode fail closed",()=>{
 for(const args of [
  ["2026-11","week","2026-11-20","2026-11-19"],
  ["2026-11","day","2026-10-31","2026-11-19"],
  ["2026-02","week","2026-02-31","2026-11-19"],
  ["2026-11","year","2026-11-19","2026-11-19"],
  ["2026-13","month","2026-11-19","2026-11-19"],
  ["2026-12","month","2026-12-01","2026-11-19"]
 ])assert.throws(()=>range(...args));
});
test("existing server accepts day/week/month and client preserves financial denial + disabled switches",()=>{
 assert.match(backend,/!\["day","week","month"\]\.includes\(period\)/);
 assert.match(page,/id="approvedSharedRankPeriod"[^>]*>[^<]*<option value="month">月別<\/option><option value="week">週別<\/option><option value="day">日別<\/option>/);
 assert.match(page,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
 assert.match(page,/const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;/);
 assert.match(page,/approvedRankData=null;[\s\S]*?let range;[\s\S]*?approvedRankingDateRange\(/);
 assert.match(page,/verifyApprovedCountRanking\(value,start,end\)/);
 assert.match(page,/activeCodeSession!==session\|\|workspaceCompanyId!==company\)return/);
 assert.doesNotMatch(src,/\b(getDoc|setDoc|runTransaction|updateDoc|deleteDoc|revenueGoals|unitPrice)\b/);
});
