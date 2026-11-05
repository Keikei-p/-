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
