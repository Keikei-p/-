"use strict";
// Synthetic/source-only release boundary checks. Never open Firebase or actual UID.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const {readLegacyGate}=require("../functions-partner-workspace/legacy-publication-policy.cjs");

test("legacy nine categories stay editable by default until independently authorized activation",()=>{
 const gate=readLegacyGate(null);
 assert.deepEqual(gate,{revision:0,mode:"legacy",effectiveFrom:null});
 const exportSource=read("functions-partner-workspace/index.js");
 const service=read("functions-partner-workspace/service.cjs");
 assert.match(exportSource,/NICO_LEGACY_COUNT_GATE_ACTIVATION==="approved"/);
 assert.match(service,/legacyGateActivationEnabled.*false/);
});

test("joint monthly individual rankings never merge Quick company-only reports into per-staff counts",()=>{
 const service=read("functions-partner-workspace/service.cjs");
 const start=service.indexOf("async function viewCombinedMonth(request)");
 const end=service.indexOf("async function submit(request)",start);
 assert(start>=0&&end>start);
 const section=service.slice(start,end);
 assert.match(section,/partnerWorkEntries/);
 assert.match(section,/projectSavedPartnerMonth/);
 assert.match(section,/projectCombinedMonth/);
 assert.doesNotMatch(section,/partnerQuickCountDays|partnerQuickInternetSplits/);
 const ranking=read("functions-partner-workspace/combined-saved-month-ranking.cjs");
 assert.match(ranking,/productionDocumentWrites:0/);
 assert.match(ranking,/provisional:true/);
});

test("company management and provisional rankings have bounded pagination; no silent 126th omission",()=>{
 const directory=read("functions-partner-workspace/owner-partner-count-operations.cjs");
 const rankingSource=read("functions-partner-workspace/service.cjs");
 const rank=read("functions-partner-workspace/combined-saved-month-ranking.cjs");
 const pages=read("functions-partner-workspace/bounded-ranking-relations.cjs");
 assert.match(directory,/const PAGE=25/);
 assert.match(directory,/startAfter\(cursor\)/);
 assert.match(rankingSource,/readBoundedRankingRelations\(db,hubId\)/);
 assert.match(rankingSource,/reviewedRows>10000/);
 assert.match(rank,/partners\.length>MAX_RANKING_COMPANIES/);
 assert.match(pages,/MAX_RANKING_COMPANIES=125/);
 assert.match(pages,/PAGE_SIZE=25/);
 assert.match(pages,/fail\("too_many_companies"\)/);
});

test("quick and staff read-only reconciliation never returns contract-confirmed merge authorization",()=>{
 const quick=read("functions-partner-quick/quick-counts.cjs");
 assert.match(quick,/quickIncludedInIndividualRanking:false/);
 assert.match(quick,/automaticMergeAllowed:false/);
 assert.match(quick,/contractIdentityVerified:false/);
 assert.match(quick,/status:same\?"totals_match_unverified":"different"/);
 assert.match(quick,/scope\.canCompareStaff\?/);
 assert.match(quick,/financialFieldsIncluded:false/);
});

test("official Hosting and Rules only deploy with explicit manual gates; no automatic main push",()=>{
 const hosting=read(".github/workflows/nico-factory-sync.yml");
 const rules=read(".github/workflows/firebase-production-deploy.yml");
 assert.match(hosting,/workflow_dispatch:/);
 assert.match(hosting,/CONFIRM_NICO_HOSTING_RELEASE/);
 assert.doesNotMatch(hosting,/^\s+push:/m);
 assert.match(rules,/workflow_dispatch:/);
 assert.match(rules,/VERIFIED_NICO_URL_AND_DATA/);
 assert.doesNotMatch(rules,/^\s+push:/m);
});
