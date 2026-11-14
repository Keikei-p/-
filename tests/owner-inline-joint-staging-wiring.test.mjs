import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const archive=read("../sales-archive.js");
const index=read("../index.html");
const start=archive.indexOf("const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false;");
assert.ok(start>0,"Owner count integration must remain explicitly OFF");
const staging=archive.slice(start);

test("Owner existing ranking cards and original financial UI stay untouched",()=>{
 for(const id of ["individualRankingContent","productRankingContent","teamRankingContent","dashboardMonth"])
  assert.ok(index.includes('id="'+id+'"'),"Missing original dashboard target "+id);
 assert.ok(staging.includes('const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false'));
 assert.ok(staging.includes('slot.panel'));
 assert.ok(staging.includes('$(slot.panel).append(card)'));
 assert.ok(!staging.includes('getDocsFromServer('));
 assert.ok(!staging.includes('totalRevenue'));
 assert.ok(!staging.includes('recordCorrections'));
 assert.ok(!staging.includes('monthlyRevenue'));
 assert.ok(!staging.includes('individualRankingList.replaceChildren'));
 assert.ok(!staging.includes('teamRankingList.replaceChildren'));
});
test("Owner and partner use same verified count endpoint and strict role/range",()=>{
 const partner=read("../partner-workspace.html");
 assert.ok(staging.includes('expectedRole:"hub_owner"'));
 assert.ok(staging.includes('renderVerifiedInlineJointCards({'));
 assert.ok(staging.includes('period:"month",start:month+"-01",end'));
 assert.ok(staging.includes('getVerifiedJointCountRanking'));
 assert.ok(partner.includes("getVerifiedJointCountRanking"));
 assert.ok(staging.includes('monthInput.addEventListener("change"'));
 assert.ok(staging.includes('auth.currentUser!==user'));
 assert.ok(staging.includes("epoch!==generation"));
 assert.ok(staging.includes("companyForOwner(user)"));
 assert.ok(staging.includes('window.location.origin!=="https://nico-factory.web.app"'));
});
test("Owner verified rank never fetches on disabled feature and never removes original dashboard",()=>{
 assert.ok(staging.indexOf("if(NICO_OWNER_INLINE_JOINT_CARDS_RELEASED){")>=0);
 assert.ok(staging.includes("card.hidden=true"));
 assert.ok(staging.includes("roots[key].replaceChildren()"));
 assert.ok(staging.includes("if(epoch===generation)clear()"));
 const standalone=read("../ranking/verified-inline-joint-ranking-cards.mjs");
 assert.ok(standalone.includes("validateVerifiedDualCountDashboard"));
 assert.ok(standalone.includes("expectedRole"));
});
