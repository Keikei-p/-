import test from "node:test";
import assert from "node:assert/strict";
import {createPartnerMonthReadOnlyLoader,createPartnerMonthTransactionReader} from
 "../ranking/partner-month-readonly-loader.mjs";
import {buildCombinedCountLeaderboard} from
 "../ranking/combined-count-leaderboard.mjs";
import {createRankOnlyPublication} from "../ranking/rank-only-publication.mjs";

const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const zeros=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const withCount=(nuro=0,sb=0)=>({...zeros(),NURO:nuro,"SB光・AIR":sb});
const total=x=>Object.values(x).reduce((a,b)=>a+b,0);
const RT={seconds:1794103200,nanoseconds:0,
 toDate:()=>new Date("2026-11-08T02:00:00.000Z")};
const clone=x=>JSON.parse(JSON.stringify(x));
function seeded(){
 const documents=new Map([
  ["companies/own",{name:"NICO",active:true,companyKind:"internal"}],
  ["companies/partner",{name:"協力店A",active:true,companyKind:"partner",hubCompanyId:"own"}],
  ["partnerRelations/partner",{
   hubCompanyId:"own",partnerCompanyId:"partner",active:true,
   countSharingApproved:true,combinedRankingApprovedByHub:true,
   combinedRankingApprovedByPartner:true,individualNamesApprovedByHub:true,
   individualNamesApprovedByPartner:true
  }],
  ["companies/partner/partnerWorkTeams/team1",{
   name:"第一班",companyId:"partner",active:true
  }]
 ]);
 const makeEntry=(day,staff,counts)=>({
  companyId:"partner",hubCompanyId:"own",staffId:staff,
  date:day,counts,totalCount:total(counts),version:2,
  teamIdSnapshot:"team1",staffNameSnapshot:"担当"+staff,
  privateCounts:{"secret-private":2},privateTotalCount:2
 });
 for(const [day,staff,count] of [
  ["2026-11-07","member1",withCount(2,1)],
  ["2026-11-08","member2",withCount(1,0)]
 ]){
  documents.set("companies/partner/partnerWorkEntries/"+day+"__"+staff,
   makeEntry(day,staff,count));
  documents.set("companies/own/partnerWorkCountDays/"+day+
   "/reports/partner",{
    source:"staff-entries-v1",hubCompanyId:"own",partnerCompanyId:"partner",
    date:day,counts:count,totalCount:total(count)
   });
 }
 return documents;
}
class Ref{
 constructor(p){this.path=p;}
 collection(s){return new Coll(this.path+"/"+s);}
}
class Query{
 constructor(path,filters=[],limit=Infinity){
  this.path=path;this.filters=filters;this.max=limit;
 }
 where(field,op,val){
  return new Query(this.path,[...this.filters,[field,op,val]],this.max);
 }
 limit(n){return new Query(this.path,this.filters,n);}
}
class Coll extends Query{
 constructor(path){super(path);}
 doc(id){return new Ref(this.path+"/"+id);}
}
function fake(initial=seeded()){
 const documents=initial,events=[];
 const snap=(path,value)=>{
  const id=path.split("/").at(-1);
  return {id,exists:value!==undefined,
   readTime:RT,data:()=>clone(value)};
 };
 const db={
  collection:(path)=>new Coll(path),
  async runTransaction(fn,opts){
   events.push({kind:"transaction",options:opts});
   const tx={async get(ref){
    events.push({kind:"get",path:ref.path,filters:ref.filters||[]});
    if(ref instanceof Ref)return snap(ref.path,documents.get(ref.path));
    let list=[...documents.entries()]
     .filter(([path])=>path.startsWith(ref.path+"/")&&
       !path.slice(ref.path.length+1).includes("/"))
     .filter(([,value])=>ref.filters.every(([field,op,v])=>
      op===">="?value[field]>=v:op==="<="?value[field]<=v:false))
     .map(([path,value])=>snap(path,value));
    return {readTime:RT,docs:list.slice(0,ref.max),
     size:Math.min(list.length,ref.max)};
   }};
   return fn(tx);
  }
 };
 return {db,events,documents};
}
const approved={
 serverVerified:true,userActive:true,memberActive:true,companyActive:true,
 reciprocalOwnersApproved:true,individualNamesApproved:true,
 completeSnapshotBudgetApproved:true,hubCompanyId:"own",
 approvedCompanyIds:["own","partner"]
};
const request=(context=approved)=>({
 hubCompanyId:"own",partnerCompanyId:"partner",month:"2026-11",context
});
test("reads actual workspace collection paths in ONE read-only transaction",async()=>{
 const fixture=fake(),before=clone([...fixture.documents]);
 const out=await createPartnerMonthReadOnlyLoader({db:fixture.db})(request());
 assert.equal(out.companyId,"partner");
 assert.equal(out.records.length,2);
 assert.equal(out.records.reduce((s,x)=>s+x.totalCount,0),4);
 assert.equal(out.lines.reduce((s,x)=>s+x.count,0),4);
 assert.equal(out.readTime,"2026-11-08T02:00:00.000Z");
 assert.equal(out.records[0].teamId,"team1");
 assert(!JSON.stringify(out).includes("secret-private"));
 assert(!JSON.stringify(out).includes("privateCounts"));
 assert(!JSON.stringify(out).includes("totalRevenue"));
 assert.deepEqual([...fixture.documents],before);
 assert.equal(fixture.events.filter(e=>e.kind==="transaction").length,1);
 assert.deepEqual(fixture.events[0].options,{readOnly:true});
 assert(fixture.events.some(e=>e.path==="companies/partner/partnerWorkEntries"&&
  e.kind==="get"));
 assert(fixture.events.some(e=>e.path==="companies/own/partnerWorkCountDays/2026-11-08/reports/partner"));
});
test("both owner consents and name approvals required independently of legacy count sharing",async()=>{
 for(const key of [
  "active","countSharingApproved","combinedRankingApprovedByHub",
  "combinedRankingApprovedByPartner","individualNamesApprovedByHub",
  "individualNamesApprovedByPartner"
 ]){
  const f=fake();f.documents.get("partnerRelations/partner")[key]=false;
  await assert.rejects(createPartnerMonthReadOnlyLoader({db:f.db})(request()),
   /INCOMPLETE/,key);
 }
 for(const key of ["userActive","memberActive","companyActive",
  "reciprocalOwnersApproved","individualNamesApproved",
  "completeSnapshotBudgetApproved","serverVerified"]){
  const f=fake();
  const ctx={...approved,[key]:false};
  await assert.rejects(createPartnerMonthReadOnlyLoader({db:f.db})(request(ctx)),
   /INCOMPLETE/,key);
 }
});
test("incomplete query and summary mismatch stop rather than present false ranking",async()=>{
 const scenarios=[
  d=>d.delete("companies/own/partnerWorkCountDays/2026-11-07/reports/partner"),
  d=>{d.get("companies/own/partnerWorkCountDays/2026-11-07/reports/partner").counts.NURO=99;},
  d=>{d.get("companies/partner/partnerWorkEntries/2026-11-07__member1").version=0;},
  d=>{d.get("companies/partner/partnerWorkEntries/2026-11-07__member1").id="forged";},
  d=>{d.get("companies/partner/partnerWorkEntries/2026-11-07__member1").teamIdSnapshot="lostTeam";},
  d=>{d.get("companies/partner/partnerWorkEntries/2026-11-07__member1").counts.NURO=20;},
  d=>{d.get("companies/partner/partnerWorkEntries/2026-11-07__member1").privateCounts={"cashback":100000};d.get("companies/partner/partnerWorkEntries/2026-11-07__member1").totalCount=999;},
  d=>{d.get("companies/partner").hubCompanyId="other";},
  d=>{d.get("companies/partner").active=false;}
 ];
 for(let i=0;i<scenarios.length;i++){
  const f=fake();scenarios[i](f.documents);
  const before=clone([...f.documents]);
  await assert.rejects(createPartnerMonthReadOnlyLoader({db:f.db})(request()),
   undefined,"scenario "+i);
  assert.deepEqual([...f.documents],before,"failed read must not mutate data");
 }
});
test("query ceiling 2000 disallows partial leaderboard (including duplicate days)",async()=>{
 const f=fake();
 for(let i=0;i<2001;i++){
  const staff="staff"+i;
  f.documents.set("companies/partner/partnerWorkEntries/2026-11-07__"+staff,{
   companyId:"partner",hubCompanyId:"own",staffId:staff,
   date:"2026-11-07",counts:withCount(1),totalCount:1,version:1,
   teamIdSnapshot:"team1",staffNameSnapshot:"検証"
  });
 }
 await assert.rejects(createPartnerMonthReadOnlyLoader({db:f.db})(request()),
  /INCOMPLETE/);
});
test("missing partner, invalid month and forged client company fail without data disclosure",async()=>{
 for(const params of [
  {...request(),partnerCompanyId:"not-approved"},
  {...request(),partnerCompanyId:"own"},
  {...request(),month:"2026-13"},
  {...request(),month:"2026-11-32"},
  {...request(),context:{...approved,approvedCompanyIds:["own"]}},
  {...request(),context:{...approved,hubCompanyId:"untrusted"}}
 ]){
  const f=fake();
  await assert.rejects(createPartnerMonthReadOnlyLoader({db:f.db})(params));
 }
});
test("existing approved monthly source works with rank-only engine and never publishes amounts",async()=>{
 const f=fake(),partner=await createPartnerMonthReadOnlyLoader({db:f.db})(request());
 const own={
  companyId:"own",companyLabel:"自社",kind:"own",consentVerified:true,
  isComplete:true,readTime:partner.readTime,
  teams:[{id:"t1",name:"自社班",goalCount:null}],
  records:[{companyId:"own",sourceId:"r1",uid:"u1",date:"2026-11-07",
   teamId:"t1",totalCount:2,reportStatus:"submitted",
   memberNameSnapshot:"自社A",teamNameSnapshot:"自社班",workLocation:""}],
  lines:[{companyId:"own",recordId:"r1",sourceId:"r1__0",
   date:"2026-11-07",uid:"u1",teamId:"t1",productId:"nuro",count:2}],
  products:[{companyId:"own",sourceId:"nuro",name:"NURO",active:true,sortOrder:0}]
 };
 const data={hubCompanyId:"own",approvedCompanyIds:["own","partner"],
  period:"2026-11",sources:[own,partner],productGroups:[
   {companyId:"own",productId:"nuro",groupId:"NURO",groupName:"NURO"},
   {companyId:"partner",productId:"partnerSku01",groupId:"NURO",groupName:"NURO"}
  ]};
 const internal=buildCombinedCountLeaderboard(data);
 assert.equal(internal.combinedCount,6);
 assert.equal(internal.productCountRanking.find(x=>x.name==="NURO").count,5);
 const out=createRankOnlyPublication(data);
 assert.equal(out.memberRanks.length,3);
 assert(!/"(?:count|totalCount|revenue|price|unitPrice|cashback)"/i.test(JSON.stringify(out)));
});

