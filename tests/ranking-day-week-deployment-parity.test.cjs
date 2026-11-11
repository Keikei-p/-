"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const root="ranking/owner-visible-count-server-handler.mjs";
const vendor="functions-ranking-approvals/ranking/owner-visible-count-server-handler.mjs";

test("deployed ranking Functions vendor matches canonical verified period handler exactly",()=>{
 assert.equal(fs.readFileSync(vendor,"utf8"),fs.readFileSync(root,"utf8"),
  "Cloud Functions must serve the exact canonical day/week/month code");
 const endpoint=fs.readFileSync("functions-ranking-approvals/index.js","utf8");
 assert.match(endpoint,/getVerifiedJointCountRanking=onRequest/);
 assert.match(endpoint,/NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"/);
 assert.doesNotMatch(endpoint,/NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"\s*\|\|/);
});

test("all day/week/month inputs must remain server-verified and no cross-month week fallback",()=>{
 const source=fs.readFileSync(root,"utf8");
 const bridge=fs.readFileSync("ranking/verified-joint-month-http-bridge.mjs","utf8");
 assert.match(source,/\["month","day","week"\]/);
 assert.match(source,/sunday\.toISOString\(\)\.slice\(0,7\)!==month/);
 assert.match(source,/const pair=await loadAtomicVerifiedCountSnapshot\(\{month,context\}\)/);
 assert.match(source,/input:\{\.\.\.countInput,period,context\}/);
 assert.match(bridge,/availablePeriods:\["day","week","month"\]/);
 assert.match(bridge,/if\(start\.slice\(0,7\)!==month\|\|last\.slice\(0,7\)!==month\)stop\(\)/);
 const app=fs.readFileSync("index.html","utf8");
 const partner=fs.readFileSync("partner-workspace.html","utf8");
 assert.match(app,/NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=false/);
 assert.match(partner,/NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false/);
});
