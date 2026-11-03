"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
const api=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
test("monthly count-only callable is isolated from daily, hosted only in draft",()=>{
 assert.match(api,/exports\.getPartnerMonthlySharedCounts=onCall\(opts,service\.viewMonthly\)/);
 assert.match(service,/return Object\.freeze\(\{manage,accept,view,viewMonthly,submit/);
 assert.match(service,/async function viewMonthly\(request\)/);
 assert.match(service,/complete:false/);
 assert.match(service,/readDirectRangeCounts\(/);
});
test("owner sees month-vs-day and unchanged original sales ranking switches",()=>{
 for(const id of ["ownerJointIndividualMonthButton","ownerJointProductMonthButton",
  "ownerJointIndividualMonth","ownerJointProductMonth",
  "ownerOriginalIndividualButton","ownerOriginalProductButton"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/readPartnerMonthlySharedCounts = httpsCallable/);
 assert.match(html,/loadOwnerMonthlySharedRanks\(which\)/);
 assert.match(html,/ownerJointIndividualPeriod="day"/);
 assert.match(html,/ownerJointProductPeriod="day"/);
 assert.match(html,/ownerJointIndividualPeriod="month"/);
 assert.match(html,/ownerJointProductPeriod="month"/);
 assert.match(html,/ownerJointProductMode=false/);
 assert.match(html,/ownerJointIndividualMode=false/);
});
test("partner shares same provisional month rank panels; no separate sales DOM",()=>{
 for(const id of ["partnerSharedRankingsMonthButton","partnerSharedRankingsMonth",
  "partnerSharedRankingsRefresh","partnerSharedRankingContent"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/async function loadPartnerMonthlySharedRankings/);
 assert.match(html,/partnerSharedRankPeriod="day"/);
 assert.match(html,/partnerSharedRankPeriod="month"/);
 assert.match(html,/payload\.workspaceCompanyId=partnerInlineWorkspaceCompany/);
 assert.match(html,/response\.role!=="partner"/);
 assert.match(html,/appendSharedRankingRows\(content,headings\[selected\],rows\[selected\],false\)/);
 assert.match(html,/暫定.*位/);
});
test("monthly UI opts in manually, limits repeated paid reads and invalidates stale requests",()=>{
 assert.match(html,/ownerMonthlyRankCache=new Map/);
 assert.match(html,/Date\.now\(\)-old\.checkedAt<180000/);
 assert.match(html,/\+\+sharedDailyRankingGeneration/);
 assert.match(html,/partnerRowsVerified>10000/);
 assert.match(html,/月間の件数を照合できません/);
});
