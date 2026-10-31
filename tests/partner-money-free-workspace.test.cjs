"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs");
const page=fs.readFileSync(require("node:path").join(__dirname,"../partner-workspace.html"),"utf8");
const app=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");
const service=fs.readFileSync(require("node:path").join(__dirname,"../functions-partner-workspace/service.cjs"),"utf8");
const quick=fs.readFileSync(require("node:path").join(__dirname,"../functions-partner-quick/quick-counts.cjs"),"utf8");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];

test("partner page has ONLY count fields and isolated callable; no browser finance/Firestore reads",()=>{
 assert.ok(page.includes("submitPartnerWorkspaceCounts"));
 assert.ok(page.includes("getPartnerWorkspace"));
 assert.ok(page.includes('id="countGrid"'));
 assert.ok(page.includes("保存・再取得照合が成功しました"));
 assert.ok(page.includes("await get({date:$(\"date\").value})"));
 assert.doesNotMatch(page,/firebase-firestore\.js|getFirestore\(|\bgetDoc\(|\bgetDocs\(|\brevenuePerUnit\b|\btotalRevenue\b|\bunitPrice\b|\bpricePerUnit\b/);
 assert.doesNotMatch(page,/\bformatYen\(|\b\u00a5\d|\\￥\d/);
 assert.match(page,/for\(const k of KEYS\)/);
 assert.match(page,/const message=await task\(\);await refresh\(\)/);
 assert.match(page,/if\(typeof message==="string"&&data\)notice\(message\)/);
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
 assert.match(service,/rows\.push\(\{staffId:x\.staffId,counts,totalCount:total,version:x\.version\}\)/);
 assert.match(service,/if\(totalSnap\.exists&&existing\.source!=="staff-entries-v1"\)fail/);
 assert.match(service,/existing\.totalCount!==Object\.values\(previous\)/);
});

test("partner counts in existing ranking never add partner revenue or prices",()=>{
 const partner=app.slice(app.indexOf("function partnerRankingVirtualRecords()"),app.indexOf("function normalizedPartnerRankingLabel("));
 assert.match(partner,/revenuePerUnit:0/);
 assert.doesNotMatch(partner,/\btotalRevenue\b|\bunitPrice\b|\btotalPrice\b/);
 const team=app.slice(app.indexOf("function renderTeamRanking("),app.indexOf("function renderTeamRanking(")+2800);
 assert.match(team,/const partnerRows=teamRankingMode==="progress"/);
 assert.match(team,/count:row\.totalCount,revenue:0/);
 const products=app.slice(app.indexOf("function renderProductMemberRanking("),app.indexOf("function buildTeamRankingRows("));
 assert.ok(products.includes("partnerRankingVirtualRecords()"));
 assert.ok(products.includes("existingGroupsWithPartnerCounts(rankingGroups)"));
 assert.doesNotMatch(products,/\bformatYen\(|revenuePerUnit|unitPrice|totalRevenue/);
});
