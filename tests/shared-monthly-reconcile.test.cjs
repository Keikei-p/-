"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {reconcileSharedMonthlyCounts}=require("../functions-partner-workspace/shared-monthly-reconcile.cjs");
const {readDirectRangeCounts}=require("../functions-partner-workspace/shared-direct-counts.cjs");
const {projectPartnerMonth}=require("../functions-partner-workspace/monthly-shared-projection.cjs");
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 return {
  categories:["NURO","SBMNP"],
  companies:[
   {id:"partnerA",name:"協力店A",totalCount:4,extraTotalCount:2,
    counts:{NURO:2,SBMNP:0},peopleVerified:true},
   {id:"partnerB",name:"協力店B",totalCount:3,extraTotalCount:0,
    counts:{NURO:2,SBMNP:1},peopleVerified:true}
  ],
  people:[
   {name:"担当A",companyId:"partnerA",companyName:"協力店A",totalCount:4,
    counts:{NURO:2,SBMNP:0},extraCounts:{solar:2}},
   {name:"担当B",companyId:"partnerB",companyName:"協力店B",totalCount:3,
    counts:{NURO:2,SBMNP:1},extraCounts:{}}
  ],
  teams:[
   {name:"A班",companyId:"partnerA",companyName:"協力店A",totalCount:4,extraTotalCount:2,
    counts:{NURO:2,SBMNP:0}},
   {name:"B班",companyId:"partnerB",companyName:"協力店B",totalCount:3,extraTotalCount:0,
    counts:{NURO:2,SBMNP:1}}
  ],
  productCounts:{NURO:4,SBMNP:1},additionalTotalCount:2,
  direct:{totalCount:5,otherCount:2,recordsVerified:2,peopleVerified:true,
   counts:{NURO:3,SBMNP:0},
   people:[{totalCount:5}],teams:[{totalCount:5}]}
 };
}
test("verified company + individual + team + product counts reconcile without financial fields",()=>{
 const input=fixture(),before=copy(input);
 const actual=reconcileSharedMonthlyCounts(input);
 assert.deepEqual(actual,{combinedTotalCount:12,partnerTotalCount:7,
  reconciled:true,complete:false});
 assert.deepEqual(input,before,"no mutation of all source data");
 assert.doesNotMatch(JSON.stringify(actual),/price|revenue|amount|uid|email/i);
});
test("1-count drift anywhere rejects every joint ranking instead of showing plausible winners",()=>{
 const defects=[
  x=>x.companies[0].totalCount++,
  x=>x.companies[0].counts.NURO++,
  x=>x.companies[0].extraTotalCount++,
  x=>x.companies[1].totalCount++,
  x=>x.people[0].totalCount++,
  x=>x.people[1].counts.NURO++,
  x=>x.teams[0].totalCount++,
  x=>x.teams[1].counts.SBMNP++,
  x=>x.productCounts.NURO++,
  x=>x.additionalTotalCount++,
  x=>x.direct.totalCount++,
  x=>x.direct.otherCount++,
  x=>x.direct.teams[0].totalCount++,
  x=>x.direct.people[0].totalCount++
 ];
 for(const defect of defects){
  const f=fixture();defect(f);
  assert.throws(()=>reconcileSharedMonthlyCounts(f),
   /SHARED_MONTHLY_RECONCILIATION_FAILED/);
 }
});
test("missing direct person identity is allowed ONLY when explicitly unverified, never promotes rank",()=>{
 const x=fixture();
 x.direct.peopleVerified=false;
 x.direct.people=[];
 const out=reconcileSharedMonthlyCounts(x);
 assert.equal(out.complete,false);
 x.direct.peopleVerified=true;
 assert.throws(()=>reconcileSharedMonthlyCounts(x),/RECONCILIATION_FAILED/);
});
test("duplicate partners, missing count categories and broken private extras all fail closed",()=>{
 const defects=[
  x=>x.companies[1].id="partnerA",
  x=>{delete x.productCounts.SBMNP;},
  x=>{delete x.people[0].counts.NURO;},
  x=>x.people[0].extraCounts={solar:"2"},
  x=>x.people[0].extraCounts={"__proto__":0,constructor:1},
  x=>x.teams[0].extraTotalCount=-1,
  x=>x.direct.counts.NURO=Infinity,
  x=>x.direct.peopleVerified="yes",
  x=>x.teams.splice(0,1)
 ];
 for(const bad of defects){
  const x=fixture();bad(x);
  assert.throws(()=>reconcileSharedMonthlyCounts(x),/RECONCILIATION_FAILED/);
 }
});
test("2000 partner saved records (2 days) reconcile, 2001 are refused rather than truncated",()=>{
 const categories=["NURO","SBMNP"];
 const doc=(date,id)=>({id:date+"__"+id,data:()=>({
  companyId:"partner",hubCompanyId:"hub",date,staffId:id,
  staffNameSnapshot:"担当",teamIdSnapshot:"team",
  totalCount:2,counts:{NURO:2,SBMNP:0},version:1,
  privateCounts:{hidden:5},privateTotalCount:5,
  revenue:950000,unitPrice:65000
 })});
 const records=Array.from({length:2000},(_,i)=>doc(
  i<1000?"2026-11-01":"2026-11-02","p"+(i%1000)));
 const options={hubId:"hub",cid:"partner",companyName:"協力店",
  from:"2026-11-01",to:"2026-11-03",keys:categories,
  legacyDocs:records,extraDocs:[]};
 const result=projectPartnerMonth(options);
 assert.equal(result.totalCount,4000);assert.equal(result.people.length,1000);
 assert.equal(result.teams.length,1);
 const combined=reconcileSharedMonthlyCounts({
  categories,companies:[{id:"partner",totalCount:result.totalCount,
   extraTotalCount:0,counts:result.counts,peopleVerified:true}],
  people:result.people,teams:result.teams,productCounts:result.counts,
  additionalTotalCount:0,
  direct:{counts:{NURO:0,SBMNP:0},otherCount:0,
   totalCount:0,peopleVerified:true,recordsVerified:0,people:[],teams:[]}
 });
 assert.equal(combined.partnerTotalCount,4000);
 assert.equal(combined.complete,false);
 assert.doesNotMatch(JSON.stringify(result),/hidden|950000|65000|unitPrice|revenue/);
 assert.throws(()=>projectPartnerMonth({...options,
  legacyDocs:[...records,doc("2026-11-03","extra")]}),/UNVERIFIED/);
 // A single mismatched total in 2000 is not silently corrected.
 const wrong={...records[125],data:()=>({...records[125].data(),totalCount:3})};
 const contaminated=[...records];contaminated[125]=wrong;
 assert.throws(()=>projectPartnerMonth({...options,legacyDocs:contaminated}),/UNVERIFIED/);
});
test("direct 2501 synthetic staff/day results stay count-only and no 1-record drift is accepted",async()=>{
 const records=Array.from({length:2501},(_,i)=>({
  data:()=>({companyId:"hub",uid:"u"+i,date:"2026-11-03",
   teamId:"team",teamNameSnapshot:"直営班",memberNameSnapshot:"担当",
   totalCount:2,results:[{productId:"nuro",productNameSnapshot:"NURO光",count:2}],
   totalRevenue:1999999,revenuePerUnit:999999})
 }));
 const makeDb=(docs)=>({collection(name){
  const data=name==="records"?docs:[{id:"nuro",data:()=>({companyId:"hub",name:"NURO光"})}];
  return {where(){return this;},limit(){return this;},
   async get(){return {size:data.length,docs:data};}};
 }});
 const run=docs=>readDirectRangeCounts(makeDb(docs),"hub",
  "2026-11-03","2026-11-03",["NURO"],{maxRecords:10000});
 const good=await run(records);
 assert.equal(good.totalCount,5002);
 assert.equal(good.people.length,2501);
 assert.equal(good.teams[0].totalCount,5002);
 assert.doesNotMatch(JSON.stringify(good),/1999999|999999|totalRevenue|revenuePerUnit/);
 const corrupted=records.slice();
 corrupted[2500]={data:()=>({...records[2500].data(),totalCount:3})};
 await assert.rejects(run(corrupted),/DIRECT_TOTAL_MISMATCH/);
});
test("monthly shared server verifies all layers before ranking group creation and never stores totals",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const start=service.indexOf(" async function viewMonthly(request){");
 const end=service.indexOf(" async function view(request){",start);
 assert(start>=0&&end>start);
 const month=service.slice(start,end);
 const verify=month.indexOf("reconcileSharedMonthlyCounts({");
 const ranking=month.indexOf("groupPersonalScores(");
 assert(verify>0&&ranking>verify);
 assert.match(month.slice(verify,ranking),/catch\{fail\("data-loss"\);\}/);
 assert.doesNotMatch(month,/tx\.(?:set|update|create|delete)\(/);
 assert.match(month,/complete:false/);
});

