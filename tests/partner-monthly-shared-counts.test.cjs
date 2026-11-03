"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {projectPartnerMonth}=require("../functions-partner-workspace/monthly-shared-projection.cjs");
const {readDirectRangeCounts}=require("../functions-partner-workspace/shared-direct-counts.cjs");
const {groupPersonalScores}=require("../functions-partner-workspace/shared-ranking-groups.cjs");
const keys=["NURO","SBMNP"];
const row=(date,staffId,counts,opts={})=>({
 id:date+"__"+staffId,data:()=>({
 companyId:"partner",hubCompanyId:"hub",date,staffId,
 staffNameSnapshot:"スタッフA",teamIdSnapshot:"teamA",
 counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0),
 version:1,...opts
 })
});
const project=(legacyDocs,extraDocs)=>projectPartnerMonth({
 hubId:"hub",cid:"partner",companyName:"協力店A",
 from:"2026-11-01",to:"2026-11-03",legacyDocs,extraDocs,
 keys,publishedIds:["extraSolar"],linkedIds:["existing"]
});
test("team labels are resolved only from verified IDs; missing/departed team remains unknown",()=>{
 const args={
  hubId:"hub",cid:"partner",companyName:"協力店A",
  from:"2026-11-01",to:"2026-11-03",keys,
  publishedIds:["extraSolar"],linkedIds:[],
  legacyDocs:[row("2026-11-01","u1",{NURO:1,SBMNP:0})],
  extraDocs:[],teamNames:{teamA:"広島1班"}
 };
 assert.equal(projectPartnerMonth(args).teams[0].name,"広島1班");
 assert.equal(projectPartnerMonth(args).people[0].teamName,"広島1班");
 assert.equal(projectPartnerMonth({...args,teamNames:{}}).teams[0].name,"当時の班名未確認");
});
test("monthly counts merge two days for same partner person and immutable team",()=>{
 const data=project([
  row("2026-11-01","u1",{NURO:2,SBMNP:1}),
  row("2026-11-02","u1",{NURO:3,SBMNP:0})
 ],[
  row("2026-11-02","u1",{extraSolar:4})
 ]);
 assert.equal(data.totalCount,10);
 assert.equal(data.additionalTotalCount,4);
 assert.deepEqual(data.counts,{NURO:5,SBMNP:1});
 assert.equal(data.people.length,1);
 assert.equal(data.people[0].totalCount,10);
 assert.deepEqual(data.people[0].extraCounts,{extraSolar:4});
 assert.equal(data.teams[0].totalCount,10);
 assert.doesNotMatch(JSON.stringify(data),/staffId|uid|email|revenue|unitPrice|¥/);
});
test("unknown or previously unpublished product stays in total, not visible product groups",()=>{
 const data=project([], [row("2026-11-01","u1",{archivedItem:7,extraSolar:1})]);
 assert.equal(data.totalCount,8);
 assert.deepEqual(data.people[0].extraCounts,{extraSolar:1});
 const ranked=groupPersonalScores([{id:"g",name:"extra",keys:["id:extraSolar"]}],
  data.people,{categories:keys,extraVerifiedIds:["extraSolar"]});
 assert.equal(ranked[0].members[0].count,1);
});
test("old team changes remain separate; person identity never gets invented",()=>{
 const docs=[
  row("2026-11-01","u1",{NURO:2,SBMNP:0}),
  row("2026-11-02","u1",{NURO:1,SBMNP:0},{teamIdSnapshot:"teamB"})
 ];
 const data=project(docs,[]);
 assert.equal(data.people.length,1);
 assert.equal(data.teams.length,2);
 assert.equal(data.people[0].teamKey,null);
 assert.equal(data.people[0].teamName,"複数班（当時の所属班ごとに集計）");
 assert.deepEqual(data.teams.map(t=>t.totalCount).sort(),[1,2]);
});
test("company/date/ledger/extra double attribution corruption is rejected",()=>{
 assert.throws(()=>project([row("2026-11-01","u1",{NURO:1,SBMNP:0}),
  row("2026-11-01","u1",{NURO:1,SBMNP:0})],[]),/UNVERIFIED/);
 assert.throws(()=>project([row("2026-10-31","u1",{NURO:1,SBMNP:0})],[]),/UNVERIFIED/);
 assert.throws(()=>project([row("2026-11-01","u1",{NURO:1,SBMNP:0},
  {totalCount:100})],[]),/UNVERIFIED/);
 assert.throws(()=>project([row("2026-11-01","u1",{NURO:1,SBMNP:0},
  {companyId:"other"})],[]),/UNVERIFIED/);
 assert.throws(()=>project([row("2026-11-01","u1",{NURO:1,SBMNP:0})],[
  row("2026-11-01","u1",{extraSolar:2},{teamIdSnapshot:"otherTeam"})
 ]),/UNVERIFIED/);
});
test("month-range direct reader suppresses financial originals and aggregates verified product IDs",async()=>{
 const docs=[
  {data:()=>({companyId:"hub",date:"2026-11-01",uid:"user1",teamId:"t1",
   memberNameSnapshot:"本社A",totalCount:2,results:[{productId:"solar",productNameSnapshot:"新製品",count:2}],revenue:900000})},
  {data:()=>({companyId:"hub",date:"2026-11-03",uid:"user1",teamId:"t1",
   memberNameSnapshot:"本社A",totalCount:3,results:[{productId:"nuro",productNameSnapshot:"NURO光",count:3}],unitPrice:9000})}
 ];
 const calls=[];
 const db={collection(name){
  let stream=docs;
  if(name==="products")stream=[
   {id:"solar",data:()=>({companyId:"hub",name:"新製品",price:999})},
   {id:"nuro",data:()=>({companyId:"hub",name:"NURO光"})}
  ];
  return {where(field,op,value){calls.push([name,field,op,value]);return this;},
   limit(){return this;},async get(){return {size:stream.length,docs:stream};}};
 }};
 const result=await readDirectRangeCounts(db,"hub","2026-11-01","2026-11-03",["NURO"],{
  approvedExtraProductIds:["solar","nuro"],maxRecords:10000
 });
 assert.equal(result.totalCount,5);
 assert.equal(result.people.length,1);
 assert.equal(result.people[0].totalCount,5);
 assert.deepEqual(result.people[0].extraCounts,{solar:2,nuro:3});
 assert.deepEqual(result.people[0].extraCategoryCounts,{nuro:{NURO:3}});
 assert.ok(calls.some(x=>x[1]==="date"&&x[2]===">="));
 assert.ok(calls.some(x=>x[1]==="date"&&x[2]==="<="));
 assert.doesNotMatch(JSON.stringify(result),/revenue|price|900000|9000|user1/);
});
test("direct monthly counts refuse missing totals and missing or mismatched product quantities",async()=>{
 const good={companyId:"hub",date:"2026-11-02",uid:"u1",teamId:"teamA",
  memberNameSnapshot:"担当者A",totalCount:2,
  results:[{productId:"p1",productNameSnapshot:"NURO光",count:2}],
  totalRevenue:100000,revenuePerUnit:50000};
 const mock=record=>({collection(name){
  const docs=name==="records"?[{data:()=>record}]:[];
  return {where(){return this;},limit(){return this;},
   async get(){return {size:docs.length,docs};}};
 }});
 const direct=record=>readDirectRangeCounts(mock(record),"hub",
  "2026-11-01","2026-11-03",["NURO"],{maxRecords:10});
 await assert.rejects(direct({...good,totalCount:undefined}),/DIRECT_TOTAL_UNVERIFIED/);
 await assert.rejects(direct({...good,totalCount:null}),/DIRECT_TOTAL_UNVERIFIED/);
 await assert.rejects(direct({...good,totalCount:1}),/DIRECT_TOTAL_MISMATCH/);
 await assert.rejects(direct({...good,results:[{productId:"p1",count:undefined}]}),
  /DIRECT_INVALID_QUANTITY/);
 await assert.rejects(direct({...good,results:[{productId:"p1",count:null}]}),
  /DIRECT_INVALID_QUANTITY/);
 for(const invalidCount of ["", "  ", "2 ", false, true]){
  await assert.rejects(direct({...good,results:[{productId:"p1",count:invalidCount}]}),
   /DIRECT_INVALID_QUANTITY/);
 }
 const legacyDigitString=await direct({...good,results:[{productId:"p1",productNameSnapshot:"NURO光",count:"2"}]});
 assert.equal(legacyDigitString.totalCount,2,"legacy digit strings remain compatible");
 const noResult=await direct({...good,totalCount:0,results:[]});
 assert.equal(noResult.totalCount,0,"genuine explicit no-result remains zero");
 const correct=await direct(good);
 assert.equal(correct.totalCount,2);
 assert.equal(correct.people[0].totalCount,2);
 assert.doesNotMatch(JSON.stringify(correct),/totalRevenue|revenuePerUnit|100000|50000/);
});

test("monthly Callable is opt-in, count-only, auth-scoped and never complete by assumption",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const api=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
 const start=service.indexOf(" async function viewMonthly(request){");
 const end=service.indexOf(" async function view(request){",start);
 assert.ok(start>0&&end>start);
 const monthly=service.slice(start,end);
 assert.match(monthly,/await sharedRankScope\(a\.uid,d\.workspaceCompanyId\)/);
 assert.match(monthly,/rel\.countSharingApproved!==true/);
 assert.match(monthly,/maxRecords:10000/);
 assert.match(monthly,/partnerRowsRead>10000/);
 assert.match(monthly,/projectPartnerMonth/);
 assert.match(monthly,/complete:false/);
 assert.match(monthly,/effectiveFrom<=first/);
 assert.doesNotMatch(monthly,/tx\.(?:create|update|set|delete)\(/);
 assert.match(api,/exports\.getPartnerMonthlySharedCounts=onCall/);
});
