import test from "node:test";
import assert from "node:assert/strict";
import {buildVerifiedCountDashboard}
 from "../ranking/verified-dual-count-dashboards.mjs";
import {buildVerifiedCountDashboard as buildVendorDashboard}
 from "../functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs";

const TIME="2026-11-08T02:15:30.000Z";
const rec=(cid,id,uid,date,n)=>({
 companyId:cid,sourceId:id,uid,date,teamId:"team",
 totalCount:n,reportStatus:n===0?"no_result":"submitted",
 memberNameSnapshot:uid==="p1"?"協力店A担当":"自社担当",
 teamNameSnapshot:"営業班",workLocation:""
});
const ln=(r,p,n,i=0)=>({
 companyId:r.companyId,recordId:r.sourceId,sourceId:r.sourceId+"__"+i,
 date:r.date,uid:r.uid,teamId:r.teamId,productId:p,count:n
});
const src=(cid,kind,records,lines,roster)=>({
 companyId:cid,companyLabel:cid==="hub"?"自社":"協力店A",kind,
 consentVerified:true,isComplete:true,readTime:TIME,
 teams:[{id:"team",name:"営業班",goalCount:null}],
 roster:roster.map(([uid,name])=>({uid,name,teamId:"team"})),
 completeWindows:{current:true,previous:true},
 records,lines,products:[{companyId:cid,sourceId:cid==="hub"?"ownNuro":"partnerSku01",
  name:"NURO",active:true,sortOrder:0},
  {companyId:cid,sourceId:cid==="hub"?"ownOther":"partnerSku05",
   name:"SB光・AIR",active:true,sortOrder:0}]
});
const auth=(role="hub_owner")=>({
 serverVerified:true,userActive:true,memberActive:true,companyActive:true,
 reciprocalOwnersApproved:true,individualNamesApproved:true,
 completeSnapshotBudgetApproved:true,viewerUid:role==="hub_owner"?"owner":"partnerOwner",
 viewerCompanyId:role==="hub_owner"?"hub":"partner",
 hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],role
});
function fixture(partnerCount=2){
 const ownNow=rec("hub","own_now","o1","2026-11-08",1),
  partnerNow=rec("partner","2026-11-08__p1","p1","2026-11-08",partnerCount),
  partnerZero=rec("partner","2026-11-08__p2","p2","2026-11-08",0),
  ownPrevious=rec("hub","own_previous","o1","2026-10-08",1),
  partnerPrevious=rec("partner","partner_previous","p1","2026-10-08",1);
 return {
  context:auth(),hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  period:{kind:"day",day:"2026-11-08",asOf:"2026-11-08"},
  sources:[
   src("hub","own",[ownNow,ownPrevious],
    [ln(ownNow,"ownNuro",1),ln(ownPrevious,"ownNuro",1)],
    [["o1","自社担当"]]),
   src("partner","partner",[partnerNow,partnerZero,partnerPrevious],
    [ln(partnerNow,"partnerSku01",partnerCount),
     ln(partnerPrevious,"partnerSku01",1)],
    [["p1","協力店A担当"],["p2","協力店0件"],["p3","協力店未報告"]])
  ],
  productGroups:[
   {companyId:"hub",productId:"ownNuro",groupId:"nuro",groupName:"NURO"},
   {companyId:"partner",productId:"partnerSku01",groupId:"nuro",groupName:"NURO"}
  ]
 };
}
const build=d=>buildVerifiedCountDashboard(d);
test("2→3 correction is replacement, not additive: hub/company/person/SKU agree",()=>{
 const two=fixture(2);
 two.period={kind:"month",day:"2026-11-08",asOf:"2026-11-08"};
 const before=structuredClone(two);
 const first=build(two);
 assert.deepEqual(first.summary,{own:1,partner:2,total:3,unidentified:0});
 assert.equal(first.memberRanking.find(x=>x.id==="partner:p1").count,2);
 assert.equal(first.productRanking.find(x=>x.id==="nuro").count,3);
 assert.deepEqual(two,before,"input and historical source are immutable");
 const three=fixture(3);
 three.period={kind:"month",day:"2026-11-08",asOf:"2026-11-08"};
 const next=build(three);
 assert.deepEqual(next.summary,{own:1,partner:3,total:4,unidentified:0});
 assert.equal(next.companyBreakdown.find(x=>x.id==="partner").count,3);
 assert.equal(next.memberRanking.find(x=>x.id==="partner:p1").count,3);
 assert.equal(next.productRanking.find(x=>x.id==="nuro").count,4);
 assert.equal(next.memberRanking.find(x=>x.id==="partner:p1").change,2);
 assert.equal(next.memberRanking.find(x=>x.id==="partner:p1").growth,"増加");
 assert.deepEqual(build(three),next,"refresh/retry does not double count");
});
test("equal scores share ranks; filtered individual and SKU views use the SAME lines",()=>{
 const a=fixture(1),all=build(a);
 assert.deepEqual(all.memberRanking.filter(p=>p.count===1).map(p=>p.rank),[1,1]);
 assert.equal(all.memberRanking.find(p=>p.id==="partner:p2").count,0);
 const view=build({...fixture(3),filters:{productId:"nuro"}});
 assert.equal(view.summary.total,4);
 assert.equal(view.memberRanking.find(p=>p.id==="partner:p1").count,3);
 assert.equal(view.memberRanking.find(p=>p.id==="partner:p2").count,0);
 const p=build({...fixture(3),filters:{companyId:"partner",uid:"p1"}});
 assert.equal(p.summary.total,3);
 assert.equal(p.productRanking.find(x=>x.id==="nuro").count,3);
});
test("unreported staff and explicit zero results are never conflated",()=>{
 const x=build(fixture(2));
 const zero=x.memberRanking.find(p=>p.id==="partner:p2"),
  missing=x.memberRanking.find(p=>p.id==="partner:p3");
 assert.equal(zero.reportStatus,"確定0件");
 assert.equal(missing.reportStatus,"未報告");
 assert.equal(zero.count,0);
 assert.equal(missing.count,0);
 assert(Number.isSafeInteger(zero.rank),"submitted zero stays ranked");
 assert.equal(missing.rank,null,"unreported staff never get a numerical rank");
 const partner=build({...fixture(2),context:auth("partner_owner")});
 assert.equal(partner.own.people.find(p=>p.id==="partner:p3").rank,null);
 assert(!partner.publicRanking.members.some(p=>p.name==="協力店未報告"),
  "unreported person is not disclosed as a ranked participant");
 assert(partner.publicRanking.members.some(p=>p.name==="協力店0件"),
  "submitted 0 has ranking eligibility");
});
test("public company ranks exclude wholly unreported company but include submitted zero",()=>{
 const x=fixture(2);
 const silent=src("silent","partner",[],[],[["noReport","未報告担当者"]]);
 silent.companyLabel="未報告会社";
 x.approvedCompanyIds.push("silent");
 x.context.approvedCompanyIds.push("silent");
 x.sources.push(silent);
 const hub=build(x);
 assert.equal(hub.companyBreakdown.find(c=>c.id==="silent").count,0,
  "Owner may still inspect an unreported company");
 const partner=build({...x,context:{...auth("partner_owner"),
  approvedCompanyIds:["hub","partner","silent"]}});
 assert(!partner.publicRanking.companies.some(c=>c.name==="未報告会社"));
 assert(partner.publicRanking.companies.some(c=>c.name==="協力店A"));
 const zero=fixture(0);
 const zeroPartner=build({...zero,context:auth("partner_owner")});
 assert(zeroPartner.publicRanking.companies.some(c=>c.name==="協力店A"&&c.count===0),
  "a submitted zero is a legitimate reported company");
});
test("period selections use actual day/week/month boundaries, month-to-date prev month same elapsed days",()=>{
 const x=fixture(3);
 const day=build(x);
 assert.deepEqual(day.range,{
  start:"2026-11-08",end:"2026-11-08",
  previousStart:"2026-11-07",previousEnd:"2026-11-07",days:1
 });
 const week=build({...x,period:{kind:"week",day:"2026-11-08",asOf:"2026-11-08"}});
 assert.deepEqual(week.range,{
  start:"2026-11-02",end:"2026-11-08",
  previousStart:"2026-10-26",previousEnd:"2026-11-01",days:7
 });
 const month=build({...x,period:{kind:"month",day:"2026-11-08",asOf:"2026-11-08"}});
 assert.deepEqual(month.range,{
  start:"2026-11-01",end:"2026-11-08",
  previousStart:"2026-10-01",previousEnd:"2026-10-08",days:8
 });
 const jan=build({...x,period:{kind:"month",day:"2027-01-31",asOf:"2027-01-31"}});
 assert.equal(jan.range.previousStart,"2026-12-01");
 assert.equal(jan.range.previousEnd,"2026-12-31");
});
test("owner company/team/product split; partner gets own detail and only approved public name+rank+count",()=>{
 const x=fixture(3);
 x.personGoals=[{companyId:"partner",uid:"p1",goalCount:8}];
 x.historicalBest=[{companyId:"partner",uid:"p1",count:2}];
 const hub=build(x);
 assert.equal(hub.memberRanking.find(p=>p.id==="partner:p1").remainingToGoal,5);
 assert.equal(hub.memberRanking.find(p=>p.id==="partner:p1").personalBestStatus,"自己ベスト更新");
 assert.equal(hub.productRanking[0].ownCount,1);
 assert.equal(hub.productRanking[0].partnerCount,3);
 assert(hub.teamBreakdown.some(x=>x.companyId==="partner"&&x.count===3));
 const partner=build({...x,context:auth("partner_owner")});
 assert.equal(partner.role,"partner_owner");
 assert.equal(partner.own.count,3);
 assert.equal(partner.own.people.find(p=>p.id==="partner:p1").count,3);
 assert.equal(partner.publicRanking.members[0].count,3);
 assert.deepEqual(Object.keys(partner.publicRanking.members[0]).sort(),
   ["company","count","name","rank"].sort());
 assert(!("companyBreakdown" in partner));
 assert(!("teamBreakdown" in partner));
 assert(!("filters" in partner));
 assert(!("summary" in partner));
 assert(!("personGoals" in partner));
 assert(!("historicalBest" in partner));
 assert(!JSON.stringify(partner.publicRanking).includes("remainingToGoal"));
});
test("company-code unknown attribution included once in company/SKU but NEVER fake person",()=>{
 const x=fixture(2);
 x.unassigned=[{companyId:"partner",date:"2026-11-07",
  sourceId:"codeSessionA-20261107",productId:"partnerSku01",
  kind:"company-code-ledger",exclusiveVerified:true,count:4}];
 x.period={kind:"week",day:"2026-11-08",asOf:"2026-11-08"};
 // Same-date staff ledger and unknown company-code counts are never combined.
 const v=build(x);
 assert.deepEqual(v.summary,{own:1,partner:6,total:7,unidentified:4});
 assert.equal(v.memberRanking.find(p=>p.id==="partner:p1").count,2);
 assert.equal(v.productRanking[0].count,7);
 assert.throws(()=>build({...x,unassigned:[{...x.unassigned[0],
  date:"2026-11-08"}]}),/INCOMPLETE_OR_UNAUTHORIZED/,
  "ambiguous same-company same-day staff and code ledgers risk double addition");
});
test("different company SKUs are NEVER merged merely because both names say NURO",()=>{
 const x=fixture(3);
 const value=build({...x,productGroups:[]});
 assert.equal(value.productRanking.length,2);
 assert(value.productRanking.every(p=>p.id.startsWith("unmapped:")));
 assert.deepEqual(value.productRanking.map(p=>p.count),[3,1]);
});
test("canceled consent, wrong role, forged approvals, missing snapshot or company reject before publication",()=>{
 for(const edit of [
  d=>{d.context.reciprocalOwnersApproved=false;},
  d=>{d.context.individualNamesApproved=false;},
  d=>{d.context.serverVerified=false;},
  d=>{d.context.viewerCompanyId="other";},
  d=>{d.context.approvedCompanyIds=["hub"];},
  d=>{d.sources.pop();},
  d=>{d.sources[1].consentVerified=false;},
  d=>{d.sources[1].completeWindows.current=false;},
  d=>{d.sources[1].readTime="2026-11-08T02:15:31Z";},
  d=>{d.sources[1].records[0].companyId="hub";},
  d=>{d.sources[1].records[0].totalRevenue=99999;},
  d=>{d.sources[1].lines[0].count=1;},
  d=>{d.sources[1].lines.push({...d.sources[1].lines[0]});}
 ]){const d=fixture(3);edit(d);assert.throws(()=>build(d),undefined,edit.toString());}
});
test("financial fields and labels cannot enter either hub or partner response",()=>{
 for(const edit of [
  d=>{d.sources[1].products[0].name="NURO_CB5000";},
  d=>{d.sources[1].companyLabel="協力店 売上50000";},
  d=>{d.sources[1].records[0].unitPrice=10000;},
  d=>{d.sources[1].lines[0].cashback=10000;},
  d=>{d.sources[1].roster[0].name="担当者 20000円";},
  d=>{d.sources[1].teams[0].name="単価4000";},
  d=>{d.sources[1].lines[0].sourceId="CB50000";},
  d=>{d.productGroups[0].groupName="cashback30000";}
 ]){const d=fixture(3);edit(d);assert.throws(()=>build(d),undefined,edit.toString());}
});
test("previous-period incomplete never invents initial participation or growth",()=>{
 const d=fixture(3);
 d.sources[1].completeWindows.previous=false;
 const v=build(d),p=v.memberRanking.find(x=>x.id==="partner:p1");
 assert.equal(p.growth,"比較不可");
 assert.equal(p.change,null);
 assert.equal(p.previousCount,null);
 const noOld=fixture(3);
 noOld.sources[1].records=noOld.sources[1].records.filter(x=>x.date>="2026-11-01");
 noOld.sources[1].lines=noOld.sources[1].lines.filter(x=>x.date>="2026-11-01");
 const initial=build(noOld).memberRanking.find(x=>x.id==="partner:p1");
 assert.equal(initial.growth,"初参加");
 assert.equal(initial.previousCount,0);
});

