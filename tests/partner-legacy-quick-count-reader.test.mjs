import test from "node:test";
import assert from "node:assert/strict";
import {createPartnerLegacyQuickMonthReader}
 from "../ranking/partner-legacy-quick-count-reader.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";
const TIME="2026-11-09T00:00:00.000Z";
const ts={seconds:1794182400,nanoseconds:0,toDate:()=>new Date(TIME)};
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=(nuro=0,combined=0)=>Object.fromEntries(KEYS.map(k=>
 [k,k==="NURO"?nuro:k==="SB光・AIR"?combined:0]));
const ctx={serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",
 hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],role:"hub_owner",
 userActive:true,memberActive:true,companyActive:true,
 reciprocalOwnersApproved:true,individualNamesApproved:true,
 completeSnapshotBudgetApproved:true};
const products=KEYS.map((name,i)=>({companyId:"partner",
 sourceId:"partnerSku"+String(i+1).padStart(2,"0"),
 name:i===4?"SB光・AIR（旧合算・未分類）":name,active:true,sortOrder:0}));
const partnerSource=()=>({companyId:"partner",companyLabel:"協力店",
 kind:"partner",isComplete:true,consentVerified:true,readTime:TIME,
 completeWindows:{current:true,previous:false},
 teams:[],roster:[],records:[],lines:[],products});
