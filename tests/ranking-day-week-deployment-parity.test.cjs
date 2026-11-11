"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const canonical=[
 "owner-visible-count-server-handler.mjs",
 "owner-visible-count-atomic-loader.mjs",
 "canonical-joint-count-sku-reader.mjs",
 "verified-two-month-count-input.mjs"
];
test("isolated ranking Functions vendor exactly matches all canonical two-month sources",()=>{
 for(const file of canonical){
  assert.equal(fs.readFileSync("functions-ranking-approvals/ranking/"+file,"utf8"),
   fs.readFileSync("ranking/"+file,"utf8"),
   "Cloud Functions must serve exact canonical code: "+file);
 }
 const endpoint=fs.readFileSync("functions-ranking-approvals/index.js","utf8");
 assert.match(endpoint,/getVerifiedJointCountRanking=onRequest/);
 assert.match(endpoint,/NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"/);
 assert.doesNotMatch(endpoint,/NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"\s*\|\|/);
});
test("day/week/month access stays identity-bound and cross-month uses one transaction",()=>{
 const source=fs.readFileSync("ranking/owner-visible-count-server-handler.mjs","utf8");
 const bridge=fs.readFileSync("ranking/verified-joint-month-http-bridge.mjs","utf8");
 const atomic=fs.readFileSync("ranking/owner-visible-count-atomic-loader.mjs","utf8");
 const reader=fs.readFileSync("ranking/canonical-joint-count-sku-reader.mjs","utf8");
 assert.match(source,/\["month","day","week"\]/);
 assert.match(source,/secondMonth:startMonth===month\?endMonth:startMonth/);
 assert.match(source,/loadAtomicVerifiedCountSnapshot\(\{month,context,secondMonth\}\)/);
 assert.match(source,/input:\{\.\.\.countInput,period,context\}/);
 assert.match(atomic,/loadCountsInTransaction\(\{tx,month,context,secondMonth\}\)/);
 assert.match(atomic,/readOnly:true/);
 assert.match(reader,/readCounts\(\{tx,month:secondMonth,context\}\)/);
 assert.match(reader,/mergeVerifiedTwoMonthInputs/);
 assert.match(bridge,/availablePeriods:\["day","week","month"\]/);
 assert.match(bridge,/period\.kind!=="week"/);
 const app=fs.readFileSync("index.html","utf8");
 const partner=fs.readFileSync("partner-workspace.html","utf8");
 assert.match(app,/NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=false/);
 assert.match(partner,/NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false/);
});
