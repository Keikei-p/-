import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const begin="// Owner-only, on-demand counts from the existing isolated callable.";
const end="\nasync function showPartnerInviteAtMain(user,invite){";
const from=html.indexOf(begin),to=html.indexOf(end,from);
assert.ok(from>=0&&to>from,"partner owner screen is present");
const source=html.slice(from,to);
const cardBegin=html.indexOf("const PARTNER_TEAM_CB_TIERS=");
const cardEnd=html.indexOf("async function loadSharedDailyStandings(",cardBegin);
assert.ok(cardBegin>0&&cardEnd>cardBegin);
const teamCardCode=html.slice(cardBegin,cardEnd);

function node(tag="div"){
 return {
  tag,children:[],className:"",textContent:"",value:"",hidden:false,open:false,
  handlers:{},append(...items){this.children.push(...items);},
  replaceChildren(...items){this.children=[...items];this.textContent="";},
  addEventListener(type,fn){this.handlers[type]=fn;},
  get lastChild(){return this.children.at(-1);}
 };
}

function fixture(){
 const names=["ownerPartnerDashboardDate","ownerPartnerDashboardRefresh",
  "ownerPartnerDashboardStatus","ownerPartnerDashboardSummary",
  "ownerPartnerDashboardList","ownerPartnerDashboardDetails","allTeamsOverviewContent"];
 const dom=Object.fromEntries(names.map(id=>[id,node()]));
 dom.allTeamsOverviewContent.hidden=false;
 dom.ownerPartnerDashboardDetails.hidden=false;
 const ownerToggle=node("button");
 const companyA={partnerCompanyId:"p1",name:"協力店A",active:true,teams:[{id:"t1",name:"1班"}]};
 const companyB={partnerCompanyId:"p2",name:"協力店B",active:true,teams:[{id:"t2",name:"2班"}]};
 let reportTotal=3,detailTotal=3,hasReport=true,authorized=true;
 let calls=[];
 const fn=async({date,partnerCompanyId}={})=>{
  calls.push({date,partnerCompanyId});
  if(partnerCompanyId){
   const counts={NURO:2,SBMNP:detailTotal-2};
   return {data:{date,role:"hub",partnerTeamDetails:{
    scope:"shared_counts_only",date,partnerCompanyId,
    verifiedSharedCount:detailTotal,unverifiedTeamCount:0,
    unreconciledWithCompanyReport:false,
    teams:[{name:"1班",totalCount:detailTotal,reportedStaffCount:1,counts,
     members:[{name:"田中",totalCount:detailTotal,counts}]}]
   }}};
  }
  return {data:{date,role:"hub",registeredCompanies:[companyA,companyB],
   partners:hasReport?[{partnerCompanyId:"p1",name:"協力店A",totalCount:reportTotal}]:[]}};
 };
 const context={
  Date,Promise,Map,Set,Number,Object,Array,Error,
  pInline:id=>dom[id],
  document:{createElement:node},
  currentUser:{uid:"owner-1"},
  allTeamsOverviewToggle:ownerToggle,
  allTeamsOverviewContent:dom.allTeamsOverviewContent,
  canLoadPartnerRanking:()=>authorized,
  getTodayString:()=>"2026-11-02",
  readPartnerWorkDay:fn,
  partnerMainValidId:id=>typeof id==="string"&&/^[A-Za-z0-9_-]+$/.test(id),
  partnerMainAppendRow:(parent,label,value)=>{const entry=node();entry.textContent=label+"｜"+value;parent.append(entry);},
  PARTNER_QUICK_RANK_KEYS:["NURO","SBMNP"]
 };
 runInNewContext(teamCardCode+"\n"+source,context);
 const openCompany=async index=>{
  const company=dom.ownerPartnerDashboardList.children[index];
  company.open=true;
  await company.handlers.toggle();
  return company;
 };
 return {dom,context,ownerToggle,calls:()=>calls,
  openCompany,setReport:n=>{reportTotal=n;},setDetail:n=>{detailTotal=n;},
  setHasReport:v=>{hasReport=v;},setAuthorized:v=>{authorized=v;},
  renameCompany:name=>{companyA.name=name;},disableCompany:()=>{companyA.active=false;},
  run:()=>runInNewContext("loadOwnerPartnerDetails()",context)};
}