const legacy=(day="2026-11-08",nuro=3,combined=2)=>({
 hubCompanyId:"hub",partnerCompanyId:"partner",date:day,version:1,
 counts:counts(nuro,combined),totalCount:nuro+combined,
 // A legacy source may contain private metadata; it must NEVER be copied.
 writerEmail:"private@example.invalid",internalAmount:999999
});
function fake({legacyDays={"2026-11-08":legacy()},staffDays=[],time=ts}={}){
 const reads=[],writes=[];
 const doc=path=>({path,collection:name=>collection(path+"/"+name)});
 const collection=path=>({path,doc:id=>doc(path+"/"+id)});
 const db={collection};
 const tx={get:async ref=>{
  reads.push(ref.path);
  const parts=ref.path.split("/"),day=parts[3],kind=parts[2];
  if(parts.length!==6||parts[0]!=="companies"||parts[1]!=="hub"||
     parts[4]!=="reports"||parts[5]!=="partner"||
     !["partnerWorkCountDays","partnerQuickCountDays"].includes(kind))
   throw Error("UNEXPECTED_FIRESTORE_READ");
  const isQuick=kind==="partnerQuickCountDays";
  const row=isQuick?legacyDays[day]:staffDays.includes(day)?{source:"staff-entries-v1"}:undefined;
  return {exists:!!row,readTime:time,data:()=>structuredClone(row)};
 },set:()=>writes.push("set"),create:()=>writes.push("create"),
  update:()=>writes.push("update"),delete:()=>writes.push("delete")};
 return {db,tx,reads,writes};
}
const load=async(f,overrides={})=>createPartnerLegacyQuickMonthReader({db:f.db})({
 tx:f.tx,context:ctx,hubCompanyId:"hub",partnerCompanyId:"partner",
 month:"2026-11",source:partnerSource(),...overrides
});
test("old quick counts are recovered once as company-only, never assigned to staff or team",async()=>{
 const f=fake(),rows=await load(f);
 assert.equal(rows.reduce((n,r)=>n+r.count,0),5);
 assert.deepEqual(rows.map(x=>[x.productId,x.count]),[
  ["partnerSku01",3],["partnerSku05",2]
 ]);
 assert(rows.every(x=>x.companyId==="partner"&&x.kind==="company-code-ledger"&&
  x.exclusiveVerified===true&&!Object.hasOwn(x,"uid")&&!Object.hasOwn(x,"teamId")));
 assert.equal(f.reads.length,60,"every day has a staff+legacy report read");
 assert.deepEqual(f.writes,[]);
 assert(!/internalAmount|writerEmail|private@example|999999/.test(JSON.stringify(rows)));
});
test("legacy counts participate in ON/OFF + exact SKU mapping without touching history",async()=>{
 const f=fake(),unassigned=await load(f),before=structuredClone(unassigned);
 const hub={companyId:"hub",companyLabel:"本社",kind:"own",
  consentVerified:true,isComplete:true,readTime:TIME,
  completeWindows:{current:true,previous:false},
  teams:[],roster:[],records:[],lines:[],products:[
   {companyId:"hub",sourceId:"nuro",name:"NURO光",active:true,sortOrder:0},
   {companyId:"hub",sourceId:"combined",name:"SB光・AIR（旧合算・未分類）",
    active:true,sortOrder:1}
  ]};
 const input={hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  context:ctx,period:{kind:"month",day:"2026-11-01",asOf:"2026-11-09"},
  sources:[hub,partnerSource()],unassigned,personGoals:[],historicalBest:[],
  productGroups:[
   {companyId:"hub",productId:"nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:"hub",productId:"combined",groupId:"combined",
    groupName:"SB光・AIR（旧合算・未分類）"},
   {companyId:"partner",productId:"partnerSku01",groupId:"nuro",groupName:"NURO光"},
   {companyId:"partner",productId:"partnerSku05",groupId:"combined",
    groupName:"SB光・AIR（旧合算・未分類）"}
  ]};
 const publication=enabledHubProductIds=>({serverVerified:true,
  ownerSettingsRead:true,ownerUidVerified:true,productMappingsReviewed:true,
  hubCompanyId:"hub",revision:1,enabledHubProductIds});
 const all=buildOwnerVisibleCountRanking({input,publication:publication(["nuro","combined"])});
 assert.deepEqual(all.summary,{own:0,partner:5,total:5,unidentified:5});
 assert.equal(all.companyBreakdown.find(c=>c.id==="partner").count,5);
 assert.equal(all.memberRanking.length,0,"cannot invent an employee");
 assert.equal(all.teamBreakdown.length,0,"cannot invent a team");
 const off=buildOwnerVisibleCountRanking({input,publication:publication(["combined"])});
 assert.equal(off.summary.total,2);
 const disabled=buildOwnerVisibleCountRanking({input,publication:publication([])});
 assert.equal(disabled.summary.total,0);
 assert.equal(buildOwnerVisibleCountRanking({
  input,publication:publication(["nuro","combined"])
 }).summary.total,5);
 assert.deepEqual(unassigned,before);
 assert.deepEqual(f.writes,[]);
});
test("explicit historical zero remains a report while an absent day is unreported",async()=>{
 const f=fake({legacyDays:{"2026-11-09":legacy("2026-11-09",0,0)}});
 const rows=await load(f);
 assert.equal(rows.length,9);
 assert(rows.every(x=>x.date==="2026-11-09"&&x.count===0));
 assert.equal(rows.reduce((s,x)=>s+x.count,0),0);
 const empty=await load(fake({legacyDays:{}}));
 assert.deepEqual(empty,[]);
});
test("overlapping staff and old quick days fail rather than duplicate count",async()=>{
 await assert.rejects(load(fake({staffDays:["2026-11-08"]})),
  /PARTNER_LEGACY_QUICK_MONTH_UNVERIFIED/);
 await assert.rejects(load(fake(),{source:{
  ...partnerSource(),records:[{companyId:"partner",date:"2026-11-08"}]
 }}),/PARTNER_LEGACY_QUICK_MONTH_UNVERIFIED/);
});
test("bad legacy totals, forged relation, changed timestamp and invalid context stop",async()=>{
 for(const row of [
  {...legacy(),totalCount:1},
  {...legacy(),date:"2026-11-31"},
  {...legacy(),partnerCompanyId:"other"},
  {...legacy(),version:0},
  {...legacy(),counts:{...counts(),NURO:-1}},
  {...legacy(),counts:{NURO:3}}
 ]){
  await assert.rejects(load(fake({legacyDays:{"2026-11-08":row}})),
   /PARTNER_LEGACY_QUICK_MONTH_UNVERIFIED/);
 }
 await assert.rejects(load(fake({time:{...ts,nanoseconds:1,
  toDate:()=>new Date("2026-11-09T00:01:00.000Z")}})),
  /PARTNER_LEGACY_QUICK_MONTH_UNVERIFIED/);
 const f=fake();
 await assert.rejects(load(f,{context:{...ctx,approvedCompanyIds:["hub"]}}),
  /PARTNER_LEGACY_QUICK_MONTH_UNVERIFIED/);
 assert.deepEqual(f.reads,[],"forged company scope must not touch Firestore");
});