test("shared caller-owned transaction reads canonical partner ledger without nesting",async()=>{
 const f=fake(),reader=createPartnerMonthTransactionReader({db:f.db});
 const before=clone([...f.documents]);
 await assert.rejects(reader(request()),/INCOMPLETE/,
  "a trusted caller must supply a real transaction");
 assert.equal(f.events.length,0,"no Firestore calls without tx");
 const out=await f.db.runTransaction(async tx=>{
  const first=await reader({...request(),tx});
  const second=await reader({...request(),tx});
  assert.deepEqual(first,second);
  return first;
 },{readOnly:true});
 assert.equal(out.records.length,2);
 assert.equal(out.lines.reduce((sum,row)=>sum+row.count,0),4);
 assert.equal(f.events.filter(e=>e.kind==="transaction").length,1,
  "both canonical reads must reuse exactly one outer transaction");
 assert.deepEqual([...f.documents],before);
 assert(!/privateCounts|secret-private|cashback|unitPrice|revenue/.test(JSON.stringify(out)));
});

test("shared transaction reader fails closed on revoked consent or partial month",async()=>{
 for(const mutate of [
  docs=>{docs.get("partnerRelations/partner").combinedRankingApprovedByHub=false;},
  docs=>{docs.delete("companies/own/partnerWorkCountDays/2026-11-07/reports/partner");},
  docs=>{docs.get("companies/partner/partnerWorkEntries/2026-11-07__member1").counts.NURO=88;}
 ]){
  const f=fake();mutate(f.documents);
  const reader=createPartnerMonthTransactionReader({db:f.db});
  await assert.rejects(f.db.runTransaction(tx=>reader({...request(),tx}),
   {readOnly:true}),/INCOMPLETE/);
  assert.equal(f.events.filter(e=>e.kind==="transaction").length,1);
 }
});

