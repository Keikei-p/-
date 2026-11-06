"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
function between(begin,end){
 const start=app.indexOf(begin);
 assert(start>=0,"missing "+begin);
 const last=app.indexOf(end,start+begin.length);
 assert(last>start,"missing end "+end);
 return app.slice(start,last);
}
const daily=between("let sharedDailyRankingGeneration=0;","let partnerSharedRankPeriod=");
const month=between("const ownerMonthlyRankCache=new Map();","let ownerJointIndividualPeriod=");
function harness(){
 const box={Map};vm.createContext(box);
 vm.runInContext(daily+"\n"+month,box);
 const call=x=>vm.runInContext(x,box);
 return {call};
}
const deferred=()=>{
 let resolve;
 const promise=new Promise(done=>{resolve=done;});
 return {promise,resolve};
};
test("individual and product daily rank reads both complete independently, out of order",async()=>{
 const h=harness(),a=h.call('beginSharedDailyRankRequest("Individual")'),
  b=h.call('beginSharedDailyRankRequest("Product")');
 const aa=deferred(),bb=deferred(),rendered=[];
 const x=aa.promise.then(()=>{if(h.call('currentSharedDailyRankRequest')(a))rendered.push("individual");});
 const y=bb.promise.then(()=>{if(h.call('currentSharedDailyRankRequest')(b))rendered.push("product");});
 bb.resolve();await y;
 aa.resolve();await x;
 assert.deepEqual(rendered,["product","individual"]);
});
test("same rank card rejects earlier, slow stale response, but other card survives",async()=>{
 const h=harness();
 const previous=h.call('beginSharedDailyRankRequest("Individual")');
 const other=h.call('beginSharedDailyRankRequest("Product")');
 const newer=h.call('beginSharedDailyRankRequest("Individual")');
 assert.equal(h.call('currentSharedDailyRankRequest')(previous),false);
 assert.equal(h.call('currentSharedDailyRankRequest')(newer),true);
 assert.equal(h.call('currentSharedDailyRankRequest')(other),true);
});
test("different monthly individual, product and partner requests do not cancel one another",()=>{
 const h=harness();
 const a=h.call('beginOwnerMonthlyRankRequest("Individual")');
 const b=h.call('beginOwnerMonthlyRankRequest("Product")');
 const c=h.call('beginOwnerMonthlyRankRequest("partner")');
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(a),true);
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(b),true);
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(c),true);
 h.call('beginOwnerMonthlyRankRequest("Product")');
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(a),true);
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(b),false);
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(c),true);
});
test("day-to-month switch invalidates only that person's daily card",()=>{
 const h=harness(),individual=h.call('beginSharedDailyRankRequest("Individual")'),
  product=h.call('beginSharedDailyRankRequest("Product")');
 h.call('beginOwnerMonthlyRankRequest("Individual")');
 h.call('beginSharedDailyRankRequest("Individual")');
 assert.equal(h.call('currentSharedDailyRankRequest')(individual),false);
 assert.equal(h.call('currentSharedDailyRankRequest')(product),true);
});
test("sign out, account switch, or persisted count write invalidates ALL pending lanes",()=>{
 const h=harness(),individual=h.call('beginSharedDailyRankRequest("Individual")'),
  product=h.call('beginSharedDailyRankRequest("Product")'),
  month=h.call('beginOwnerMonthlyRankRequest("partner")');
 h.call("++sharedDailyRankingGeneration;++ownerMonthlyRankGeneration");
 assert.equal(h.call('currentSharedDailyRankRequest')(individual),false);
 assert.equal(h.call('currentSharedDailyRankRequest')(product),false);
 assert.equal(h.call('currentOwnerMonthlyRankRequest')(month),false);
});
test("the UI actually wires independent day and month tokens to their await guards",()=>{
 const read=between("async function loadSharedDailyStandings(","// Explicit opt-in monthly count mode.");
 assert.match(read,/rankToken=beginSharedDailyRankRequest\(where\)/);
 assert.equal(read.split("currentSharedDailyRankRequest(rankToken)").length-1,2);
 assert.doesNotMatch(read,/seq!==sharedDailyRankingGeneration/);
 const loadOwner=between("async function loadOwnerMonthlySharedRanks(","const ownerJointIndividualDate=");
 assert.match(loadOwner,/beginOwnerMonthlyRankRequest\(which\)/);
 assert.match(loadOwner,/beginSharedDailyRankRequest\(which\)/);
 assert.equal(loadOwner.split("currentOwnerMonthlyRankRequest(rankToken)").length-1,2);
 const partner=between("async function loadPartnerMonthlySharedRankings(","const partnerSharedRankingsMonth=");
 assert.match(partner,/beginOwnerMonthlyRankRequest\("partner"\)/);
 assert.match(partner,/beginSharedDailyRankRequest\("partner"\)/);
 assert.equal(partner.split("currentOwnerMonthlyRankRequest(rankToken)").length-1,2);
 assert.doesNotMatch(partner,/seq!==ownerMonthlyRankGeneration/);
});
test("original company revenue ranking, finance permissions and protected data writes remain unchanged",()=>{
 for(const marker of [
  'function renderIndividualRanking(', 'function renderProductMemberRanking(',
  'canCurrentUserViewRevenue()', 'function canReadSharedCountOnlyRanks()'
 ])assert(app.includes(marker),marker);
 const reset=between("function resetPartnerInline(){","function ");
 assert.match(reset,/\+\+sharedDailyRankingGeneration;\+\+ownerMonthlyRankGeneration/);
 assert.match(app,/sharedDailyRankCache\.clear\(\);ownerMonthlyRankCache\.clear\(\)/);
 assert.equal((app.match(/\+\+sharedDailyRankingGeneration;\+\+ownerMonthlyRankGeneration/g)||[]).length,3);
});


