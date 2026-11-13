import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const index=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=index.indexOf("function renderAllTeamsOverview(");
const end=index.indexOf("/* =====================================================\n   個人ランキング",start);
const block=index.slice(start,end);
test("original self 1–4 team card rendering and revenue permission remain",()=>{
 assert.ok(start>0&&end>start);
 for(const exact of [
  'grid.className =\n    "team-overview-grid"',
  'button.className =\n        "team-overview-card"',
  'selectedTeamOverviewId =',
  'renderSelectedTeamMemberDetail(',
  'buildTeamGoalProgress(',
  'buildTeamRevenueGoalProgress(',
  'canCurrentUserViewRevenueForTeam(team.id)',
  '売上目標'
 ])assert.ok(block.includes(exact),"missing self card behavior: "+exact);
 assert.ok(block.indexOf("renderSelection();")<block.indexOf("void refreshOwnerVerifiedPartnerTeamCards();"));
});
test("owner-partner company cards mount in the SAME original team detail panel",()=>{
 assert.match(index,/<div id="allTeamsOverviewList"><\/div>\s*<div id="ownerVerifiedPartnerTeamCards"[^>]*hidden><\/div>/);
 assert.equal((index.match(/id="ownerVerifiedPartnerTeamCards"/g)||[]).length,1);
 assert.match(index,/const NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED = false;/);
 assert.match(index,/if\(!NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED\|\|/);
 assert.match(index,/recordsSubscribedMonth!==dashboardMonth.value/);
 assert.match(index,/createVerifiedJointMonthHttpBridge\(\{/);
 assert.match(index,/featureEnabled:true,auth,fetcher:\(\.\.\.args\)=>fetch\(\.\.\.args\)/);
 assert.match(index,/renderOwnerPartnerTeamCards\(\{document,root,response,month\}\)/);
});
test("no new data write or finance disclosure is added to the team bridge",()=>{
 const slice=index.slice(index.indexOf("// Draft/NO DEPLOY: never infer partner teams"),start);
 assert.ok(slice.length>0);
 assert.doesNotMatch(slice,/getFirestore\(|getDocs\(|setDoc\(|updateDoc\(|addDoc\(|deleteDoc\(|writeBatch\(/);
 assert.doesNotMatch(slice,/localStorage\.setItem|sessionStorage\.setItem/);
 assert.match(slice,/未照合の数字は表示しません/);
 assert.match(slice,/auth\.currentUser!==user/g);
 assert.match(slice,/generation!==ownerVerifiedTeamState\.generation/g);
});
