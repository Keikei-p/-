"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildApprovedPartnerCountStandings,KEYS}=
 require("../functions-partner-workspace/shared-count-standings.cjs");

const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const counts=(on=0,off=0)=>({...zero(),NURO:on,"YM純新規":off});
const make=(date,staffId,teamId,count,off=0)=>({
 id:date+"__"+staffId,
 data:{date,staffId,staffNameSnapshot:staffId,teamIdSnapshot:teamId,
  companyId:"partner",hubCompanyId:"hub",version:1,
  counts:counts(count,off),totalCount:count+off}
});
function rank(entries){
 const grouped=new Map();
 for(const e of entries){
  const day=e.data.date,agg=grouped.get(day)||zero();
  for(const key of KEYS)agg[key]+=e.data.counts[key];
  grouped.set(day,agg);
 }
 return buildApprovedPartnerCountStandings({
  hubId:"hub",start:"2026-11-11",end:"2026-11-13",
  sources:[{cid:"partner",name:"協力店A",approved:true,
   allowedCategories:["NURO"],
   teams:["team1","team2"].map(id=>({id,name:id})),
   entries,
   reports:[...grouped].map(([date,raw])=>({
    date,data:{date,hubCompanyId:"hub",partnerCompanyId:"partner",
     source:"staff-entries-v1",counts:raw,
     totalCount:Object.values(raw).reduce((a,b)=>a+b,0)}
   }))}
  ]
 });
}
test("same staff on multiple days adds counts but not people",()=>{
 const r=rank([
  make("2026-11-11","worker1","team1",2),
  make("2026-11-12","worker1","team1",3),
  make("2026-11-13","worker2","team1",4)
 ]);
 assert.equal(r.totalCount,9);
 assert.equal(r.reportCount,3,"reported days remain days, not people");
 assert.equal(r.companies[0].reportedDays,3);
 assert.equal(r.teams.length,1);
 assert.equal(r.teams[0].totalCount,9);
 assert.equal(r.teams[0].reportedStaffCount,2,"unique staff identities per team");
 assert.deepEqual(r.people.map(p=>[p.name,p.totalCount]),[
  ["worker2",4],["worker1",5]
 ].sort((a,b)=>b[1]-a[1]),"person totals remain aggregated");
});
test("staff changing teams is one distinct reporter in each saved team",()=>{
 const r=rank([
  make("2026-11-11","worker1","team1",1),
  make("2026-11-12","worker1","team2",2)
 ]);
 const teams=new Map(r.teams.map(t=>[t.name,t]));
 assert.equal(teams.get("team1").reportedStaffCount,1);
 assert.equal(teams.get("team2").reportedStaffCount,1);
 assert.equal(teams.get("team1").totalCount,1);
 assert.equal(teams.get("team2").totalCount,2);
 assert.equal(r.people.length,1,"person rank is not split by later team assignment");
 assert.equal(r.people[0].totalCount,3);
 assert.equal(r.people[0].teamKey,null);
});
test("OFF-only day cannot inflate submitted staff count or a published zero",()=>{
 const r=rank([
  make("2026-11-11","worker1","team1",0),
  make("2026-11-12","worker2","team1",0,7),
  make("2026-11-13","worker1","team1",0)
 ]);
 assert.equal(r.totalCount,0);
 assert.equal(r.teams[0].reportedStaffCount,1);
 assert.equal(r.reportCount,2);
 assert.equal(r.people.length,1);
 assert.equal(r.people[0].name,"worker1");
 assert.equal(r.products[0].name,"NURO");
 assert.equal(r.products[0].totalCount,0);
});