test("partner has distinct joint company/team leaderboards with rank, name and count only",()=>{
 const input=fixture(3),raw=structuredClone(input);
 const partner=build({...input,context:auth("partner_owner")});
 const ranking=partner.publicRanking;
 assert.deepEqual(ranking.companies,[
  {rank:1,name:"協力店A",count:3},
  {rank:2,name:"自社",count:1}
 ]);
 assert.deepEqual(ranking.teams,[
  {rank:1,name:"営業班",company:"協力店A",count:3},
  {rank:2,name:"営業班",company:"自社",count:1}
 ]);
 assert.deepEqual(Object.keys(ranking.teams[0]).sort(),
  ["rank","name","company","count"].sort());
 assert(!("companyBreakdown" in partner));
 assert(!("teamBreakdown" in partner));
 assert(!JSON.stringify(ranking).match(/revenue|unitPrice|cashback|totalRevenue|uid|teamId|companyId/));
 assert.deepEqual(input,raw,"new ranks never change stored records or roster");
});
test("ranking ties use standard competition ranking across companies and teams",()=>{
 const input=fixture(1);
 const partner=build({...input,context:auth("partner_owner")});
 assert.deepEqual(partner.publicRanking.companies.map(x=>x.rank),[1,1]);
 assert.deepEqual(partner.publicRanking.teams.map(x=>x.rank),[1,1]);
});

