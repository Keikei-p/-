import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const portion=(a,b)=>{
 const i=html.indexOf(a),j=html.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,"expected unique source boundaries "+a);
 return html.slice(i,j);
};

test("original finance dashboard moves the same detail node to the clicked row",()=>{
 const script=portion("function positionOriginalDashboardDetail(toggle) {","function setupDashboardMenu(");
 const appended=[];
 const buttons=[
  {name:"analysis",offsetTop:0,hidden:false,style:{display:""}},
  {name:"rank",offsetTop:0,hidden:false,style:{display:""}},
  {name:"chart",offsetTop:95,hidden:false,style:{display:""}},
  {name:"team",offsetTop:95,hidden:false,style:{display:""}}
 ];
 for(const button of buttons){
  button.isConnected=true;
  button.after=detail=>{appended.push([button.name,detail.id]);};
  button.closest=()=>({querySelectorAll:()=>buttons});
 }
 const detail={id:"dashboardDetailArea"};
 const ctx={dashboardDetailArea:detail};
 runInNewContext(script+"\nthis.place=positionOriginalDashboardDetail;",ctx);
 ctx.place(buttons[2]);
 assert.deepEqual(appended,[["team","dashboardDetailArea"]],"last button in same grid row is anchor");
 buttons[3].hidden=true;
 ctx.place(buttons[2]);
 assert.deepEqual(appended.at(-1),["chart","dashboardDetailArea"]);
 buttons[3].hidden=false;
 buttons[0].style.display="none";
 ctx.place(buttons[1]);
 assert.deepEqual(appended.at(-1),["rank","dashboardDetailArea"]);
 assert.match(html,/#dashboard > \.dashboard-app-grid > #dashboardDetailArea \{/);
 assert.match(html,/grid-column: 1 \/ -1/);
});

test("opening original ranking, chart, detail and history use same existing content and inline anchor",()=>{
 const setup=portion("function setupDashboardMenu(","setupAccordionGroup(\n  [");
 assert.match(setup,/positionOriginalDashboardDetail\(item.toggle\)/);
 assert.match(setup,/expandedDashboardToggle = item.toggle/);
 assert.match(setup,/dashboardDetailArea.hidden =\s*false/);
 assert.match(setup,/dashboardDetailArea.hidden =\s*true/);
 for(const id of ["salesAnalysisToggle","individualRankingToggle","productRankingToggle",
   "teamRankingToggle","revenueChartToggle","allTeamsOverviewToggle",
   "productSummaryToggle","dailySummaryToggle","recordHistoryToggle"])
  assert.ok(setup.includes("toggle:\n        "+id),id);
 assert.match(html,/requestAnimationFrame\(\(\)=>positionOriginalDashboardDetail\(expandedDashboardToggle\)\)/);
 assert.doesNotMatch(setup,/setDoc\(|deleteDoc\(|updateDoc\(/);
});

test("partner dashboard uses the original card grid and opens below its own selected row",()=>{
 const position=portion("function partnerSameAppPositionPanel(name){","function partnerSameAppSelectPanel(name){");
 assert.match(position,/button.offsetTop/);
 assert.match(position,/row\[row.length-1\]/);
 assert.match(position,/\.after\(detail\)/);
 const select=portion("function partnerSameAppSelectPanel(name){","window.addEventListener(\"resize\"");
 for(const value of ['chart:"partnerPanelChart"','detail:"partnerPanelDetail"',
   'record:"partnerPanelRecord"','partnerSameAppPositionPanel(name)'])
  assert.ok(select.includes(value),value);
 assert.match(html,/#partnerInlineWorkspace #partnerSameAppDashboardDetails\{grid-column:1\/-1/);
});


test("partner fallback and live original menu expose all count-only dashboard actions",()=>{
 const fallback=portion('id="partnerSameAppNavigation"','id="partnerManagementTabs"');
 const panels=[...fallback.matchAll(/data-partner-panel="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(panels,[
  "record","analysis","individual","product","team","chart","detail",
  "products","report","goal","daily","history","members"
 ]);
 const mount=portion("function mountPartnerCanonicalNavigation(){","function renderPartnerCountOnlyExtras(){");
 for(const [original,key] of [
  ["salesAnalysisToggle","analysis"],["individualRankingToggle","individual"],
  ["productRankingToggle","product"],["teamRankingToggle","team"],
  ["revenueChartToggle","chart"],["allTeamsOverviewToggle","detail"],
  ["productSummaryToggle","products"],["reportBuilderToggle","report"],
  ["dailyGoalCalculatorToggle","goal"],["dailySummaryToggle","daily"],
  ["recordHistoryToggle","history"]
 ])assert.ok(mount.includes('["'+original+'","'+key+'"'),"missing live "+key);
 const router=portion("function partnerSameAppSelectPanel(name){",'window.addEventListener("resize"');
 for(const [key,id] of [
  ["analysis","partnerPanelAnalysis"],["chart","partnerPanelChart"],
  ["products","partnerPanelProductSummary"],["report","partnerPanelReport"],
  ["goal","partnerPanelGoal"]
 ]){
  assert.ok(router.includes(key+':"'+id+'"'),key+" not routed");
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.doesNotMatch(fallback,/売上分析|収益グラフ|売上順|収益単価|totalRevenue|unitPrice/);
 assert.match(mount,/target.replaceChildren\(\.\.\.cards\)/);
});


test("partner card second tap closes only the panel and preserves entered counts",()=>{
 const code=portion("function partnerSameAppTogglePanel(name){",'window.addEventListener("resize"');
 const detail={hidden:false},toolbar={hidden:true},calls=[],attributes=[];
 const button={setAttribute:(name,value)=>attributes.push([name,value])};
 const ctx={
  partnerSameAppSelectedPanel:"analysis",
  pInline:id=>id==="partnerSameAppDashboardDetails"?detail:
   id==="partnerGlobalDateToolbar"?toolbar:
   ({querySelectorAll:()=>[button]}),
  partnerSameAppSelectPanel:name=>calls.push(name)
 };
 runInNewContext(code+"\nthis.toggle=partnerSameAppTogglePanel;",ctx);
 ctx.toggle("analysis");
 assert.equal(detail.hidden,true);
 assert.equal(toolbar.hidden,false);
 assert.equal(calls.length,0);
 assert.deepEqual(attributes.filter(x=>x[0]==="aria-expanded").map(x=>x[1]),["false","false"]);
 ctx.toggle("chart");
 assert.deepEqual(calls,["chart"]);
 assert.doesNotMatch(code,/replaceChildren\(|\.reset\(|localStorage\.|setDoc\(|updateDoc\(/);
 assert.match(html,/partnerSameAppTogglePanel\(button.dataset.partnerPanel\)/);
});

test("partner uses original input visual structure with 2 columns and isolated CB categories",()=>{
 assert.match(html,/id="pInlineCountFields" class="product-input-list"/);
 assert.match(html,/#partnerInlineWorkspace #pInlineCountFields\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/#partnerInlineWorkspace #pInlineCountFields \.partner-cb-options\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 const render=portion("function partnerInlineRenderCounts(){","function partnerInlineRender(){");
 assert.match(render,/product-input-group product-input-group--compact/);
 assert.match(render,/title.className="product-input-group-title"/);
 assert.match(render,/name.className="product-input-name"/);
 assert.match(render,/input.className="product-plan-input"/);
 assert.match(render,/input.dataset.countKey=key/);
 assert.match(render,/input.dataset.privateCountId=product.id/);
 assert.match(render,/input.dataset.cbTier=tier/);
 assert.match(render,/saved\[tier\]/);
 assert.match(render,/teamSelect.disabled=!!entry/);
 assert.doesNotMatch(render,/\bunitPrice\b|\btotalRevenue\b|\brevenuePerUnit\b/);
});