test("balanced cross-company transfers of people or teams cannot silently create wrong winners",()=>{
 for(const field of ["people","teams"]){
  const x=fixture(),before=copy(x);
  // Both source totals remain correct: only the company attribution changes.
  const first=x[field][0].companyId;
  x[field][0].companyId=x[field][1].companyId;
  x[field][1].companyId=first;
  assert.throws(()=>reconcileSharedMonthlyCounts(x),/RECONCILIATION_FAILED/);
  assert.equal(x.companies[0].totalCount,before.companies[0].totalCount);
  assert.equal(x.companies[1].totalCount,before.companies[1].totalCount);
 }
});
test("per-company identities cannot be inferred from shared display names",()=>{
 const x=fixture();
 x.companies[0].name="協力店";x.companies[1].name="協力店";
 for(const person of x.people)person.companyName="協力店";
 for(const team of x.teams)team.companyName="協力店";
 assert.equal(reconcileSharedMonthlyCounts(x).partnerTotalCount,7);
 x.people[1].companyId="partnerA";
 assert.throws(()=>reconcileSharedMonthlyCounts(x),/RECONCILIATION_FAILED/);
});
test("missing, unknown or inconsistent company scopes refuse monthly rankings",()=>{
 for(const modify of [
  x=>{delete x.people[0].companyId;},
  x=>x.teams[0].companyId="partnerOutside",
  x=>x.people[0].companyId="partnerB",
  x=>x.teams[1].companyId="partnerA"
 ]){
  const x=fixture();modify(x);
  assert.throws(()=>reconcileSharedMonthlyCounts(x),/RECONCILIATION_FAILED/);
 }
});
