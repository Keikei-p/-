import test from "node:test";
import assert from "node:assert/strict";
import {buildMonthlyDraft,confirmMonthlyDraft,prepareMonthActivation,
 buildFutureGoalDraft,confirmFutureGoalDraft,prepareFutureGoalReservations
} from "../team-planning/future-month-contract.mjs";
const owner={serverVerified:true,companyId:"hub",companyRole:"owner"};
const people=[
 {uid:"a",companyRole:"member",role:"member",teamId:"one",active:true,
  teamHistory:[{effectiveDate:"2026-09-01",fromTeamId:null,toTeamId:"one"}]},
 {uid:"b",companyRole:"member",role:"leader",teamId:"two",active:true,
  teamHistory:[]}
];
const src=JSON.stringify(people);
const draft=buildMonthlyDraft({actor:owner,companyId:"hub",month:"2026-11",
 overrides:[{uid:"a",teamId:"two",role:"leader"}]});
test("planned but unconfirmed next-month assignment cannot change today",()=>{
 assert.equal(draft.state,"draft");
 assert.equal(draft.items[0].role,"leader");
 assert.equal(JSON.stringify(people),src);
 assert.throws(()=>prepareMonthActivation({plan:draft,jstDate:"2026-11-01",
  people,validTeamIds:["one","two"]}),/NOT_CONFIRMED/);
});
test("book first-of-month JST and keep historical team snapshot immutable",()=>{
 const plan=confirmMonthlyDraft(draft);
 assert.throws(()=>prepareMonthActivation({plan,jstDate:"2026-10-31",
  people,validTeamIds:["one","two"]}),/TOO_EARLY/);
 const update=prepareMonthActivation({plan,jstDate:"2026-11-01",
  people,validTeamIds:["one","two"]});
 assert.equal(update.patches.length,1);
 assert.deepEqual(update.patches[0].teamHistory,[
  {effectiveDate:"2026-09-01",fromTeamId:null,toTeamId:"one"},
  {effectiveDate:"2026-11-01",fromTeamId:"one",toTeamId:"two"}
 ]);
 assert.equal(update.patches[0].role,"leader");
 assert(!("records" in update.patches[0]));
 assert(!("canViewRevenue" in update.patches[0]));
 assert(!("canViewUnitPrice" in update.patches[0]));
 assert.equal(JSON.stringify(people),src,"never touch current people or history in preview");
});
test("no reservation keeps entire team and role unchanged; partial keeps others",()=>{
 const empty=confirmMonthlyDraft(buildMonthlyDraft({
  actor:owner,companyId:"hub",month:"2026-12",overrides:[]}));
 assert.deepEqual(prepareMonthActivation({
  plan:empty,jstDate:"2026-12-01",people,validTeamIds:["one","two"]
 }).patches,[]);
 const partial=prepareMonthActivation({
  plan:confirmMonthlyDraft(draft),jstDate:"2026-11-01",people,validTeamIds:["one","two"]
 });
 assert.equal(partial.patches.some(p=>p.uid==="b"),false);
});
test("undefined team means carry-forward; explicit null means unassigned",()=>{
 const roleOnly=confirmMonthlyDraft(buildMonthlyDraft({actor:owner,
  companyId:"hub",month:"2026-11",overrides:[{uid:"b",role:"member"}]}));
 const up=prepareMonthActivation({plan:roleOnly,jstDate:"2026-11-01",
  people,validTeamIds:["one","two"]});
 assert.equal(up.patches[0].teamId,"two");
 const unassigned=confirmMonthlyDraft(buildMonthlyDraft({actor:owner,
  companyId:"hub",month:"2026-12",overrides:[{uid:"a",teamId:null}]}));
 const result=prepareMonthActivation({plan:unassigned,jstDate:"2026-12-01",
  people,validTeamIds:["one","two"]});
 assert.equal(result.patches[0].teamId,null);
 assert.throws(()=>buildMonthlyDraft({actor:owner,companyId:"hub",month:"2026-11",
   overrides:[{uid:"a",teamId:null,role:"leader"}]}),/LEADER_UNASSIGNED/);
});
test("no historic deletions, failure on >100 history, invalid team, conflicting schedule",()=>{
 const crowded=structuredClone(people);
 crowded[0].teamHistory=Array.from({length:100},(_,i)=>({
  effectiveDate:"2025-01-01",sequence:i,toTeamId:"one"
 }));
 assert.throws(()=>prepareMonthActivation({plan:confirmMonthlyDraft(draft),
  jstDate:"2026-11-01",people:crowded,validTeamIds:["one","two"]}),
 /HISTORY_CAP_MIGRATION_REQUIRED/);
 const bad=confirmMonthlyDraft(buildMonthlyDraft({actor:owner,companyId:"hub",
  month:"2026-11",overrides:[{uid:"a",teamId:"deleted"}]}));
 assert.throws(()=>prepareMonthActivation({plan:bad,jstDate:"2026-11-01",
  people,validTeamIds:["one","two"]}),/NONEXISTENT_TEAM/);
 const conflict=structuredClone(people);
 conflict[0].teamHistory.push({effectiveDate:"2026-11-01",fromTeamId:"one",toTeamId:"one"});
 assert.throws(()=>prepareMonthActivation({plan:confirmMonthlyDraft(draft),
  jstDate:"2026-11-01",people:conflict,validTeamIds:["one","two"]}),
 /CONFLICTING_HISTORY/);
});
test("only company owner may plan; unknown role and duplicate UID rejected",()=>{
 assert.throws(()=>buildMonthlyDraft({actor:{...owner,companyRole:"leader"},companyId:"hub",
 month:"2026-11",overrides:[]}),/OWNER_ONLY/);
 assert.throws(()=>buildMonthlyDraft({actor:owner,companyId:"hub",month:"2026-11",
  overrides:[{uid:"a",teamId:"one"},{uid:"a",teamId:"two"}]}),/DUPLICATE/);
 assert.throws(()=>buildMonthlyDraft({actor:owner,companyId:"hub",month:"2026-11",
  overrides:[{uid:"a",role:"owner"}]}),/ROLE/);
 assert.throws(()=>buildMonthlyDraft({actor:owner,companyId:"hub",month:"2026-13",
  overrides:[]}),/MONTH/);
});