// Never allow finance-coded Unicode labels into any of the four shared ranks.
// The Functions copy must reject the same inputs as the canonical module.
test("NFKC financial labels fail closed in canonical and Functions ranking, ordinary Unicode stays intact",()=>{
 for(const buildFn of [buildVerifiedCountDashboard,buildVendorDashboard]){
  for(const [edit,value] of [
   [d=>{d.sources[1].companyLabel="協力店 ＣＢ５０００";},"company"],
   [d=>{d.sources[1].teams[0].name="営業班 ＣＡＳＨＢＡＣＫ５０００";},"team"],
   [d=>{d.sources[1].roster[0].name="担当者 ＲＥＶＥＮＵＥ５０００";},"person"],
   [d=>{d.sources[1].products[0].name="ＮＵＲＯ ＵＮＩＴＰＲＩＣＥ５０００";},"product"],
   [d=>{d.productGroups[0].groupName="商品 ＣＢ５０００";},"group"]
  ]){
   const input=fixture(2),original=structuredClone(input);
   edit(input);
   assert.throws(()=>buildFn(input),/INCOMPLETE_OR_UNAUTHORIZED/,value);
   assert.equal(original.sources[1].companyLabel,"協力店A");
  }
  const valid=fixture(2);
  valid.sources[1].companyLabel="協力店Ａ";
  const result=buildFn(valid);
  assert.equal(result.companyBreakdown.find(x=>x.id==="partner").name,"協力店Ａ");
 }
});

