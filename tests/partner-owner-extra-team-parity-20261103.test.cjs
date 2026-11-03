"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {ownerPublishedExtraBreakdown}=require("../functions-partner-workspace/owner-published-extra-breakdown.cjs");
const date="2026-11-03";
const makeDoc=(staffId,counts,options={})=>({
 id:date+"__"+staffId,
 data:()=>({
  hubCompanyId:"hub",companyId:"partner",date,version:1,staffId,
  staffNameSnapshot:staffId==="s1"?"担当A":"担当B",
  teamIdSnapshot:"teamA",
  totalCount:Object.values(counts).reduce((n,c)=>n+c,0),
  counts, ...options
 })
});
const project=(docs,extra={})=>ownerPublishedExtraBreakdown(docs,{
 hubId:"hub",cid:"partner",date,teamIds:["teamA","teamB"],
 publishedProducts:[{id:"solar",name:"太陽光"},{id:"water",name:"ウォーター"}],
 linkedIds:["linkedNuro"],...extra
});
test("HQ original counts and published added products remain separate while rendering same staff/team totals",()=>{
 const rows=project([
  makeDoc("s1",{solar:2,water:1,unpublished:8}),
  makeDoc("s2",{solar:3,unpublished:4})
 ]);
 assert.equal(rows.scope,"published_extra_count_only");
 assert.equal(rows.verifiedPublishedCount,6);
 assert.equal(rows.unattributedPublishedCount,0);
 assert.equal(rows.teams.length,1);
 assert.equal(rows.teams[0].totalCount,6);
 assert.deepEqual(rows.teams[0].products,[
  {id:"solar",name:"太陽光",count:5},
  {id:"water",name:"ウォーター",count:1}
 ]);
 assert.deepEqual(rows.teams[0].people.map(p=>[p.name,p.totalCount]),[
  ["担当A",3],["担当B",3]
 ]);
 const json=JSON.stringify(rows);
 assert.doesNotMatch(json,/unpublished|8|revenue|price|email|staffId|s1|s2/);
});
test("unpublished historical product quantities stay hidden and are not falsely displayed as 0 reporting",()=>{
 const rows=project([makeDoc("s1",{hidden:9})]);
 assert.equal(rows.verifiedPublishedCount,0);
 assert.equal(rows.unattributedPublishedCount,0);
 assert.equal(rows.teams.length,0);
 assert.equal(rows.complete,true); // only the approved visible portion is complete
 assert.doesNotMatch(JSON.stringify(rows),/hidden|9/);
});
test("unknown or retired team snapshots cannot be reassigned to a current team",()=>{
 const rows=project([makeDoc("s1",{solar:3},{teamIdSnapshot:"retiredTeam"})]);
 assert.equal(rows.unattributedPublishedCount,3);
 assert.equal(rows.verifiedPublishedCount,3);
 assert.deepEqual(rows.teams,[]);
});
test("reject duplicate, corrupted, unlinked IDs and linked-master double counting",()=>{
 const a=makeDoc("s1",{solar:1});
 const invalid=[
  makeDoc("s1",{solar:1},{totalCount:2}),
  makeDoc("s1",{solar:1},{companyId:"other"}),
  makeDoc("s1",{solar:1},{staffNameSnapshot:"売上100円"}),
  makeDoc("s1",{linkedNuro:2}),
  makeDoc("s1",{solar:1},{teamIdSnapshot:""})
 ];
 for(const row of invalid)
  assert.throws(()=>project([row]),/UNVERIFIED/);
 assert.throws(()=>project([a,a]),/UNVERIFIED/);
 assert.throws(()=>project([a],{publishedProducts:[{id:"solar",name:"単価500円"}]}),/UNVERIFIED/);
 assert.throws(()=>project([a],{publishedProducts:[{id:"solar",name:"太陽光"},{id:"solar",name:"重複"}]}),/UNVERIFIED/);
});
test("Hub detailed owner view reads only approved new counts, scopes company, and validates extras on server",()=>{
 const code=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const first=code.indexOf('   let partnerTeamDetails=null;');
 const last=code.indexOf('   const qs=await collection(s.cid,"partnerWorkCountDays")',first);
 assert.ok(first>0&&last>first);
 const scope=code.slice(first,last);
 for(const token of [
  'const chosen=registeredCompanies.find(x=>x.partnerCompanyId===selectedPartnerId)',
  'if(!chosen||chosen.active!==true)fail()',
  'collection(selectedPartnerId,"partnerAdditionalCountEntries")',
  'where("date","==",date).limit(201).get()',
  "if(extraSnap.size>200)fail",
  'publicationRef(s.cid).get()',
  'countLinksRef(s.cid).get()',
  'projectMasterProducts(',
  'publishedAdditional=ownerPublishedExtraBreakdown(extraSnap.docs',
  'teamIds:[...rows.keys()]'
 ])assert.ok(scope.includes(token),token);
 assert.doesNotMatch(scope,/tx\.|db\.runTransaction|collection\(selectedPartnerId,"partnerPrivateProducts"\)/);
 assert.match(code,/return \{role:"hub",date,partners,registeredCompanies,categories:KEYS/);
});
test("same HQ team card shows verified approved additional-product count and rejects forged totals",()=>{
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 const a=html.indexOf("function verifyOwnerPublishedExtras(");
 const b=html.indexOf("async function loadOwnerPartnerDetails(){",a);
 assert.ok(a>0&&b>a);
 const ctx={partnerMainValidId:x=>/^[A-Za-z0-9_-]{1,128}$/.test(x)};
 vm.runInNewContext(html.slice(a,b)+"\nthis.verify=verifyOwnerPublishedExtras;",ctx);
 const entry={scope:"published_extra_count_only",complete:true,
  verifiedPublishedCount:5,unattributedPublishedCount:0,
  teams:[{teamId:"teamA",totalCount:5,
   products:[{id:"solar",name:"太陽光",count:5}],
   people:[{name:"担当A",totalCount:3,products:[{id:"solar",name:"太陽光",count:3}]},
    {name:"担当B",totalCount:2,products:[{id:"solar",name:"太陽光",count:2}]}]
  }]
 };
 const teams=[{teamId:"teamA",totalCount:4}];
 assert.equal(ctx.verify(entry,teams).get("teamA").totalCount,5);
 assert.throws(()=>ctx.verify({...entry,verifiedPublishedCount:6},teams),/owner_extra_total/);
 assert.throws(()=>ctx.verify({...entry,teams:[{...entry.teams[0],totalCount:7}]},teams),/owner_extra_team_products/);
 assert.throws(()=>ctx.verify({...entry,teams:[{...entry.teams[0],people:[]}]},teams),/owner_extra_person_total/);
 assert.throws(()=>ctx.verify({...entry,teams:[{...entry.teams[0],teamId:"wrong"}]},teams),/owner_extra_team/);
 assert.match(html,/appendOwnerPublishedExtras\(holder.lastElementChild,team,publishedExtraByTeam.get\(team.teamId\)\)/);
 assert.match(html,/additional\.verifiedPublishedCount\+"件（通常商材へ二重加算しません）"/);
});
