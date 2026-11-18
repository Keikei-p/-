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
 // A client-provided OFF view with unredacted counts is NOT trustworthy.
 s.enabledCategories=[];invalid(()=>view(s));
 // Only the SERVER's redacted response is valid; stored original fixture stays
 // untouched outside this synthetic view fixture.
 s.records[0].counts=zero();s.records[0].totalCount=0;
 const r=view(s);
 assert.deepEqual(r.publicInputs,[]);
 assert.equal(r.dayCount,0);
 assert.equal(r.oldPrivateCount,4);
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

test("partner team detail uses exact self leader headings but no revenue, price or cashback",()=>{
 const source=fixture();
 const before=structuredClone(source);
 const r=view(source);
 const first=r.teamDetails.find(t=>t.id==="team1");
 assert.equal(first.title,"1班");
 assert.equal(first.headerClassName,"team-detail-header");
 assert.equal(first.titleClassName,"team-detail-title");
 assert.equal(first.totalClassName,"team-detail-total");
 assert.equal(first.memberMeta,"現在の所属 2人");
 assert.equal(first.totalLabel,"5件");
 assert.equal(first.productsTitle,"商材別件数");
 assert.equal(first.peopleTitle,"班員別詳細");
 assert.equal(first.goalLabel,"目標未設定");
 assert.equal(first.productRows.find(p=>p.name==="NURO").count,2);
 assert.equal(first.productRows.find(p=>p.name==="SB光・AIR").count,3);
 // A transferred colleague's old sale stays on saved team1, not current team2.
 const moved=first.peopleRows.find(p=>p.staffId==="staff1");
 assert.equal(moved.countLabel,"5件");
 assert.equal(moved.submitted,true);
 const missing=first.peopleRows.find(p=>p.staffId==="staff3");
 assert.equal(missing.countLabel,"未報告");
 assert.equal(missing.totalCount,null);
 assert.equal(first.moneySectionIncluded,false);
 assert.equal(first.financeLabelsIncluded,false);
 assert.equal(r.teamDetails.find(t=>t.id==="team2").totalCount,0);
 assert.equal(JSON.stringify(r.teamDetails).includes("旧配属先"),false);
 for(const s of ["売上","単価","キャッシュバック","￥","¥","revenue","cashback","workLocation","uid"])
  assert.equal(JSON.stringify(r.teamDetails).includes(s),false,s);
 assert.deepEqual(source,before);
});
test("unknown historical team remains unallocated; no fabricated member or team totals",()=>{
 const source=fixture();source.records[0].teamIdSnapshot="formerTeam";
 const r=view(source);
 assert.equal(r.unknownHistoricalTeamCount,5);
 assert.equal(r.teamDetails.reduce((n,t)=>n+t.totalCount,0),0);
 assert.equal(r.dayCount,5);
 assert.equal(r.teamDetails.find(t=>t.id==="team1").peopleRows.some(p=>p.staffId==="staff1"),false);
});
test("OFF products are never shown as editable partner products, and saved count remains in source",()=>{
 const source=fixture();
 source.enabledCategories=["NURO"];
 source.records[0].counts["SB光・AIR"]=0;
 source.records[0].totalCount=2;
 const oldCount=source.records[0].privateTotalCount;
 const r=view(source);
 assert.deepEqual(r.teamDetails[0].productRows.map(p=>p.name),["NURO"]);
 assert.equal(r.teamDetails[0].totalCount,2);
 assert.equal(r.oldPrivateCount,oldCount);
 assert.equal(source.records[0].privateTotalCount,4);
});