test("owner team screen keeps the original sales UI and displays actual partner reports",async()=>{
 assert.match(html,/id="allTeamsOverviewList"/);
 assert.match(html,/id="ownerPartnerDashboardDetails"/);
 assert.match(html,/id="ownerPartnerDashboardSummary"/);
 assert.match(html,/id="ownerPartnerDashboardList"/);
 assert.match(html,/id="ownerSharedDetailTree"/);
 assert.match(html,/id="ownerSharedRankingContent"/);
 const f=fixture();
 await f.run();
 assert.equal(f.dom.ownerPartnerDashboardList.children.length,2);
 assert.match(f.dom.ownerPartnerDashboardList.children[0].children[0].textContent,/協力店A｜3件/);
 assert.match(f.dom.ownerPartnerDashboardList.children[1].children[0].textContent,/協力店B｜未報告/);
 assert.match(f.dom.ownerPartnerDashboardSummary.children[0].textContent,/3件/);
 assert.match(f.dom.ownerPartnerDashboardSummary.children.at(-1).textContent,/未報告/);
 assert.equal(f.calls().length,1,"company breakdown is lazy, not extra database reads");
 const card=await f.openCompany(0);
 const team=card.children[2].children[0].children[0];
 const content=n=>[n.textContent||"",...(n.children||[]).flatMap(content)].join(" ");
 assert.equal(team.className,"partner-count-team-card");
 assert.match(content(team),/1班/);
 assert.match(content(team),/合計 3件/);
 assert.match(content(team),/田中｜合計 3件/);
 assert.match(content(team),/NURO 2件/);
 assert.match(content(team),/SBMNP 1件/);
 assert.doesNotMatch(content(team),/¥|￥|売上|単価/);
 assert.equal(f.calls().length,2);
 await card.handlers.toggle();
 assert.equal(f.calls().length,2,"opening again does not duplicate reads");
});

test("owner refresh shows corrected count once and explicitly marks unreported",async()=>{
 const f=fixture();
 await f.run();
 f.setReport(4);f.setDetail(4);
 await f.run();
 assert.equal(f.dom.ownerPartnerDashboardList.children.length,2);
 assert.match(f.dom.ownerPartnerDashboardSummary.children[0].textContent,/4件/);
 const company=await f.openCompany(0);
 assert.match(company.children[2].children[0].children[0].children[0].children[1].textContent,/4件/);
 f.setHasReport(false);await f.run();
 assert.match(f.dom.ownerPartnerDashboardList.children[0].children[0].textContent,/未報告/);
 assert.match(f.dom.ownerPartnerDashboardSummary.children.at(-1).textContent,/2社/);
});

test("renamed company retains count and disabled company hides previous totals",async()=>{
 const f=fixture();
 f.renameCompany("協力店A（新社名）");
 await f.run();
 assert.match(f.dom.ownerPartnerDashboardList.children[0].children[0].textContent,/新社名.*3件/);
 f.disableCompany();
 await f.run();
 assert.match(f.dom.ownerPartnerDashboardList.children[0].children[0].textContent,/承認待ち/);
 assert.match(f.dom.ownerPartnerDashboardSummary.children[0].textContent,/0件/);
});

test("owner refuses mismatched company/person totals and unauthorized reads",async()=>{
 const f=fixture();
 f.setReport(3);f.setDetail(2);
 await f.run();
 const card=await f.openCompany(0);
 assert.match(card.children[2].children[0].textContent,/照合できません/);
 f.setAuthorized(false);await f.run();
 assert.equal(f.dom.ownerPartnerDashboardList.children.length,0);
 assert.match(f.dom.ownerPartnerDashboardStatus.textContent,/自社オーナー/);
});

test("opening original team detail triggers on-demand fetch with no finance access",()=>{
 assert.match(source,/allTeamsOverviewToggle.addEventListener\("click"/);
 assert.match(source,/!allTeamsOverviewContent.hidden&&canLoadPartnerRanking\(\)/);
 assert.match(source,/readPartnerWorkDay\(\{date,partnerCompanyId:company.partnerCompanyId\}\)/);
 for(const forbidden of ["getDoc(","getDocs(","collection(db,","setDoc(","updateDoc(","deleteDoc(",
  "monthlyRevenue","unitPrice","revenuePerUnit","cbPrice"]){
  assert.ok(!source.includes(forbidden),"unexpected sales/finance access: "+forbidden);
 }
 assert.match(html,/\.owner-partner-company-list\{display:grid/);
 assert.match(html,/\.owner-partner-summary\{display:grid/);
});
