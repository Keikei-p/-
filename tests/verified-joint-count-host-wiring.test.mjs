import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const owner=file("sales-archive.js");
const partner=file("partner-workspace.html");
const bridge=file("ranking/verified-joint-month-http-bridge.mjs");
const ownerFlag="const NICO_INTERNAL_JOINT_COUNT_MONTH_RELEASED=false;";
const partnerFlag="const NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false;";
const backend="https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking";
const moduleUrl="./ranking/verified-joint-month-http-bridge.mjs";
test("both original apps mount the exact same backend-verified count view, default OFF",()=>{
 assert(owner.includes(ownerFlag));
 assert(partner.includes(partnerFlag));
 assert(owner.includes("if(NICO_INTERNAL_JOINT_COUNT_MONTH_RELEASED){"));
 assert(partner.includes("if(!NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED||"));
 for(const source of [owner,partner]){
  assert(source.includes("mountVerifiedJointMonthCountDashboard"));
  assert(source.includes(moduleUrl));
  assert(source.includes(backend));
  assert(source.includes("availablePeriods")===false,
   "entry point must reuse period validation in the canonical bridge");
  assert(source.includes("onAuthStateChanged"));
 }
 assert.match(bridge,/availablePeriods:\["day","week","month"\],\s*allowFilters:expectedRole==="hub_owner"/);
});
test("partner cannot display owner rankings from company-code sessions or employee accounts",()=>{
 assert(partner.includes("activeCodeSession||data?.role!==\"owner\""));
 assert(partner.includes("auth.currentUser!==user||data?.role!==\"owner\""));
 assert(partner.includes("resetVerifiedJointMonth();"));
 assert(partner.includes("data=null;resetApprovedRanking();resetVerifiedJointMonth()"));
 assert(partner.includes("clearCompanySession();++nonce"));
 assert(partner.includes("nicoVerifiedPartnerJointCountMonth"));
 assert(!partner.includes("firebase-firestore.js"));
});
test("internal entry is already inside original dashboard and re-verifies active Owner",()=>{
 assert(owner.includes('document.getElementById("dashboard")'));
 assert(owner.includes("const verified=await companyForOwner(user)"));
 assert(owner.includes('window.location.origin!=="https://nico-factory.web.app"'));
 assert(owner.includes("mounted?.destroy();mounted=null;host.hidden=true;root.replaceChildren()"));
 assert(owner.includes("NICO_INTERNAL_JOINT_COUNT_MONTH_RELEASED=false"));
 assert(!owner.includes("localStorage.setItem(\"nicoVerified"));
});
test("partner module and internal module still parse; no original finance logic was replaced",()=>{
 const match=partner.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert(match);
 for(const [name,js] of [["partner",match[1]],["owner",owner]]){
  const result=spawnSync(process.execPath,["--check","--input-type=module"],{
   input:js,encoding:"utf8"
  });
  assert.equal(result.status,0,name+" has invalid JS: "+result.stderr);
 }
 const original=file("index.html");
 assert(original.includes("function persistDailyRecord("));
 assert(original.includes("function partnerRankingVirtualRecords("));
 const rules=file("firestore.rules");
 assert(rules.includes("match /records/{recordId}"));
 assert(rules.includes("match /products/{productId}"));
});
