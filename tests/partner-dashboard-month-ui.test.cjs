"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {spawnSync}=require("node:child_process");
const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
test("the actual partner dashboard's inline JavaScript parses as a module, without Firebase or network",()=>{
 const blocks=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(x=>!/\bsrc\s*=/i.test(x[1]));
 assert.ok(blocks.length>0,"HTML must contain inline app source");
 let sawDashboard=false;
 for(const [,attrs,source] of blocks){
  if(!source.trim())continue;
  const isModule=/\btype\s*=\s*["']module["']/i.test(attrs);
  const check=spawnSync(process.execPath,[
   "--check",...(isModule?["--input-type=module"]:[]
   )],{input:source,encoding:"utf8",maxBuffer:2*1024*1024});
  assert.equal(check.status,0,(check.stderr||check.error?.message||"").slice(0,2000));
  if(source.includes("async function loadPartnerDashboardMonth"))sawDashboard=true;
 }
 assert.equal(sawDashboard,true,"monthly dashboard must be wired into actual app source");
});
test("October/November global picker and day input are independent; no panel removed",()=>{
 for(const id of [
  "pInlineDashboardMonth","pInlineDashboardMonthRefresh","pPartnerMonthCount",
  "pPartnerMonthStaffCount","pPartnerMonthTeamCount","pPartnerMonthStatus",
  "partnerMonthlyTeamDetails","partnerMonthlyTeamStatus","pInlineTeamDetails",
  "pInlineDate","pInlineRecordDate","pInlineSave","pInlineHistory",
  "partnerSharedRankingsMonth","partnerProductMonth","partnerCatalogMonth"
 ])assert.match(html,new RegExp('id="'+id+'"'),"missing original or new "+id);
 assert.match(html,/pInline\("pInlineDashboardMonth"\)\.onchange/);
 assert.match(html,/for\(const id of \["partnerSharedRankingsMonth","partnerProductMonth","partnerCatalogMonth"\]\)/);
 assert.match(html,/readPartnerMonthlyTeamDetails\(partnerInlinePayload\(\{month\}\)\)/);
 assert.match(html,/partnerInlineData!==snap/,"stale response must not cross company/date snapshots");
 assert.match(html,/month!==pInline\("pInlineDashboardMonth"\)\.value/);
 assert.match(html,/void loadPartnerDashboardMonth\(\)/);
 assert.match(html,/partnerCompactWireTeamSelection\(results\)/);
 assert.match(html,/renderPartnerCountTeamCard\(team\.name\+"\|"\+data\.month/);
 assert.match(html,/pInline\("partnerSharedRankingsMonth"\)\.value=/);
 assert.match(html,/partnerSharedRankPeriod="month"/);
 assert.match(html,/partnerSameAppSelectedPanel/);
});
