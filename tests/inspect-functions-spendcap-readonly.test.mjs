import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectSpendCap,BILLING_INFO,PROJECT,PROJECT_NUMBER,SERVICE} from
 "../tools/production/inspect-functions-spendcap-readonly.mjs";
const account="billingAccounts/000000-111111-222222";
const response=(status,body)=>({status,json:async()=>body});
const billing={name:"projects/"+PROJECT+"/billingInfo",billingEnabled:true,
 billingAccountName:account};
const cap=(state="CONFIGURED",patch={})=>({
 name:account+"/budgets/SENSITIVE-NAME",
 displayName:"Do not log this private budget",
 budgetFilter:{
  projects:["projects/"+PROJECT_NUMBER],services:[SERVICE],
  creditTypesTreatment:"EXCLUDE_ALL_CREDITS",calendarPeriod:"MONTH"
 },
 amount:{specifiedAmount:{currencyCode:"JPY",units:"19999"}},
 thresholdRules:[{thresholdPercent:0.5},{thresholdPercent:0.8},{thresholdPercent:1}],
 spendCap:{outputState:state},
 ...patch
});
const reader=({billingStatus=200,budgetStatus=200,budgets=[cap()],pages=[]}={})=>{
 const calls=[];
 const read=async url=>{
  calls.push(url);
  if(url===BILLING_INFO)return response(billingStatus,billing);
  if(!url.startsWith("https://billingbudgets.googleapis.com/v1/"+account+"/budgets?"))
   throw Error("wrong URL");
  if(pages.length){const page=pages.shift();return response(budgetStatus,page);}
  return response(budgetStatus,{budgets});
 };
 return {read,calls};
};
test("verified exact project + service spend cap is only observational, never zero-bill approval",async()=>{
 const x=reader();const report=await inspectSpendCap(x.read);
 assert.equal(report.projectServiceSpendCapVerified,true);
 assert.equal(report.spendCapConfigured,true);
 assert.equal(report.spendCapEnforced,false);
 assert.equal(report.spendCapIsHardGuarantee,false);
 assert.equal(report.releaseAuthorized,false);
 assert.equal(report.productionWrites,0);
 assert.equal(report.mayPauseExistingSalesAndLineFunctions,true);
 const shown=JSON.stringify(report);
 for(const secret of ["000000-111111-222222","19999","SENSITIVE-NAME",
  "Do not log","token","@example.test"])
  assert.equal(shown.includes(secret),false,secret);
 assert.equal(x.calls.length,2);
 assert.ok(x.calls.every(url=>url.startsWith("https://")));
});
test("other service, other company, wider scope and alerts-only do NOT certify Cloud Run cap",async()=>{
 const cases=[
  cap("CONFIGURED",{budgetFilter:{...cap().budgetFilter,
   projects:["projects/other"]}}),
  cap("CONFIGURED",{budgetFilter:{...cap().budgetFilter,
   services:["services/other"]}}),
  cap("CONFIGURED",{budgetFilter:{...cap().budgetFilter,
   projects:["projects/"+PROJECT_NUMBER,"projects/other"]}}),
  cap("CONFIGURED",{budgetFilter:{...cap().budgetFilter,
   creditTypesTreatment:"INCLUDE_ALL_CREDITS"}}),
  cap("CONFIGURED",{spendCap:undefined}),
  cap("CONFIGURED",{budgetFilter:{...cap().budgetFilter,
   calendarPeriod:"YEAR"}})
 ];
 for(const row of cases){
  const report=await inspectSpendCap(reader({budgets:[row]}).read);
  assert.equal(report.projectServiceSpendCapVerified,false);
  assert.equal(report.releaseAuthorized,false);
 }
});
test("ENFORCED means all Cloud Run usage may be paused; LIFTED means no active cap",async()=>{
 const enforced=await inspectSpendCap(reader({budgets:[cap("ENFORCED")]}).read);
 assert.equal(enforced.spendCapEnforced,true);
 assert.equal(enforced.spendCapConfigured,false);
 assert.equal(enforced.mayPauseExistingSalesAndLineFunctions,true);
 const lifted=await inspectSpendCap(reader({budgets:[cap("LIFTED")]}).read);
 assert.equal(lifted.spendCapLifted,true);
 assert.equal(lifted.spendCapConfigured,false);
 assert.equal(lifted.releaseAuthorized,false);
});
test("permission denial is reported without leaking billing account, never guessed as configured",async()=>{
 const deniedBilling=await inspectSpendCap(reader({billingStatus:403}).read);
 assert.equal(deniedBilling.budgetInventoryReadable,false);
 assert.equal(deniedBilling.projectServiceSpendCapVerified,false);
 const deniedBudget=await inspectSpendCap(reader({budgetStatus:403}).read);
 assert.equal(deniedBudget.budgetInventoryReadable,false);
 assert.equal(deniedBudget.reason,"BUDGET_LIST_PERMISSION_DENIED");
});
test("pagination is bounded and cannot claim partial cap success",async()=>{
 const page=()=>({budgets:[cap()],nextPageToken:"token_"+Math.random()});
 const x=reader({pages:[{budgets:[cap()],nextPageToken:"pageTwo"},{budgets:[]}]});
 const report=await inspectSpendCap(x.read);
 assert.equal(report.spendCapConfigured,true);
 assert.equal(x.calls.length,3);
 const tooMany=reader({pages:[
  {budgets:[cap()],nextPageToken:"a"},{budgets:[],nextPageToken:"b"},
  {budgets:[],nextPageToken:"c"}
 ]});
 await assert.rejects(inspectSpendCap(tooMany.read),/STOP_NICO_SPENDCAP_READONLY_PAGINATION_LIMIT/);
 const repeated=reader({pages:[
  {budgets:[],nextPageToken:"repeat"},
  {budgets:[],nextPageToken:"repeat"}
 ]});
 await assert.rejects(inspectSpendCap(repeated.read),/STOP_NICO_SPENDCAP_READONLY_PAGINATION_UNTRUSTED/);
});
test("malformed JSON and mismatching billing identity stop without writes",async()=>{
 await assert.rejects(inspectSpendCap(async()=>response(200,{name:"wrong",billingEnabled:true})),
  /STOP_NICO_SPENDCAP_READONLY_BILLING_IDENTITY/);
 await assert.rejects(inspectSpendCap(reader({budgets:Array.from({length:101},()=>cap())}).read),
  /STOP_NICO_SPENDCAP_READONLY_BUDGET_LIST_SCHEMA/);
 await assert.rejects(inspectSpendCap(async()=>{throw Error("sensitive remote body")}),
  /STOP_NICO_SPENDCAP_READONLY_NETWORK_UNVERIFIED/);
});
test("no deploy, no billing mutations, no Firebase data writes or captured secrets",()=>{
 const s=readFileSync(new URL("../tools/production/inspect-functions-spendcap-readonly.mjs",import.meta.url),"utf8");
 assert.match(s,/method:"GET"/);
 assert.match(s,/CLOUD_BILLING_SPEND_CAP_GET_ONLY/);
 assert.match(s,/releaseAuthorized:false/);
 assert.doesNotMatch(s,/method:"(?:POST|PUT|PATCH|DELETE)"|firebase deploy|\.set\(|\.update\(|\.delete\(/);
});

test("manual GET-only spendcap recheck fails closed on unreadable Billing inventory",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/nico-functions-spendcap-readonly-20261107.yml",import.meta.url),"utf8");
 assert.match(workflow,/\n  workflow_dispatch:\n/);
 assert.match(workflow,/github.event_name == 'workflow_dispatch'/);
 assert.match(workflow,/github.repository == 'Keikei-p\/\-'/);
 assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/"budgetInventoryReadable":true/);
 assert.match(workflow,/BLOCK_SPENDCAP_INVENTORY_UNREADABLE/);
 assert.match(workflow,/SPENDCAP_INVENTORY_READ_SUCCESS_NO_DEPLOY_AUTHORIZATION/);
 assert.match(workflow,/\bPRODUCTION_FUNCTION_DEPLOYS=0\b/);
 assert.doesNotMatch(workflow,/firebase deploy|gcloud functions deploy|method:"(?:POST|PATCH|DELETE)"/);
});
