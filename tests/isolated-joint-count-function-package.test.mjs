import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createCanonicalOwnerCountHandler}
 from "../functions-ranking-approvals/ranking/canonical-owner-count-server-factory.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const graph=[
 "ranking/canonical-owner-count-server-factory.mjs",
 "ranking/owner-visible-count-server-handler.mjs",
 "ranking/owner-visible-count-atomic-loader.mjs",
 "ranking/canonical-joint-count-sku-reader.mjs",
 "ranking/owner-product-visibility-in-atomic-tx.mjs",
 "ranking/trusted-combined-ranking-context.mjs",
 "ranking/owner-product-visibility-firestore.mjs",
 "ranking/owner-product-visibility-rankings.mjs",
 "ranking/internal-month-count-tx-reader.mjs",
 "ranking/partner-month-readonly-loader.mjs",
 "ranking/verified-dual-count-dashboards.mjs",
 "ranking/partner-workspace-count-source.mjs",
 "security/public-projection.mjs"
];
test("isolated callable package has all 13 canonical dependencies, unmodified",()=>{
 for(const p of graph){
  const canonical=path.join(root,p);
  const vendored=path.join(root,"functions-ranking-approvals",p);
  assert(fs.existsSync(canonical),"missing original "+p);
  assert(fs.existsSync(vendored),"missing staged vendor "+p);
  assert.equal(fs.readFileSync(vendored,"utf8"),
   fs.readFileSync(canonical,"utf8"),"source-vendor drift "+p);
 }
});
test("existing functions have only one additive OFF-by-default count-only export",()=>{
 const source=fs.readFileSync(path.join(root,"functions-ranking-approvals/index.js"),"utf8");
 assert.equal(source.split("exports.getVerifiedJointCountRanking=").length,2);
 assert.match(source,/NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"/);
 assert.match(source,/createJointCountHttpAdapter\(/);
 assert.match(source,/region:"asia-northeast1",maxInstances:2,concurrency:10,cors:false/);
 assert.match(source,/exports.getOwnerProductVisibility=onCall/);
 assert.match(source,/exports.setOwnerProductVisibility=onCall/);
 assert.match(source,/exports.getRankingOwnerConsentStatus=onCall/);
 assert.match(source,/exports.setRankingOwnerConsent=onCall/);
 assert(!source.includes("NICO_JOINT_COUNT_RANKING_ENABLED=true"));
 assert(!source.includes("setDoc("));
 assert(!source.includes("deleteDoc("));
});
test("unregistered canonical handler is fully offline without Firebase dependencies",async()=>{
 const handler=createCanonicalOwnerCountHandler();
 const request=new Request(
  "https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11",{
  headers:{Authorization:"Bearer "+"a".repeat(40),
   Origin:"https://nico-factory.web.app"}
 });
 const res=await handler(request);
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{error:"service_disabled"});
 assert.equal(res.headers.get("cache-control"),"no-store");
});
test("unverified server dependencies cannot accidentally enable counting",()=>{
 assert.throws(()=>createCanonicalOwnerCountHandler({enabled:true}),
  /CANONICAL_OWNER_COUNT_AUTH_MISSING/);
});
test("default Firebase project rules and original live Function source are unchanged by stage package",()=>{
 const project=JSON.parse(fs.readFileSync(path.join(root,"firebase.json"),"utf8"));
 assert.equal(project.firestore.rules,"firestore.rules");
 assert(!Object.hasOwn(project,"functions"));
 const stage=JSON.parse(fs.readFileSync(path.join(root,"firebase.ranking-approvals.json"),"utf8"));
 assert.equal(stage.functions.source,"functions-ranking-approvals");
 assert.equal(stage.functions.codebase,"ranking-owner-approvals");
 const out=fs.readFileSync(path.join(root,"functions-ranking-approvals/index.js"),"utf8");
 assert(!out.includes("functions-partner-workspace"));
});
