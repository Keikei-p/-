import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||html;
function extract(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"inline function not found: "+start);
 return source.slice(a,b);
}
function newNode(tag){
 return {tag,children:[],className:"",textContent:"",
  append(...nodes){this.children.push(...nodes)},
  replaceChildren(...nodes){this.children=[...nodes]}};
}

test("partner dashboard uses the same HQ+partner ranking rather than a local private-only list",()=>{
 assert.match(html,/#partnerPanelRankings>\.p-inline-card:first-child\{display:none!important\}/);
 assert.match(source,/const partnerRankings=\{/);
 assert.match(source,/individual:\["🏆 個人ランキング",personRows\]/);
 assert.match(source,/team:\["👥 班ランキング",teamRows\]/);
 assert.match(source,/product:\["📦 商材別ランキング"/);
 assert.match(source,/appendSharedRankingRows\(content,heading,items,complete\)/);
});

test("invite, teams, staff and products remain operable only through the existing safe menu",()=>{
 assert.match(html,/#partnerManagementTabs\{display:none!important\}/);
 assert.match(html,/#partnerSameAppNavigation>\[data-partner-panel="members"\]\{display:none!important\}/);
 assert.match(source,/if\(manageButtons\.includes\(button\)\)\{management\.after\(detail\);return;\}/);
 for(const action of ['"invite"','"teams"','"members"','"catalog"'])
  assert.ok(source.includes(action),"safe menu missing "+action);
 assert.match(source,/function mountPartnerSafeManagementMenu/);
 assert.match(source,/async function openSameAppPartnerWorkspace/);
});

test("partner combined details and owner use shared safe team cards and retain missing companies",()=>{
 const code=extract("const PARTNER_TEAM_CB_TIERS=",
  "async function loadSharedDailyStandings(where,force=false){");
 const ctx={
  document:{createElement:newNode},
  partnerMainAppendRow(parent,label,value){
   const row=newNode("row");row.label=label;row.value=value;parent.append(row);
  }
 };
 vm.runInNewContext(code+";this.render=renderPartnerFlatTeamDetails;",ctx);
 const root=newNode("container");
 const report={
  categories:["NURO","SBMNP"],
  direct:{teams:[{key:"d1",name:"1班",totalCount:2,counts:{NURO:2,SBMNP:0}}],
   people:[{name:"本社・佐藤",teamKey:"d1",totalCount:2,counts:{NURO:2,SBMNP:0}}],
   peopleVerified:true},
  companies:[{id:"p1",name:"LinkTh",peopleVerified:true}],
  teams:[{key:"p1-team1",companyId:"p1",name:"2班",totalCount:4,
   counts:{NURO:3,SBMNP:1},cbCounts:{NURO:{"0":0,"60000":3,unclassified:0}}}],
  people:[{name:"協力店・田中",companyId:"p1",teamKey:"p1-team1",totalCount:4,
   counts:{NURO:3,SBMNP:1},cbCounts:{NURO:{"60000":3}}}],
  missingCompanies:["未報告の協力店"]
 };
 ctx.render(root,report);
 assert.equal(root.children.length,3);
 assert.equal(root.children[0].tag,"details");
 assert.match(root.children[0].children[0].children[0].textContent,/直営・1班/);
 assert.equal(root.children[1].className,"partner-count-team-card");
 const all=node=>[node.textContent||"",...(node.children||[]).flatMap(all)].join(" ");
 assert.match(all(root.children[1]),/LinkTh・2班/);
 assert.match(all(root.children[1]),/合計 4件/);
 assert.match(all(root.children[1]),/協力店・田中/);
 assert.match(all(root.children[1]),/CB6万/);
 assert.match(all(root.children[1]),/SBMNP/);
 assert.equal(root.children[2].label,"🤝 未報告の協力店");
 assert.equal(root.children[2].value,"未報告・0件とは扱いません");
});

test("save failures are actionable without writing again, erasing input or assuming a failed commit",()=>{
 const code=extract("function partnerCountSaveFailureMessage(error){",
  "async function partnerInlineRun(work){");
 const context={};
 vm.runInNewContext(code+";globalThis.hint=partnerCountSaveFailureMessage;",context);
 const f=context.hint;
 assert.match(f({code:"functions/permission-denied"}),/認証・権限/);
 assert.match(f({code:"functions/failed-precondition"}),/班・担当者/);
 assert.match(f({code:"functions/invalid-argument"}),/件数・NURO/);
 assert.match(f({code:"functions/unavailable"}),/二重登録を避ける/);
 assert.match(f({message:"date_changed"}),/対象日・担当者/);
 assert.match(source,/arguments\[1\]\?\.kind==="save"\?partnerCountSaveFailureMessage\(error\)/);
 assert.match(source,/\},\{kind:"save"\}\);/);
 assert.match(source,/if\(completed\)\{/);
 assert.match(source,/renderPartnerCountOnlyExtras\(\)/);
});

test("no finance or existing invitation endpoints modified by the partner-only UI patch",()=>{
 assert.match(html,/id="partnerEmailLinkVerifyPanel"/);
 assert.match(html,/id="partnerPanelInvite"/);
 assert.match(html,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(html,/const readPartnerWorkDay = httpsCallable\(partnerCountFunctions,"getPartnerWorkspace"\)/);
 assert.match(html,/data-partner-count-only="true"/);
});