test("late month activation never backdates an already operating team's historical sales",()=>{
 const plan=confirmMonthlyDraft(draft);
 for(const late of ["2026-11-02","2026-11-15","2026-11-30","2026-12-01","2027-01-01"]){
   assert.throws(()=>prepareMonthActivation({plan,jstDate:late,
      people,validTeamIds:["one","two"]}),
      /LATE_ACTIVATION_REQUIRES_MANUAL_REVIEW/,late);
 }
 assert.equal(JSON.stringify(people),src,
   "late activation must not change records, user membership or teamHistory");
});
test("conflicting future dated move is never overwritten by next month activation",()=>{
 const plan=confirmMonthlyDraft(draft),changed=structuredClone(people);
 changed[0].teamHistory.push({effectiveDate:"2026-12-01",fromTeamId:"one",toTeamId:"two"});
 const before=JSON.stringify(changed);
 assert.throws(()=>prepareMonthActivation({plan,jstDate:"2026-11-01",
    people:changed,validTeamIds:["one","two"]}),/FUTURE_HISTORY_CONFLICT/);
 assert.equal(JSON.stringify(changed),before);
});

const goalOwner={...owner,uid:"owner123"};
const futureGoal=buildFutureGoalDraft({actor:goalOwner,companyId:"hub",
  month:"2026-11",goals:[{teamId:"one",targets:{nuro:10,electric:3},
  targetRevenue:2500000},{teamId:"two",targets:{nuro:4}}]});
