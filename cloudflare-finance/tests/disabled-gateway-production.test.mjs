import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";

const requiredOff=[
  "FINANCE_GATEWAY_ENABLED","FINANCE_WRITE_ENABLED",
  "INTERNAL_COUNT_PAGE_ENABLED","INTERNAL_RANKS_ENABLED",
  "PARTNER_COUNT_WRITE_ENABLED","PARTNER_COUNT_CATALOG_ENABLED",
  "PUBLIC_COUNT_GATEWAY_ENABLED"
];
function flags(){
 const config=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 for(const flag of requiredOff){
  assert.match(config,new RegExp("^"+flag+' = "disabled"$',"m"),
    "STOP: finance feature flag must remain OFF: "+flag);
 }
 for(const flag of ["FINANCE_COST_APPROVAL","FINANCE_WRITE_APPROVAL",
  "FINANCE_PARTNER_APPROVAL","PUBLIC_COUNT_PROJECTION_APPROVAL"])
  assert.match(config,new RegExp("^"+flag+' = "NOT_APPROVED"$',"m"),
    "STOP: cost/write/partner approvals cannot be faked: "+flag);
 assert.match(config,/^name = "sales-finance-gateway"$/m);
 assert.match(config,/^main = "src\/index.js"$/m);
 assert.match(config,/^workers_dev = true$/m);
}
test("finance Worker may be deployed as an inert endpoint; all switches OFF",flags);
test("offline Worker health identifies correct service, no fees or secrets needed",async()=>{
 const r=await worker.fetch(new Request("https://sales-finance-gateway.jyhokei0124.workers.dev/health"),{
  FIREBASE_PROJECT_ID:"sales-management-cc116",FINANCE_GATEWAY_ENABLED:"disabled",
  FINANCE_WRITE_ENABLED:"disabled",FINANCE_COST_APPROVAL:"NOT_APPROVED"
 });
 assert.equal(r.status,200);
 const answer=await r.json();
 assert.equal(answer.service,"finance-gateway");
 assert.equal(answer.enabled,false);
 assert.equal(answer.mode,"read_only");
 assert.doesNotMatch(JSON.stringify(answer),/private_key|client_email|token|revenuePerUnit/);
});
test("deployment cannot open finance/count-rank endpoints or contact Google",async()=>{
 const env={
  FIREBASE_PROJECT_ID:"sales-management-cc116",
  FINANCE_GATEWAY_ENABLED:"disabled",FINANCE_WRITE_ENABLED:"disabled",
  INTERNAL_COUNT_PAGE_ENABLED:"disabled",INTERNAL_RANKS_ENABLED:"disabled",
  PARTNER_COUNT_WRITE_ENABLED:"disabled",
  PARTNER_COUNT_CATALOG_ENABLED:"disabled",
  FINANCE_COST_APPROVAL:"NOT_APPROVED"
 };
 const url="https://sales-finance-gateway.jyhokei0124.workers.dev";
 for(const [path,method] of [
  ["/v1/internal-ranks?month=2026-10","GET"],
  ["/v1/internal-counts?day=2026-10-30","GET"],
  ["/v1/financial-view","GET"],
  ["/v1/partner-count-catalog","GET"],
  ["/v1/count-record","POST"]
 ]){
  const resp=await worker.fetch(new Request(url+path,{method}),env);
  assert.equal(resp.status,503,path+": MUST NOT be enabled");
  const body=await resp.text();
  assert.doesNotMatch(body,/token|private_key|totalRevenue|revenuePerUnit|unitPrice/i);
 }
});
test("production baseline probe refuses any active finance Worker / changed code",()=>{
 const file=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 assert.match(file,/url\.pathname==="\/health"/);
 assert.match(file,/FINANCE_GATEWAY_ENABLED==="enabled"/);
 assert.doesNotMatch(file,/\/health[\s\S]*?firebase\s+deploy/);
});