test("team detail uses saved teams across transfers, with identical server package output",()=>{
 const x=fixture(3);
 x.period={kind:"month",day:"2026-11-08",asOf:"2026-11-08"};
 const source=x.sources[1];
 source.teams.push({id:"newTeam",name:"異動先",goalCount:null});
 source.roster[0].teamId="newTeam";
 const moved=rec("partner","moved","p1","2026-11-07",2);
 moved.teamId="newTeam";
 source.records.push(moved);
 source.lines.push(ln(moved,"partnerSku01",2));
 const before=structuredClone(x);
 const result=build(x);
 assert.deepEqual(buildVendorDashboard(x),result);
 assert.deepEqual(x,before);
 const old=result.teamBreakdown.find(t=>t.id==="partner:team");
 const next=result.teamBreakdown.find(t=>t.id==="partner:newTeam");
 assert.equal(old.detail.members.find(p=>p.id==="partner:p1").count,3);
 assert.equal(next.detail.members.find(p=>p.id==="partner:p1").count,2);
 assert.equal(old.detail.members.find(p=>p.id==="partner:p2").reportStatus,"確定0件");
 assert(!old.detail.members.some(p=>p.id==="partner:p3"));
 for(const team of result.teamBreakdown){
  assert.equal(team.detail.members.reduce((n,p)=>n+p.count,0),team.count);
  assert.equal(team.detail.products.reduce((n,p)=>n+p.count,0),team.count);
 }
 x.context=auth("partner_owner");
 const partner=build(x);
 assert(!("teamBreakdown" in partner));
 assert(!JSON.stringify(partner.publicRanking).includes("detail"));
});

