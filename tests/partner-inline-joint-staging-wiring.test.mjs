import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("partner-workspace.html");
const inline=read("ranking/verified-inline-joint-ranking-cards.mjs");
const bridge=read("ranking/verified-joint-month-http-bridge.mjs");
test("same original partner dashboard cards are the integration point, not an extra board",()=>{
 for(const id of ["countCompanyRank","countTeamRank","countStaffRank","countProductRank"])
  assert(source.includes('id="'+id+'"'),id);
 assert(source.includes("renderVerifiedInlineJointCards({"));
 assert(source.includes("document,roots,payload,expectedRole:\"partner_owner\""));
 assert(source.includes('period:countPeriod,start:dates[0],end:dates.at(-1)'));
 assert(source.includes("await refreshVerifiedJointInlineForPartner({gen,uid,day,today,dates});"));
 assert(source.includes("NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||"));
 assert(source.includes('$("countInlineJointCompanies").hidden=false;'));
 assert(source.includes('clear();\n  $("countDashboardStatus").textContent='));
});
test("production and extra-board feature flags stay OFF, no unauthorized network",()=>{
 assert(source.includes("const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;"));
 assert(source.includes("const NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false;"));
 assert(source.includes("const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;"));
 assert(source.includes('if(!NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||'));
 assert(source.includes('data?.role!=="owner"||activeCodeSession'));
 assert(source.includes("identity===auth.currentUser&&identity?.emailVerified===true"));
 assert(source.includes('window.location.origin==="https://nico-factory.web.app"'));
 assert(source.includes("if(!valid())return;"));
 assert(!source.includes('from "firebase/firestore"'));
 assert(!source.includes('firebase-firestore.js'));
 assert(inline.includes("validateVerifiedDualCountDashboard"));
 assert(bridge.includes('expectedRole!==null&&value.role!==expectedRole'));
});
test("existing partner module parses after safe inline staging wiring",()=>{
 const match=source.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert(match);
 const parsed=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:match[1],encoding:"utf8"
 });
 assert.equal(parsed.status,0,parsed.stderr);
 const parsedModule=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:inline,encoding:"utf8"
 });
 assert.equal(parsedModule.status,0,parsedModule.stderr);
});
