import test from "node:test";
import assert from "node:assert/strict";
import {buildPartnerSharedLeaderCountView as view}
 from "../ranking/unified-leader-count-view-model.mjs";
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
function fixture(){
 return {
  role:"leader",date:"2026-11-18",companyName:"協力店A",teamId:"team1",
  teams:[{id:"team1",name:"1班",active:true},
   {id:"team2",name:"2班",active:true}],
  staff:[
   {id:"staff1",name:"スタッフA",teamId:"team2",active:true,
    kind:"managed",role:"member",uid:null},
   {id:"staff2",name:"スタッフB",teamId:"team1",active:true,
    kind:"managed",role:"member",uid:null},
   {id:"staff3",name:"スタッフC",teamId:"team1",active:true,
    kind:"managed",role:"member",uid:null}
  ],
  records:[
   {staffId:"staff1",counts:{...zero(),NURO:2,"SB光・AIR":3},totalCount:5,
    version:2,teamIdSnapshot:"team1",workLocation:"旧配属先",
    privateCounts:{p1:4},privateTotalCount:4},
   {staffId:"staff2",counts:zero(),totalCount:0,
    version:1,teamIdSnapshot:"team1",workLocation:"",
    privateCounts:{},privateTotalCount:0}
  ],
  categories:KEYS,enabledCategories:["NURO","SB光・AIR"],
  privateProducts:[{id:"p1",name:"旧商材（要対応）",active:false}]
 };
}
const invalid=fn=>assert.throws(fn,/NICO_SHARED_LEADER_COUNT_VIEW_UNVERIFIED/);
test("same leader UI count-only fields: saved team snapshot prevails over current team",()=>{
 const source=fixture(),prior=structuredClone(source);
 const result=view(source);
 assert.equal(result.schema,"nico-unified-leader-count-ui-v1");
 assert.equal(result.dayCount,5);
 assert.equal(result.teams.find(t=>t.id==="team1").totalCount,5);
 assert.equal(result.teams.find(t=>t.id==="team2").totalCount,0);
 assert.equal(result.dayRecords[0].teamId,"team1");
 assert.equal(result.dayRecords[0].teamName,"1班");
 assert.equal(result.dayRecords[0].version,2);
 assert.equal(result.members.find(x=>x.id==="staff1").teamId,"team2");
 assert.deepEqual(source,prior);
});
test("submitted zero is counted as a report; member without row remains unreported",()=>{
 const result=view(fixture());
 assert.equal(result.teams.find(t=>t.id==="team1").submittedStaffCount,2);
 assert.equal(result.teams.find(t=>t.id==="team1").missingStaffCount,1);
 assert.equal(result.dayRecords.find(r=>r.staffId==="staff2").reportStatus,"submitted");
 assert.equal(result.dayRecords.find(r=>r.staffId==="staff2").totalCount,0);
 assert.equal(result.members.find(x=>x.id==="staff3").reported,false);
});
test("old private product 4件 preserved separately, never added twice to public rank or dayCount",()=>{
 const s=fixture(),r=view(s);
 assert.equal(r.oldPrivateCount,4);
 assert.equal(r.oldPrivateProducts[0].count,4);
 assert.equal(r.oldPrivateProducts[0].active,false);
 assert.equal(r.dayCount,5);
 assert.equal(r.historicCompanyOnlyCount,"REQUIRES_APPROVED_RANKING_READ");
 assert.equal(r.rankedResult,"REQUIRES_SEPARATE_SERVER_VERIFIED_RANKING");
});
test("historical record with unknown team is not assigned to person's current team",()=>{
 const s=fixture();s.records[0].teamIdSnapshot="old_team";
 const r=view(s);
 assert.equal(r.unknownHistoricalTeamCount,5);
 assert.equal(r.dayRecords[0].teamId,null);
 assert.equal(r.dayRecords[0].teamName,"当時の班未確認");
 assert.equal(r.teams.reduce((n,t)=>n+t.totalCount,0),0);
});
test("no published Owner allowlist means shared UI cannot guess valid products",()=>{
 const s=fixture();delete s.enabledCategories;
 invalid(()=>view(s));
 s.enabledCategories=[];const r=view(s);
 assert.deepEqual(r.publicInputs,[]);
 assert.equal(r.dayCount,5);
});
test("published OFF excludes new inputs but cannot destroy historical count values",()=>{
 const s=fixture();s.enabledCategories=["NURO"];
 s.records[0].counts["SB光・AIR"]=0;s.records[0].totalCount=2;
 const r=view(s);
 assert.deepEqual(r.publishedCategories,["NURO"]);
 assert.equal(r.dayCount,2);
 assert.equal(r.oldPrivateCount,4);
 assert.deepEqual(s.records[0].counts,({...zero(),NURO:2}));
});
test("future flag can show split inputs only when already server-authorized",()=>{
 const s=fixture();s.sbSeparateInputEnabled=true;
 s.records[0].sbBreakdown={"SB光":1,"SB AIR":2,"旧未分類":0};
 const r=view(s);
 assert.equal(r.lightAirSeparateInputEnabled,true);
 assert.deepEqual(r.dayRecords[0].sbBreakdown,{"SB光":1,"SB AIR":2,"旧未分類":0});
});
test("reject inconsistent totals, collisions, unknown products, and fabricated split",()=>{
 const s=fixture();s.records[0].totalCount=6;invalid(()=>view(s));
 const s2=fixture();s2.records.push({...s2.records[0]});invalid(()=>view(s2));
 const s3=fixture();s3.records[0].counts={"NURO":2};invalid(()=>view(s3));
 const s4=fixture();s4.records[0].privateTotalCount=3;invalid(()=>view(s4));
 const s5=fixture();s5.records[0].sbBreakdown={"SB光":2,"SB AIR":2,"旧未分類":0};invalid(()=>view(s5));
});
test("reject finance/PII in workspace contract; never project workLocation or UID",()=>{
 const s=fixture();
 invalid(()=>view({...s,revenue:10000}));
 invalid(()=>view({...s,records:[{...s.records[0],unitPrice:8000}]}));
 invalid(()=>view({...s,teams:[{...s.teams[0],finance:1}]}));
 const out=JSON.stringify(view(s));
 for(const forbidden of ["uid","workLocation","旧配属先","privateCounts","revenue",
  "unitPrice","cashback","recordCorrections"])
  assert.equal(out.includes(forbidden),false,forbidden);
 assert.equal(JSON.stringify(view(s)).includes("旧商材（要対応）"),true);
});
test("no Firebase writes, no ranking calculation, no automatic SKU aliases",()=>{
 const r=view(fixture());
 assert.equal(r.firestoreWrites,0);
 assert.equal(r.financialSourceReads,0);
 assert.equal(r.moneyFieldsIncluded,false);
 assert.equal(r.publicInputs.length,2);
 assert.equal(r.publicInputs.some(x=>x.name==="つばさ電気"),false);
});