test("registered unreported teams, explicit zero and nullable count goals remain distinct",async()=>{
 const {projectOwnerPartnerTeamCards}=await import("../ranking/unified-partner-team-cards.mjs");
 const x=fixture(3);
 x.period={kind:"month",day:"2026-11-08",asOf:"2026-11-08"};
 x.sources[1].teams[0].goalCount=10;
 x.sources[1].teams.push({id:"unreported",name:"未報告班",goalCount:null},
  {id:"zero",name:"0件報告班",goalCount:0});
 x.sources[1].roster.push({uid:"p4",name:"新メンバー",teamId:"zero"});
 const zero=rec("partner","zero-report","p4","2026-11-08",0);
 zero.teamId="zero";
 x.sources[1].records.push(zero);
 const response=build(x);
 const model=projectOwnerPartnerTeamCards(response,{month:"2026-11"});
 const company=model.companies[0];
 const unreported=company.teams.find(t=>t.key===JSON.stringify(["partner","unreported"]));
 const reportedZero=company.teams.find(t=>t.key===JSON.stringify(["partner","zero"]));
 const active=company.teams.find(t=>t.key===JSON.stringify(["partner","team"]));
 assert.equal(unreported.reportStatus,"未報告");
 assert.equal(unreported.goalCount,null);
 assert.equal(reportedZero.reportStatus,"確定0件");
 assert.equal(reportedZero.goalCount,0);
 assert.equal(reportedZero.memberCount,1);
 assert.equal(active.goalCount,10);
 assert.equal(active.memberCount,3);
 assert.equal(active.products.reduce((n,p)=>n+p.count,0),3);
 x.context=auth("partner_owner");
 assert(!build(x).publicRanking.teams.some(t=>t.name==="未報告班"));
});

test("product-filtered team detail retains report evidence from saved lines",async()=>{
 const {projectOwnerPartnerTeamCards}=await import("../ranking/unified-partner-team-cards.mjs");
 const x=fixture(3);
 x.period={kind:"month",day:"2026-11-08",asOf:"2026-11-08"};
 x.filters={productId:"nuro"};
 const result=build(x);
 const model=projectOwnerPartnerTeamCards(result,{month:"2026-11"});
 const team=model.companies[0].teams.find(t=>t.key===JSON.stringify(["partner","team"]));
 assert.equal(team.count,3);
 assert.equal(team.reportStatus,"報告済");
 assert.equal(team.people[0].reportStatus,"一部未報告");
});

test('colon-containing company/team IDs cannot alias another company team',async()=>{
 const {projectOwnerPartnerTeamCards}=await import('../ranking/unified-partner-team-cards.mjs');
 const x=fixture(3),rename=id=>id==='hub'?'a':'a:b';
 x.period={kind:'month',day:'2026-11-08',asOf:'2026-11-08'};
 x.hubCompanyId='a';x.approvedCompanyIds=['a','a:b'];
 x.context.hubCompanyId='a';x.context.viewerCompanyId='a';
 x.context.approvedCompanyIds=['a','a:b'];
 for(const source of x.sources){
  const old=source.companyId,cid=rename(old),teamId=old==='hub'?'b:team':'team';
  source.companyId=cid;source.teams[0].id=teamId;
  for(const row of [...source.records,...source.lines,...source.products])row.companyId=cid;
  for(const row of [...source.records,...source.lines,...source.roster])row.teamId=teamId;
 }
 for(const group of x.productGroups)group.companyId=rename(group.companyId);
 const result=build(x);
 const teams=result.teamBreakdown;
 assert.equal(teams.length,2);
 assert.equal(teams[0].id,teams[1].id,'legacy display IDs collide; identities must remain separate');
 assert.equal(teams.find(t=>t.companyId==='a').count,1);
 assert.equal(teams.find(t=>t.companyId==='a:b').count,3);
 assert.deepEqual(buildVendorDashboard(x),result);
 const model=projectOwnerPartnerTeamCards(result,{month:'2026-11'});
 assert.equal(model.total,3);
 assert.equal(model.companies[0].teams[0].key,JSON.stringify(['a:b','team']));
 assert.equal(model.companies[0].teams[0].people[0].count,3);
});
