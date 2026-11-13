"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs");
const page=fs.readFileSync(require("node:path").join(__dirname,"../partner-workspace.html"),"utf8");
const app=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");
const service=fs.readFileSync(require("node:path").join(__dirname,"../functions-partner-workspace/service.cjs"),"utf8");
const quick=fs.readFileSync(require("node:path").join(__dirname,"../functions-partner-quick/quick-counts.cjs"),"utf8");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];

test("a date change during a save verifies the original day without updating the new view",async()=>{
 const vm=require("node:vm"),date="2026-11-08";
 const controls={save:{},date:{value:date},staffSelect:{value:"staff"}};
 const counts=Object.fromEntries(KEYS.map(k=>[k,1]));
 let verifiedDate,releases=0;
 const context=vm.createContext({
  $:id=>controls[id],KEYS,values:()=>counts,privateValues:()=>({}),
  auth:{currentUser:{}},activeCodeSession:"",nonce:1,loading:false,
  data:{date,records:[]},countDayCache:{clear(){}},
  save:async input=>{
   assert.equal(input.date,date);
   controls.date.value="2026-11-09";
   context.nonce++; // The new date now owns a pending refresh.
   return {data:{version:1}};
  },
  get:async input=>{
   verifiedDate=input.date;
   return {data:{date,records:[{staffId:"staff",version:1,counts}]}};
  },
  refresh:()=>{releases++},notice:()=>assert.fail("stale success"),fail:e=>{throw e}
 });
 vm.runInContext(page.slice(page.indexOf("async function action(task)"),page.indexOf('$("addPrivateProduct").onclick'))+
  page.slice(page.indexOf('$("save").onclick='),page.indexOf("const setLoginMode=")),context);
 await controls.save.onclick();
 assert.equal(verifiedDate,date);
 assert.equal(releases,0);
 assert.equal(context.loading,true);
});

test("partner page has ONLY count fields and isolated callable; no browser finance/Firestore reads",()=>{
 assert.ok(page.includes("submitPartnerWorkspaceCounts"));
 assert.ok(page.includes("getPartnerWorkspace"));
 assert.ok(page.includes('id="countGrid"'));
 assert.ok(page.includes("保存・再取得照合が成功しました"));
 assert.ok(page.includes("await get({date:$(\"date\").value})"));
 assert.doesNotMatch(page,/firebase-firestore\.js|getFirestore\(|\bgetDoc\(|\bgetDocs\(|\brevenuePerUnit\b|\btotalRevenue\b|\bunitPrice\b|\bpricePerUnit\b/);
 assert.doesNotMatch(page,/\bformatYen\(|\b\u00a5\d|\\￥\d/);
 assert.match(page,/for\(const k of KEYS\)/);
 assert.match(page,/if\(start!==nonce\|\|!sameView\(\)\)return;\s*ownedNonce=start\+1;\s*await refresh\(\)/);
 assert.match(page,/if\(nonce===start\+1&&sameView\(\)&&typeof message==="string"&&data\)notice\(message\)/);
 assert.match(page,/const needsSetup=staff\.length===0/);
 assert.match(page,/inviteToken=""/);
 const clientKeys=page.match(/const KEYS=(\[[^;]+\]);/)[1];
 assert.deepEqual(JSON.parse(clientKeys),KEYS);
});

test("staff count API never returns monetary fields, accesses money originals or allows arbitrary products",()=>{
 assert.ok(service.includes('const KEYS=Object.freeze('));
 assert.ok(quick.includes('const KEYS=Object.freeze('));
 for(const t of [service,quick]){
  const keys=JSON.parse(t.match(/const KEYS=Object\.freeze\((\[[^;]+\])\);/)[1]);
  assert.deepEqual(keys,KEYS);
 }
 assert.doesNotMatch(service,/\.collection\(["'](?:products|records|recordCorrections|revenueGoals)["']\)/);
 assert.doesNotMatch(service,/\b(revenuePerUnit|totalRevenue|unitPrice|pricingOptions|targetRevenue)\s*:/);
 assert.match(service,/partners\.push\(\{partnerCompanyId:sn\.id,name:x\.partnerName,totalCount:total,counts\}\)/);
 assert.match(service,/rows\.push\(\{staffId:x\.staffId,counts,totalCount:total,version:x\.version,\s*teamIdSnapshot,workLocation,\\s*privateCounts:/);
 assert.match(service,/const teamIdSnapshot=ID\.test\(x\.teamIdSnapshot\|\|""\)\?x\.teamIdSnapshot:null/);
 assert.match(service,/if\(totalSnap\.exists&&existing\.source!=="staff-entries-v1"\)fail/);
 assert.match(service,/existing\.totalCount!==Object\.values\(previous\)/);
});

test("partner counts in existing ranking never add partner revenue or prices",()=>{
 const partner=app.slice(app.indexOf("function partnerRankingVirtualRecords()"),app.indexOf("function normalizedPartnerRankingLabel("));
 assert.match(partner,/revenuePerUnit:0/);
 assert.doesNotMatch(partner,/\btotalRevenue\b|\bunitPrice\b|\btotalPrice\b/);
 const team=app.slice(app.indexOf("function renderTeamRanking("),app.indexOf("function renderTeamRanking(")+2800);
 // The deployed app keeps company totals out of the real-team leaderboard.
 // Joint partner team counts belong to the verified count-only scoreboard.
 assert.match(team,/const ranking = sortTeamRankingRows\(originalRows,teamRankingMode\)/);
 assert.doesNotMatch(team,/quick-partner:|\bpartnerRows\b|partnerRankingState\.rows/);
 const products=app.slice(app.indexOf("function renderProductMemberRanking("),app.indexOf("function buildTeamRankingRows("));
 assert.ok(products.includes("partnerRankingVirtualRecords()"));
 assert.ok(products.includes("existingGroupsWithPartnerCounts(rankingGroups)"));
 assert.doesNotMatch(products,/\bformatYen\(|revenuePerUnit|unitPrice|totalRevenue/);
});
