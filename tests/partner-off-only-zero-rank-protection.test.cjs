"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildApprovedPartnerCountStandings,KEYS}=
 require("../functions-partner-workspace/shared-count-standings.cjs");

const day="2026-11-13";
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const entry=(who,team,counts)=>({
 id:day+"__"+who,
 data:{companyId:"partner",hubCompanyId:"hub",date:day,
  staffId:who,staffNameSnapshot:who,teamIdSnapshot:team,version:1,
  counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0)}
});
function standings(entries,{source="staff-entries-v1",quickCounts=null}={}){
 const aggregate=quickCounts||zero();
 if(!quickCounts)for(const row of entries)for(const k of KEYS)
  aggregate[k]+=row.data.counts[k];
 const counts={...aggregate};
 const teams=entries.map(row=>({id:row.data.teamIdSnapshot,
  name:row.data.teamIdSnapshot}));
 return buildApprovedPartnerCountStandings({hubId:"hub",start:day,end:day,
  sources:[{cid:"partner",name:"協力店A",approved:true,
   allowedCategories:["NURO"],teams,entries,
   reports:[{date:day,data:{hubCompanyId:"hub",partnerCompanyId:"partner",
    date:day,source,counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0)}}]}]});
}
const off=()=>({...zero(),"YM純新規":5});

test("OFF-only saved positive count must not invent a 0-ranked company, team or person",()=>{
 const r=standings([entry("offStaff","offTeam",off())]);
 assert.equal(r.totalCount,0);
 assert.equal(r.reportCount,0);
 assert.deepEqual(r.companies,[]);
 assert.deepEqual(r.teams,[]);
 assert.deepEqual(r.people,[]);
 assert.deepEqual(r.products,[], "OFF-only day must not create a zero-ranked NURO product");
 assert.equal(r.unreportedCompanies.length,1);
 assert.equal(r.partnerCountsComplete,false);
});

test("genuinely submitted zero remains ranked even beside an OFF-only positive entry",()=>{
 const r=standings([
  entry("offStaff","offTeam",off()),
  entry("realZero","zeroTeam",zero())
 ]);
 assert.equal(r.totalCount,0);
 assert.equal(r.reportCount,1);
 assert.equal(r.companies[0].totalCount,0);
 assert.equal(r.companies[0].rank,1);
 assert.deepEqual(r.people.map(p=>p.name),["realZero"]);
 assert.equal(r.people[0].totalCount,0);
 assert.equal(r.people[0].rank,1);
 assert.deepEqual(r.teams.map(t=>t.name),["zeroTeam"]);
 assert.equal(r.teams[0].rank,1);
 assert.equal(r.products[0].name,"NURO");
 assert.equal(r.products[0].rank,1);
 assert.equal(r.products[0].totalCount,0,
  "a verified submitted zero remains visible in the ON product leaderboard");
});

test("published positive reports rank normally; private OFF figures never enter score",()=>{
 const r=standings([
  entry("offStaff","offTeam",off()),
  entry("publicStaff","publicTeam",{...zero(),NURO:3})
 ]);
 assert.equal(r.totalCount,3);
 assert.equal(r.reportCount,1);
 assert.equal(r.companies[0].totalCount,3);
 assert.deepEqual(r.people.map(p=>p.name),["publicStaff"]);
 assert.equal(r.people[0].totalCount,3);
 assert.deepEqual(r.teams.map(t=>t.name),["publicTeam"]);
 assert.equal(r.products.find(p=>p.name==="NURO").totalCount,3);
 assert.doesNotMatch(JSON.stringify(r),/offStaff|offTeam|YM純新規|売上|単価/);
});

test("legacy company-only OFF reports cannot manufacture a ranked zero",()=>{
 const offOnly=standings([],{source:"quick-counts-v1",quickCounts:off()});
 assert.equal(offOnly.companies.length,0);
 assert.equal(offOnly.historicalCompanyOnlyCount,0);
 assert.deepEqual(offOnly.products,[], "legacy OFF-only day creates no zero-ranked product");
 const submittedZero=standings([],{source:"quick-counts-v1",quickCounts:zero()});
 assert.equal(submittedZero.companies.length,1);
 assert.equal(submittedZero.companies[0].rank,1);
 assert.equal(submittedZero.companies[0].totalCount,0);
 assert.equal(submittedZero.products[0].name,"NURO");
 assert.equal(submittedZero.products[0].totalCount,0);
 assert.equal(submittedZero.products[0].rank,1);
});