test("November can read October staff-ledger counts without invalid older quick calls or fake finalized ranks",async()=>{
 // Only synthetic responses: no Firebase, Auth, finance originals or writes.
 const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
  "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const row=(changes={})=>{
  const counts=Object.fromEntries(KEYS.map(key=>[key,changes[key]||0]));
  return {partnerCompanyId:"partnerA",name:"協力店A",counts,
   totalCount:Object.values(counts).reduce((a,b)=>a+b,0)};
 };
 const quickCalls=[],staffCalls=[];
 const ctx={
  PARTNER_QUICK_RANK_KEYS:KEYS,
  getTodayString:()=>"2026-11-06",
  currentPartnerRankingKey:month=>"owner|hub|"+month,
  partnerRankingDailyCache:new Map(),
  readPartnerQuickDay:async({date})=>{
   quickCalls.push(date);
   if(date<"2026-10-06")throw Error("legacy_quick_date_outside_31_days");
   return {data:{role:"hub",date,partners:date==="2026-10-20"?
    [row({NURO:9})]:[]}};
  },
  readPartnerWorkDay:async({date})=>{
   staffCalls.push(date);
   return {data:{role:"hub",date,
    partners:date==="2026-10-02"?[row({NURO:3})]:
     date==="2026-10-20"?[row({NURO:2})]:[],
    registeredCompanies:[{partnerCompanyId:"partnerA",active:true}]}};
  }
 };
 vm.createContext(ctx);
 vm.runInContext(between("function validatedPartnerRankingDay(",
  "function renderOwnerPartnerMonthlyPendingCounts(){"),ctx);
 const october=await vm.runInContext('readPartnerRankingMonth("2026-10")',ctx);
 assert.equal(staffCalls.length,31,"all October dates must be checked");
 assert.equal(quickCalls.length,26,"only Oct 6–31 may call the 31-day endpoint");
 assert(quickCalls.every(date=>date>="2026-10-06"));
 assert.equal(october.complete,false,
  "missing historic quick-only reports must never be certified as zero");
 assert.equal(october.rows.length,1);
 assert.equal(october.rows[0].totalCount,5,
  "3 early staff counts + 2 recent staff counts, not extra legacy 9");
 const cached=await vm.runInContext('readPartnerRankingMonth("2026-10")',ctx);
 assert.equal(cached.rows[0].totalCount,5);
 assert.equal(staffCalls.length,31,"historical ledger cache avoids repeat reads");
 assert.equal(quickCalls.length,26);
 const ancient=await vm.runInContext('readPartnerRankingMonth("2025-09")',ctx);
 assert.equal(ancient.complete,false);
 assert.equal(ancient.rows.length,0);
 assert.equal(staffCalls.length,31,"outside 366 days must not call either API");
});


