import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const start=html.indexOf("function verifyApprovedCountRanking(");
const end=html.indexOf("function renderApprovedCountRanking(",start);
const K=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const verify=vm.runInNewContext("const KEYS="+JSON.stringify(K)+";\n"+html.slice(start,end)+"\nverifyApprovedCountRanking");
const row=(name,n,rank)=>({key:"hash",name,totalCount:n,rank});
const base=()=>({schema:"nico-approved-partner-count-rank-v1",scope:"approved_partner_counts_only",
 unit:"件",fullyJoint:false,includesDirect:false,role:"partner",
 date:"2026-10-31",period:"day",start:"2026-10-31",end:"2026-10-31",
 companies:[row("協力店A",3,1),row("協力店B",3,1),row("協力店C",1,3)],
 teams:[],people:[],products:[row("NURO",7,1)],
 unreportedCompanies:[{key:"unknown",name:"未報告会社",status:"not_reported"}],
 totalCount:7,reportCount:3,partnerCountsComplete:false,
 unverifiedTeamCount:0,unverifiedPersonCount:0,historicalCompanyOnlyCount:0,
 peopleComplete:true,teamComplete:true
});
test("partner dashboard preserves original eleven cards and new shared surface is strictly disabled",()=>{
 assert.equal(html.split('id="approvedSharedRankings"').length,2);
 assert.match(html,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
 assert.match(html,/if\(!NICO_APPROVED_PARTNER_RANKING_RELEASED\|\|!data/);
 assert.match(html,/if\(NICO_APPROVED_PARTNER_RANKING_RELEASED&&data\)/);
 assert.match(html,/sharedCountRankings:true/);
 assert.match(html,/resetApprovedRanking\(\)/);
 assert.match(html,/verified|承認済み|件数/);
 assert.ok(html.indexOf('id="partnerPanel-history"')<html.indexOf('id="approvedSharedRankings"'));
 assert.ok(html.indexOf('id="approvedSharedRankings"')<html.indexOf('id="recordsBox"'));
});
test("shared count UI validates 1,1,3, keeps zero and unknown report status separate",()=>{
 const response=base();
 const result=verify(response,"2026-10-31","2026-10-31");
 assert.equal(result.totalCount,7);
 assert.equal(result.unreportedCompanies[0].status,"not_reported");
 assert.equal(result.companies[1].rank,1);
 assert.equal(result.companies[2].rank,3);
});
test("shared count UI fails closed on finance extensions, duplicate wrong ranks and spoofed direct mode",()=>{
 for(const bad of [
  {...base(),unit:"円"},
  {...base(),fullyJoint:true},
  {...base(),includesDirect:true},
  {...base(),totalRevenue:100000},
  {...base(),people:[{...row("担当",5,1),cashback:90000}]},
  {...base(),companies:[row("A",3,1),row("B",3,2)]},
  {...base(),companies:[row("A",3,1),row("B",4,2)]},
  {...base(),companies:[row("売上10000円",3,1)]},
  {...base(),companies:[row("A",3,1)],unreportedCompanies:[{...base().unreportedCompanies[0],unitPrice:50000}]},
 ])assert.throws(()=>verify(bad,"2026-10-31","2026-10-31"),/UNVERIFIED/);
});

test("partly reported month status is explicitly distinguished from unreported and zero",()=>{
 const payload=base();
 payload.unreportedCompanies.push({
  key:"hash",name:"協力店A",status:"partial_report"
 });
 assert.equal(verify(payload,"2026-10-31","2026-10-31"),payload);
 const start=html.indexOf("function renderApprovedCountRanking(value){");
 const end=html.indexOf("function renderApprovedCountRankingDetails(){",start);
 assert(start>0&&end>start);
 const nodes=new Map();
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{
   value:"",textContent:"",children:[],
   replaceChildren(...items){this.children=items;},
   appendChild(x){this.children.push(x);}
  });
  return nodes.get(id);
 };
 const sandbox={ $,document:{createElement:()=>({value:"",textContent:""})},
  countTable:()=>({}),renderApprovedCountRankingDetails:()=>{} };
 vm.runInNewContext(html.slice(start,end)+
  "\nthis.render=renderApprovedCountRanking;",sandbox);
 sandbox.render(payload);
 const summary=$("approvedSharedRankStatus").textContent;
 assert.match(summary,/未報告 1社/);
 assert.match(summary,/一部未報告 1社/);
 assert.match(summary,/一部未確認/);
 assert(!summary.includes("未報告 2社"),
  "a partly reported company must not be shown as fully unreported");
});
test("shared ranking UI refuses contradictory or forged partial report status",()=>{
 const normal=base();
 for(const row of [
  {key:"missing-company",name:"任意",status:"partial_report"},
  {key:"hash",name:"協力店A",status:"not_reported"},
  {key:"hash",name:"協力店A",status:"partially_confirmed"},
  {key:"hash",name:"協力店A",status:"partial_report",revenue:50000}
 ]){
  assert.throws(()=>verify({...normal,unreportedCompanies:[row]},
   "2026-10-31","2026-10-31"),/UNVERIFIED/);
 }
});