test("standalone loader never trusts an injected transaction from request",async()=>{
 const f=fake(),loader=createPartnerMonthReadOnlyLoader({db:f.db});
 const result=await loader({...request(),tx:{get(){throw Error("injected");}}});
 assert.equal(result.companyId,"partner");
 assert.equal(f.events.filter(e=>e.kind==="transaction").length,1);
});

test("active registered staff without saved reports remain explicitly unreported in the source",async()=>{
 const f=fake();
 const base="companies/partner/partnerWorkStaff/";
 f.documents.set(base+"newStaff",{
  companyId:"partner",active:true,teamId:"team1",
  name:"登録済み未報告",kind:"managed"
 });
 f.documents.set(base+"retired",{
  companyId:"partner",active:false,teamId:"team1",
  name:"退職者",kind:"managed"
 });
 const original=clone([...f.documents]);
 const result=await createPartnerMonthReadOnlyLoader({db:f.db,clock:()=>new Date("2026-11-14T00:00:00Z")})(request());
 assert.deepEqual(result.roster,[{
  uid:"newStaff",name:"登録済み未報告",teamId:"team1"
 }]);
 assert.equal(result.records.length,2);
 assert.equal(result.lines.reduce((sum,x)=>sum+x.count,0),4);
 assert(!result.records.some(x=>x.uid==="newStaff"),
  "registered unreported staff must not be given a synthetic zero report");
 assert(f.events.some(e=>e.kind==="get"&&
  e.path==="companies/partner/partnerWorkStaff"));
 assert.deepEqual([...f.documents],original,"strictly read-only");
 for(const modify of [
  p=>{p.companyId="other-company";},
  p=>{p.teamId="unknown-team";},
  p=>{p.name="staff cashback";},
  p=>{p.active="true";}
 ]){
  const bad=fake();
  const row={...f.documents.get(base+"newStaff")};
  modify(row);
  bad.documents.set(base+"newStaff",row);
  await assert.rejects(createPartnerMonthReadOnlyLoader({db:bad.db,clock:()=>new Date("2026-11-14T00:00:00Z")})(request()),
   /INCOMPLETE/,"invalid roster must fail before publication");
 }
});

test("historical month never promotes today's registered staff to an old missing report",async()=>{
 const f=fake();
 f.documents.set("companies/partner/partnerWorkStaff/newStaff",{
  companyId:"partner",active:true,teamId:"team1",
  name:"来月からの新規担当",kind:"managed"
 });
 const past=await createPartnerMonthReadOnlyLoader({
  db:f.db,clock:()=>new Date("2026-12-10T02:00:00Z")
 })(request());
 assert.deepEqual(past.roster,[],
  "present-day roster must not invent past-month registration or missing reports");
 assert.equal(past.records.length,2,"historical saved records are retained");
 assert.equal(past.lines.reduce((sum,row)=>sum+row.count,0),4);
 const now=await createPartnerMonthReadOnlyLoader({
  db:f.db,clock:()=>new Date("2026-11-14T02:00:00Z")
 })(request());
 assert.deepEqual(now.roster,[{uid:"newStaff",
  name:"来月からの新規担当",teamId:"team1"}]);
});
