import test from "node:test";
import assert from "node:assert/strict";
import {buildMonthlyDraft,confirmMonthlyDraft,
 prepareMonthActivation} from "../team-planning/future-month-contract.mjs";
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