test("legacy quick outage preserves verified staff totals only as provisional, not fictitious zero",async()=>{
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
  "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const counts=Object.fromEntries(keys.map(k=>[k,k==="NURO"?4:0]));
 const row={partnerCompanyId:"p1",name:"協力店A",counts,totalCount:4};
 let quickCalls=0,staffCalls=0;
 const context={
  PARTNER_QUICK_RANK_KEYS:keys,
  getTodayString:()=>"2026-11-06",
  readPartnerQuickDay:async()=>{quickCalls++;throw Error("legacy_quick_unavailable");},
  readPartnerWorkDay:async({date})=>{staffCalls++;return {data:{
   role:"hub",date,partners:[row],
   registeredCompanies:[{partnerCompanyId:"p1",active:true}]
  }};}
 };
 vm.createContext(context);
 vm.runInContext(between("function validatedPartnerRankingDay(",
   "async function readPartnerRankingMonth("),context);
 const provisional=await vm.runInContext('mergedPartnerRankingDay("2026-11-06")',context);
 assert.equal(quickCalls,1);
 assert.equal(staffCalls,1);
 assert.equal(provisional.length,1);
 assert.equal(provisional[0].totalCount,4);
 assert.equal(provisional.coverageComplete,false,"quick-only unknown entries cannot certify rank");
 assert.equal(provisional[0].counts.NURO,4);
 // A genuinely invalid quick response must never be silently accepted
 // as an outage. It could mix a wrong company's counts into a live rank.
 context.readPartnerQuickDay=async({date})=>({data:{
  role:"hub",date,partners:[{...row,totalCount:999}]
 }});
 await assert.rejects(vm.runInContext('mergedPartnerRankingDay("2026-11-06")',context),
  /partner_quick_sum_mismatch/);
 // Staff endpoint failure is fatal, not silently replaced by legacy counts.
 context.readPartnerWorkDay=async()=>{throw Error("staff_read_denied");};
 await assert.rejects(vm.runInContext('mergedPartnerRankingDay("2026-11-06")',context),
  /staff_read_denied/);
});


test("overlapping old and staff day rows remain distinct audit claims, never confirmed ranks",async()=>{
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
  "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const row=changes=>{
  const counts=Object.fromEntries(keys.map(k=>[k,changes[k]||0]));
  return {partnerCompanyId:"partner",name:"協力店",counts,
   totalCount:Object.values(counts).reduce((a,b)=>a+b,0)};
 };
 const old=row({NURO:9}),staff=row({NURO:2,"つばさ・HTB":3});
 const ctx={
  PARTNER_QUICK_RANK_KEYS:keys,
  getTodayString:()=>"2026-11-06",
  readPartnerQuickDay:async({date})=>({data:{role:"hub",date,partners:[old]}}),
  readPartnerWorkDay:async({date})=>({data:{role:"hub",date,partners:[staff],
   registeredCompanies:[{partnerCompanyId:"partner",active:true}]}})
 };
 vm.createContext(ctx);
 vm.runInContext(between("function validatedPartnerRankingDay(",
  "async function readPartnerRankingMonth("),ctx);
 const read=()=>vm.runInContext('mergedPartnerRankingDay("2026-11-06")',ctx);
 const disputed=await read();
 assert.equal(disputed.length,1,"do not add the same company twice");
 assert.equal(disputed[0].totalCount,5,"staff ledger is the current shown count");
 assert.equal(disputed.legacyOverlapRows,1,"record discrepancy instead of discarding it");
 assert.equal(disputed.legacyOverlapCount,9,"old 9 are still available for review");
 assert.equal(disputed.coverageComplete,false,"never publish finalized rank with conflicting input");
 // An equal total with a different product breakdown also requires review.
 ctx.readPartnerQuickDay=async({date})=>({data:{role:"hub",date,
  partners:[row({SBMNP:5})]}});
 const sameTotal=await read();
 assert.equal(sameTotal.legacyOverlapRows,1);
 assert.equal(sameTotal.legacyOverlapCount,5);
 assert.equal(sameTotal.coverageComplete,false);
 // Reconciled exact products/counts are not flagged as conflicting.
 ctx.readPartnerQuickDay=async({date})=>({data:{role:"hub",date,partners:[staff]}});
 const equal=await read();
 assert.equal(equal.legacyOverlapRows,0);
 assert.equal(equal.legacyOverlapCount,0);
 assert.equal(equal.coverageComplete,true);
});
