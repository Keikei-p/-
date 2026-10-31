"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const page=fs.readFileSync(path.join(__dirname,"../partner-workspace.html"),"utf8");
const original=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
function source(name){
 const start=page.indexOf("function "+name+"(");
 assert(start>=0,name+" missing");
 const end=page.indexOf("\n}",start);
 assert(end>start);
 return page.slice(start,end+2);
}
const ctx=vm.createContext({Date,Number,Object,Map,Set});
vm.runInContext(["periodDatesForCounts","summarizeCountOnlyResponses"].map(source).join("\n"),ctx);
const counts=changes=>Object.fromEntries(KEYS.map(k=>[k,changes[k]||0]));
const staff=[{id:"a",name:"佐藤",teamId:"t1"},{id:"b",name:"田中",teamId:"t2"}];
const record=(id,changes,teamId)=>({staffId:id,counts:counts(changes),
 totalCount:Object.values(changes).reduce((a,b)=>a+b,0),
 ...(teamId?{teamIdSnapshot:teamId}:{})});
const day=(date,records)=>({role:"owner",date,staff,records,categories:KEYS});
test("day/week/month periods verify true days and never read future or >366-day archive",()=>{
 const f=ctx.periodDatesForCounts;
 assert.deepEqual([...f("2026-10-31","day","2026-10-31")],["2026-10-31"]);
 assert.deepEqual([...f("2026-10-31","week","2026-10-31")],
 ["2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30","2026-10-31"]);
 assert.equal(f("2026-10-31","month","2026-10-31").length,31);
 assert.equal(f("2026-02-28","month","2026-10-31").length,28);
 assert.throws(()=>f("2026-11-01","day","2026-10-31"),/invalid date/);
 assert.throws(()=>f("2024-10-31","month","2026-10-31"),/366-day history limit/);
 assert.throws(()=>f("2026-02-30","day","2026-10-31"),/invalid date/);
});
test("company, team, individual and product counts are exact and never incorporate monetary data",()=>{
 const data=[
  day("2026-10-30",[record("a",{NURO:2,SBMNP:3},"t1"),record("b",{YMMNP:1},"t2")]),
  day("2026-10-31",[record("a",{NURO:1},"t1"),record("b",{"つばさ・HTB":4},"t2")])
 ];
 const originalRecords=JSON.stringify(data);
 const summary=ctx.summarizeCountOnlyResponses(data,
  [{id:"t1",name:"1班"},{id:"t2",name:"2班"}],KEYS);
 assert.equal(summary.total,11);
 assert.deepEqual([...summary.groups.map(x=>x.count)],[6,5]);
 assert.deepEqual([...summary.people.map(x=>x.count)],[6,5]);
 assert.equal(summary.products.NURO,3);
 assert.equal(summary.products.SBMNP,3);
 assert.equal(summary.products.YMMNP,1);
 assert.equal(summary.products["つばさ・HTB"],4);
 assert.deepEqual([...summary.days.map(x=>x.count)],[5,6]);
 assert.equal(summary.hasUnverifiedTeams,false);
 assert.equal(JSON.stringify(data),originalRecords,"no original count/price or history modification");
 assert.doesNotMatch(JSON.stringify(summary),/revenue|price|unitPrice|totalRevenue|pricingOptions/i);
});
test("historical team transfers cannot silently reassign entries to current teams",()=>{
 const moved=[day("2026-10-27",[record("a",{NURO:5})])];
 const summary=ctx.summarizeCountOnlyResponses(moved,[{id:"t9",name:"新所属9班"}],KEYS);
 assert.equal(summary.total,5);
 assert.equal(summary.groups[0].name,"所属班未確認");
 assert.equal(summary.hasUnverifiedTeams,true);
 assert.equal(summary.groups.some(x=>x.name==="新所属9班"),false);
});
test("partial, duplicated, and malformed server count responses cannot appear as completed totals",()=>{
 const good=day("2026-10-31",[record("a",{NURO:2},"t1")]);
 for(const bad of [
  {...good,records:[...good.records,...good.records]},
  {...good,records:[{...good.records[0],totalCount:99}]},
  {...good,records:[{...good.records[0],counts:{NURO:2}}]},
  {...good,records:[{...good.records[0],counts:{...counts({NURO:2}),NURO:-1}}]},
  {...good,records:[{...good.records[0],staffId:"not_known"}]},
  {...good,categories:["NURO"]}
 ])assert.throws(()=>ctx.summarizeCountOnlyResponses([bad],[],KEYS));
});
test("partner page adds count-only dashboard and management; legacy app is not copied or changed",()=>{
 for(const id of ["tabDashboard","dashboardBox","countKpis","countTeamRank","countStaffRank",
  "countProductRank","countDailyRows","periodDay","periodWeek","periodMonth",
  "moveStaffBox","moveStaffAction","countCsv"])
   assert(page.includes('id="'+id+'"'),id);
 assert.match(page,/getPartnerWorkspace/);
 assert.match(page,/submitPartnerWorkspaceCounts/);
 assert.match(page,/action:"moveStaff"/);
 assert.match(page,/countDayCache\.clear\(\)/);
 assert.match(page,/if\(gen!==countLoadId\|\|auth\.currentUser\?\.uid!==uid\)return/);
 assert.match(page,/const message=await task\(\);await refresh\(\)/);
 assert.doesNotMatch(page,/firebase-firestore\.js|\bgetFirestore\(|\bgetDoc\(|\bgetDocs\(/);
 assert.doesNotMatch(page,/\brevenuePerUnit\b|\btotalRevenue\b|\bunitPrice\b|\bpricingOptions\b/);
 assert.match(original,/function canCurrentUserViewRevenue\(\)/);
 assert.match(original,/function canCurrentUserViewUnitPrice\(\)/);
});