const confirmGoal=()=>confirmFutureGoalDraft(futureGoal);
test("Owner can prebook next-month product counts and revenue in DIFFERENT documents",()=>{
 const draft=confirmGoal();
 const out=prepareFutureGoalReservations({plan:draft,jstDate:"2026-10-31",
   activeTeamIds:["one","two"]});
 assert.equal(out.planId,"hub_2026-11");
 assert.equal(out.countGoals.length,2);
 assert.equal(out.revenueGoals.length,1);
 assert.deepEqual({...out.countGoals[0].targets},{...futureGoal.items[0].targets});
 assert.equal(out.countGoals[0].id,"hub_one_2026-11");
 assert.equal(out.revenueGoals[0].id,"hub_one_2026-11");
 assert.equal(out.revenueGoals[0].targetRevenue,2500000);
 for(const countGoal of out.countGoals){
   assert.equal("targetRevenue" in countGoal,false,"partner-safe count goal cannot carry money");
 }
 for(const revenueGoal of out.revenueGoals)
   assert.equal("targets" in revenueGoal,false,"money cannot leak via count goal");
 assert.equal(Object.isFrozen(out.countGoals[0]),true);
 assert.equal(Object.isFrozen(out.revenueGoals[0]),true);
 assert.equal(JSON.stringify(people),src,"no mutations to current staff or sales");
});
test("Owner must confirm goal draft; never activate on or after the selected month",()=>{
 assert.throws(()=>prepareFutureGoalReservations({plan:futureGoal,jstDate:"2026-10-31",
   activeTeamIds:["one","two"]}),/GOALS_NOT_CONFIRMED/);
 for(const day of ["2026-11-01","2026-11-02","2027-01-01"]){
   assert.throws(()=>prepareFutureGoalReservations({plan:confirmGoal(),
      jstDate:day,activeTeamIds:["one","two"]}),/GOAL_RESERVATION_TOO_LATE/);
 }
 for(const day of ["2026-02-30","invalid","2026-13-10"]){
   assert.throws(()=>prepareFutureGoalReservations({plan:confirmGoal(),
      jstDate:day,activeTeamIds:["one","two"]}),/GOAL_CLOCK/);
 }
});
test("Existing count and money goals cannot be silently overwritten",()=>{
 const plan=confirmGoal();
 for(const [existingGoals,existingRevenueGoals,error] of [
   [[{id:"hub_one_2026-11"}],[],"COUNT_GOAL_ALREADY_EXISTS"],
   [[],[{id:"hub_one_2026-11"}],"REVENUE_GOAL_ALREADY_EXISTS"],
   [[{companyId:"hub",teamId:"two",month:"2026-11"}],[],"COUNT_GOAL_ALREADY_EXISTS"],
 ]){
   assert.throws(()=>prepareFutureGoalReservations({plan,jstDate:"2026-10-31",
      activeTeamIds:["one","two"],existingGoals,existingRevenueGoals}),
      new RegExp(error));
 }
});
test("No unauthorized Owner, other company, duplicate team goals or unsafe target values",()=>{
 const make=goals=>buildFutureGoalDraft({actor:goalOwner,companyId:"hub",
   month:"2026-11",goals});
 for(const actor of [
   {...goalOwner,companyRole:"leader"}, {...goalOwner,serverVerified:false},
   {...goalOwner,companyId:"other"}, {...goalOwner,uid:undefined},
   {...goalOwner,uid:"wrong/id"}
 ])assert.throws(()=>buildFutureGoalDraft({actor,companyId:"hub",
    month:"2026-11",goals:[]}),/OWNER_ONLY/);
 assert.throws(()=>make([{teamId:"one",targets:{nuro:1}},
    {teamId:"one",targets:{nuro:2}}]),/DUPLICATE_TEAM_GOAL/);
 for(const value of [-1,0.1,NaN,Infinity,"4",1000000])
   assert.throws(()=>make([{teamId:"one",targets:{nuro:value}}]),/COUNT_TARGET/);
 for(const value of [-1,0.5,Infinity,"20",1000000000000])
   assert.throws(()=>make([{teamId:"one",targetRevenue:value}]),/REVENUE_TARGET/);
 for(const row of [
   {teamId:"one",targets:{nuro:1},unitPrice:5},
   {teamId:"one",totalRevenue:50000},
   {teamId:"one",targets:{"bad/id":1}},
   {teamId:"one",targets:new Date()},
   {teamId:"one",targets:null}
 ])assert.throws(()=>make([row]),/GOAL_FIELDS|PRODUCT|PRODUCT_TARGETS/);
});
test("Unapproved team and corrupt confirmed goal plan fail closed",()=>{
 for(const activeTeamIds of [["one"],["one","one"],[]])
   assert.throws(()=>prepareFutureGoalReservations({plan:confirmGoal(),
     jstDate:"2026-10-31",activeTeamIds}),
     /INACTIVE_TEAM_GOAL|DUPLICATE_ACTIVE_TEAM/);
 const altered={...confirmGoal(),items:[{teamId:"one",targets:{nuro:-1}}]};
 assert.throws(()=>prepareFutureGoalReservations({plan:altered,
   jstDate:"2026-10-31",activeTeamIds:["one"]}),/INVALID_COUNT_TARGET/);
});
test("Finance-goal-only and explicit empty count goal retain exact canonical schema",()=>{
 const single=confirmFutureGoalDraft(buildFutureGoalDraft({actor:goalOwner,
   companyId:"hub",month:"2026-12",goals:[
    {teamId:"one",targetRevenue:0},{teamId:"two",targets:{nuro:0}}]}));
 const out=prepareFutureGoalReservations({plan:single,
   jstDate:"2026-10-31",activeTeamIds:["one","two"]});
 assert.equal(out.countGoals.length,1);
 assert.equal(Object.keys(out.countGoals[0].targets).length,0);
 assert.equal(out.revenueGoals.length,1);
 assert.equal(out.revenueGoals[0].targetRevenue,0);
 const clean=JSON.stringify(out.countGoals);
 assert.equal(clean.includes("revenue"),false);
});
