import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import vm from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("partner-workspace.html");
const inline=read("ranking/verified-inline-joint-ranking-cards.mjs");
const bridge=read("ranking/verified-joint-month-http-bridge.mjs");
test("same original partner dashboard cards are the integration point, not an extra board",()=>{
 for(const id of ["countCompanyRank","countTeamRank","countStaffRank","countProductRank"])
  assert(source.includes('id="'+id+'"'),id);
 assert(source.includes("renderVerifiedInlineJointCards({"));
 assert(source.includes("document,roots,payload,expectedRole:\"partner_owner\""));
 assert(source.includes('period:countPeriod,start:dates[0],end:dates.at(-1)'));
 assert(source.includes("await refreshVerifiedJointInlineForPartner({gen,uid,day,today,dates});"));
 assert(source.includes("NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||"));
 assert(source.includes('$("countInlineJointCompanies").hidden=false;'));
 assert(source.includes('if(summary)renderCountOnlyDashboard(summary,dates);'));
 assert(source.includes('jointInlineVerified=false;'));
 assert(source.includes('jointInlineVerified=true;'));
 assert(source.includes('if(!NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||!jointInlineVerified)renderProductRankMode();'));
 assert(!source.includes('  clear();\n  $("countDashboardStatus").textContent='));

});
test("production and extra-board feature flags stay OFF, no unauthorized network",()=>{
 assert(source.includes("const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;"));
 assert(source.includes("const NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false;"));
 assert(source.includes("const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;"));
 assert(source.includes('if(!NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||'));
 assert(source.includes('!["owner","leader","member"].includes(data?.role)'));
 assert(source.includes("session===activeCodeSession&&company===workspaceCompanyId"));
 assert(source.includes('(session?true:identity?.emailVerified===true)'));
 assert(source.includes('getCodeSession:()=>activeCodeSession||""'));
 assert(source.includes('getWorkspaceCompanyId:()=>activeCodeSession?"":workspaceCompanyId'));
 assert(source.includes('window.location.origin==="https://nico-factory.web.app"'));
 assert(source.includes("if(!valid())return;"));
 assert(!source.includes('from "firebase/firestore"'));
 assert(!source.includes('firebase-firestore.js'));
 assert(inline.includes("validateVerifiedDualCountDashboard"));
 assert(bridge.includes('expectedRole!==null&&value.role!==expectedRole'));
});
test("existing partner module parses after safe inline staging wiring",()=>{
 const match=source.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert(match);
 const parsed=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:match[1],encoding:"utf8"
 });
 assert.equal(parsed.status,0,parsed.stderr);
 const parsedModule=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:inline,encoding:"utf8"
 });
 assert.equal(parsedModule.status,0,parsedModule.stderr);
});

test("when joint server is unavailable the already verified partner rank stays visible",async()=>{
 const head=source.indexOf("let jointInlineVerified=false;\nasync function refreshVerifiedJointInlineForPartner");
 const tail=source.indexOf("async function loadCountDashboard(){",head);
 assert(head>=0&&tail>head);
 const code=source.slice(head,tail);
 const elements=new Map();
 function item(id){
  if(!elements.has(id))elements.set(id,{
   hidden:false,disabled:false,children:[{textContent:"既存ランキング"}],
   replaceChildren(...children){this.children=[...children]},
   textContent:"",id
  });
  return elements.get(id);
 }
 const identity={uid:"test",emailVerified:true};
 const auth={currentUser:identity},summary={total:3},dates=["2026-11-17"];
 let restores=0,originalValue=false;
 const context={
  $:item,data:{role:"member"},auth,activeCodeSession:null,
  workspaceCompanyId:"partner",countLoadId:8,
  currentCountIdentity:()=>identity.uid,
  window:{location:{origin:"https://nico-factory.web.app"}},
  renderCountOnlyDashboard(candidate,selected){
   assert.equal(candidate,summary);
   assert.deepEqual(Array.from(selected),dates);
   restores++;
   for(const id of ["countTeamRank","countStaffRank","countProductRank"])
    item(id).replaceChildren({textContent:"既存件数3件"});
  },
  console:{error(){ }},Promise
 };
 vm.runInNewContext("const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=true;\n"+
  code+"\nglobalThis.invoke=refreshVerifiedJointInlineForPartner;\n",context);
 // vm has no dynamic-import resolver: its rejected import follows the same
 // catch path as a failed HTTP request. No production credentials are used.
 await context.invoke({gen:8,uid:identity.uid,day:"2026-11-17",
  today:"2026-11-17",dates,summary});
 assert.equal(restores,1);
 assert.match(item("countDashboardStatus").textContent,
  /協力店の件数ランキングを表示中/);
 for(const id of ["countTeamRank","countStaffRank","countProductRank"]){
  assert.equal(item(id).children.length,1);
  assert.equal(item(id).children[0].textContent,"既存件数3件");
 }
 assert.equal(item("countProductMode").disabled,false);
 assert.equal(item("countInlineJointCompanies").hidden,true);
});

test("the real partner count dashboard renders the report date from the parameter, never a missing outer variable",()=>{
 const head=source.indexOf("function renderCountOnlyDashboard(summary,days){");
 const tail=source.indexOf("function clearCountOnlyDashboard(){",head);
 assert(head>=0&&tail>head);
 const code=source.slice(head,tail);
 assert(!/\bdates\b/.test(code),"dashboard body must only use its days parameter");
 const nodes=new Map();
 const create=tag=>({
  tagName:tag,children:[],style:{},value:"",disabled:false,
  textContent:"",dataset:{},
  append(...items){this.children.push(...items)},
  replaceChildren(...items){this.children=[...items]},
  setAttribute(){}
 });
 const $=id=>{if(!nodes.has(id))nodes.set(id,create(id));return nodes.get(id)};
 const summary={
  total:3,
  days:[{date:"2026-11-17",count:3,people:1}],
  people:[{id:"p1",name:"協力店担当",count:3}],
  products:{"NURO":3},groups:[],hasUnverifiedTeams:false
 };
 const context={
  $,document:{createElement:create},
  data:{companyName:"協力店A"},
  countExportRows:null,
  countTable:()=>create("table"),countRankingCards:()=>create("div"),
  renderCountAnalysisScopeCards:()=>{},renderProductRankMode:()=>{},
  renderCountGoal:()=>{},competitionRanks:()=>[]
 };
 vm.runInNewContext(code+"\nglobalThis.runPartnerDashboard=renderCountOnlyDashboard;",
  context);
 assert.doesNotThrow(()=>context.runPartnerDashboard(summary,["2026-11-17"]));
 assert.match($("countReportBody").value,/2026-11-17 〜 2026-11-17/);
 assert.match($("countReportBody").value,/合計：3件/);
 assert.equal($("countReportCopy").disabled,false);
 assert.equal(context.countExportRows.summary,summary);
});