test("old partner UI weekly switch requests exactly the cross-month Monday-Sunday interval",async()=>{
 assert.match(html,/id="approvedSharedRankPeriod"[^>]*>[^\n]*value="week"/);
 assert.match(html,/id="approvedSharedRankDay" type="date"/);
 const start=html.indexOf("async function loadApprovedCountRanking(){");
 const end=html.indexOf('\n$("approvedSharedRankCompanySelect").onchange=',start);
 assert(start>=0&&end>start,"reviewed count-only weekly load handler exists");
 const source=html.slice(start,end);
 const el=Object.create(null),user={uid:"partnerOwner"};
 const $=id=>{
  if(!el[id])el[id]={value:"",hidden:false,textContent:"",
   replaceChildren(){this.children=[]},children:[]};
  return el[id];
 };
 $("approvedSharedRankMonth").value="2026-10";
 $("approvedSharedRankPeriod").value="week";
 $("approvedSharedRankDay").value="2026-10-01";
 let captured=null,ranges=null,rendered=0;
 const sandbox={
  $,NICO_APPROVED_PARTNER_RANKING_RELEASED:true,
  data:{role:"owner"},auth:{currentUser:user},activeCodeSession:"",
  workspaceCompanyId:"partner",dateParts:{year:"2026",month:"10",day:"31"},
  approvedRankIds:["Companies","Teams","People","Products","Details"],
  get:async args=>{captured=args;return {data:{safe:true}}},
  verifyApprovedCountRanking:(value,start,end,expected)=>{
   ranges={start,end,expected};return value;
  },
  renderApprovedCountRanking:()=>{rendered++}
 };
 const ctx=vm.createContext(sandbox);
 vm.runInContext('let approvedRankGeneration=0,approvedRankData=null;\n'+
  source+'\nthis.loadApprovedCountRanking=loadApprovedCountRanking;',ctx);
 await sandbox.loadApprovedCountRanking();
 assert.equal(captured.date,"2026-10-01");
 assert.equal(captured.rankingPeriod,"week");
 assert.equal(captured.sharedCountRankings,true);
 assert.deepEqual(ranges,{start:"2026-09-28",end:"2026-10-04",
  expected:{period:"week",role:"partner"}});
 assert.equal(rendered,1);
 assert.doesNotMatch($("approvedSharedRankStatus").textContent,/件数を検証できません/);
});

test("approved partner rankings reject mismatched authenticated role or selected period",()=>{
 const response=base();
 assert.equal(verify(response,"2026-10-31","2026-10-31",{
  period:"day",role:"partner"
 }),response);
 assert.throws(()=>verify(response,"2026-10-31","2026-10-31",{
  period:"week",role:"partner"
 }),/UNVERIFIED/);
 assert.throws(()=>verify(response,"2026-10-31","2026-10-31",{
  period:"day",role:"hub"
 }),/UNVERIFIED/);
});
