import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const service=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const scope=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
test("one canonical sales app hosts eight count-only navigation slots without mounting finance panels",()=>{
 assert.match(html,/<main id="appScreen">/);
 const nav=scope('id="partnerSameAppNavigation"','id="partnerPanelMembers"');
 for(const p of ["record","individual","product","team","detail","daily","history","members"])
  assert.match(nav,new RegExp('data-partner-panel="'+p+'"'));
 for(const id of ["partnerPanelRecord","partnerPanelRankings","partnerPanelDetail",
  "partnerPanelDaily","partnerPanelHistory","partnerPanelMembers"])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] > :not\(\.user-bar\):not\(#partnerInlineWorkspace\)\{display:none!important\}/);
 assert.match(html,/function partnerSameAppSelectPanel\(name\)/);
 assert.match(html,/stopRealtimeListeners\(\)/);
});
test("original owner team-detail dashboard groups count-only partner teams by company",()=>{
 for(const id of ["allTeamsOverviewContent","allTeamsOverviewList","ownerPartnerDashboardDetails",
  "ownerPartnerDashboardList","ownerPartnerDashboardDate","ownerPartnerDashboardRefresh"])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 const section=scope("let ownerPartnerDashboardNonce=0;","async function showPartnerInviteAtMain(");
 assert.match(section,/if\(!canLoadPartnerRanking\(\)\)/);
 assert.match(section,/readPartnerWorkDay\(\{date,partnerCompanyId:company.partnerCompanyId\}\)/);
 assert.match(section,/info\?\.scope!=="shared_counts_only"/);
 assert.match(section,/for\(const team of info.teams\)/);
 assert.match(section,/for\(const \[key,n\] of Object.entries\(team.counts\)\)/);
 for(const bad of ["getDoc(","getDocs(","collection(db,","setDoc(","updateDoc(","deleteDoc("])
  assert.ok(!section.includes(bad),bad);
});
test("partner count-only server never reads original finance documents or exposes their prices",()=>{
 assert.doesNotMatch(service,/\bdb\.collection\("(?:products|records|recordCorrections|revenueGoals)"\)/);
 const part=scope("const partnerCountFunctions =","/* =====================================================\n   DOM");
 assert.match(part,/httpsCallable\(partnerCountFunctions,"getPartnerWorkspace"\)/);
 assert.match(part,/httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(service,/scope:"shared_counts_only"/);
 assert.match(service,/staffNameSnapshot/);
 assert.match(service,/row\.members\.push\(\{name:safeName,totalCount:item.total,counts:\{\.\.\.item.counts\}\}\)/);
});
test("owner finance view and employee login remain intact; partner invite has Firebase verification then password",()=>{
 assert.match(html,/function canCurrentUserViewRevenue\(/);
 assert.match(html,/function canCurrentUserViewRevenueForTeam\(/);
 assert.match(html,/await signInWithEmailAndPassword\(/);
 assert.match(html,/sendSignInLinkToEmail\(auth,latest.email,partnerInviteAuthSettings\(latest\)\)/);
 assert.match(html,/await signInWithEmailLink\(auth,email,location.href\)/);
 assert.match(html,/await updatePassword\(user,pass\)/);
 assert.match(html,/partnerInlineAccept\(\{token:invite.token,name,transferCurrentCompany:false\}\)/);
});

// Execute the real on-page rank renderer against a synthetic count-only
// snapshot. No Firebase account, financial documents or production writes.
test("same-app ranking stays exact for repeated staff IDs, matching names and historical teams",()=>{
 const source=scope("function renderPartnerRankingOnlyPanel(){","\nlet partnerSameAppSelectedPanel=");
 const output=[];
 const rankingElement={replaceChildren(){output.length=0;}};
 const snapshot={
  role:"member",companyName:"協力店A",categories:["NURO"],
  staff:[{id:"a",name:"同姓",active:true},{id:"b",name:"同姓",active:false},
    {id:"c",name:"別の人",active:true}],
  teams:[{id:"t1",name:"1班",active:true},{id:"t2",name:"旧2班",active:false}],
  records:[
   {staffId:"a",teamIdSnapshot:"t1",totalCount:2,counts:{NURO:2}},
   {staffId:"a",teamIdSnapshot:"t2",totalCount:3,counts:{NURO:3}},
   {staffId:"b",teamIdSnapshot:"t2",totalCount:5,counts:{NURO:5}},
   {staffId:"c",teamIdSnapshot:"t1",totalCount:1,counts:{NURO:1}}
  ]
 };
 const context={
  partnerInlineData:snapshot,partnerSameAppSelectedPanel:"individual",
  pInline:id=>{assert.equal(id,"pInlineRanking");return rankingElement;},
  partnerMainAppendRow:(_element,title,value)=>output.push([title,value]),
 };
 runInNewContext(source+"\nrenderPartnerRankingOnlyPanel()",context);
 assert.equal(output.length,3,"one row per verified staff ID, not per record");
 assert.deepEqual(output.map(x=>x[0]),["1位 同姓","1位 同姓","3位 別の人"]);
 assert.deepEqual(output.map(x=>x[1]),["5件","5件","1件"]);
 context.partnerSameAppSelectedPanel="team";
 runInNewContext("renderPartnerRankingOnlyPanel()",context);
 assert.deepEqual(output.map(x=>x[1]),["8件","3件"]);
 assert.match(output[0][0],/旧2班（過去の班）/);
 context.partnerSameAppSelectedPanel="product";
 runInNewContext("renderPartnerRankingOnlyPanel()",context);
 assert.deepEqual(output.map(x=>x[1]),["11件"]);
 assert.doesNotMatch(JSON.stringify(output),/revenuePerUnit|totalRevenue|unitPrice/);
 snapshot.records[0].totalCount=-1;
 runInNewContext("renderPartnerRankingOnlyPanel()",context);
 assert.equal(output[0][0],"件数を検証できません");
 assert.equal(output.length,1,"invalid totals may not enter published ranking");
});

test("saved team and departed staff are shown from the original count snapshot, not current assignments",()=>{
 const render=scope("function partnerInlineRender(){","\nasync function partnerInlineFetch(){");
 assert.match(render,/const allTeams=snap.teams\|\|\[\],allStaff=snap.staff\|\|\[\]/);
 assert.match(render,/const byTeam=new Map\(allTeams.map/);
 assert.match(render,/for\(const team of allTeams\)/);
 assert.match(render,/snap.records.filter\(e=>e.teamIdSnapshot===team.id\)/);
 assert.match(render,/const person=allStaff.find\(p=>p.id===entry.staffId\)/);
 assert.doesNotMatch(render,/snap.records.find\(e=>e.staffId===person.id&&e.teamIdSnapshot===team.id\)/);
 assert.match(render,/renderPartnerRankingOnlyPanel\(\)/);
 assert.match(render,/const daily=pInline\("pInlineDailySummary"\)/);
});

test("partner cards mirror eleven original dashboard controls without finance API subscriptions",()=>{
 const expected=[
  ["salesAnalysisToggle","analysis"],["individualRankingToggle","individual"],
  ["productRankingToggle","product"],["teamRankingToggle","team"],
  ["revenueChartToggle","chart"],["allTeamsOverviewToggle","detail"],
  ["productSummaryToggle","products"],["reportBuilderToggle","report"],
  ["dailyGoalCalculatorToggle","goal"],["dailySummaryToggle","daily"],
  ["recordHistoryToggle","history"]
 ];
 const internal=scope('id="dashboard"','id="dashboardDetailArea"');
 const mount=scope("function mountPartnerCanonicalNavigation(){","\nfunction renderPartnerCountOnlyExtras(){");
 const navDefinition=mount.slice(mount.indexOf("const tabs=["),mount.indexOf("];",mount.indexOf("const tabs=["))+2);
 for(const [button,panel] of expected){
  assert.ok(internal.includes('id="'+button+'"'),"missing internal "+button);
  assert.ok(navDefinition.includes('["'+button+'","'+panel+'"'),"missing exact partner parity "+panel);
 }
 assert.equal((mount.match(/cloneNode\(true\)/g)||[]).length,1,"same markup, no divergent menu");
 assert.match(mount,/card\.removeAttribute\("id"\)/);
 assert.match(mount,/card\.removeAttribute\("style"\)/);
 assert.match(mount,/card\.querySelectorAll\("\[id\]"\)/);
 assert.match(mount,/target\.replaceChildren\(\.\.\.cards\)/);
 assert.match(mount,/mount\.append\(input\)/);
 assert.match(mount,/userBar\.after\(pInline\("partnerInlineWorkspace"\)\)/);
 assert.match(html,/mountPartnerCanonicalNavigation\(\)/);
 assert.match(html,/id="partnerSameAppDashboardDetails"/);
 for(const panel of ["Analysis","Chart","ProductSummary","Report","Goal"])
  assert.match(html,new RegExp('id="partnerPanel'+panel+'"'));
 const extras=scope("function renderPartnerCountOnlyExtras(){",
   "\npInline(\"pPartnerGoalTarget\").addEventListener");
 for(const marker of ["snap.records","snap.categories","snap.teams",
  "pPartnerDailyCount","pPartnerStaffCount","pPartnerTeamCount",
  "pPartnerAnalysis","pPartnerChart","pPartnerProductSummary",
  "pPartnerReportText","renderPartnerGoalEstimate()"])
  assert.ok(extras.includes(marker),marker);
 for(const forbidden of ["getDocs(","getDoc(","onSnapshot(","collection(db,",
  "monthlyRevenue","revenuePerUnit","unitPrice","revenueGoals"])
  assert.ok(!extras.includes(forbidden),"private data reference "+forbidden);
 assert.match(html,/id="pPartnerRecordToggle"/);
 assert.match(html,/id="pPartnerMemberShortcut"/);
 assert.match(html,/if\(id==="partnerPanelRecord"\)continue/);
});

test("safe hamburger menu mirrors the original while blocking native financial actions",()=>{
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] \.user-bar \.management-tab-shell\{display:none!important\}/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] \.user-bar \.partner-safe-menu\{display:block!important\}/);
 const source=scope("function mountPartnerSafeManagementMenu(){","\n// Partner sees original dashboard-style menu");
 for(const phrase of ["management-tab-button","management-tab-panel","quick-menu-button",
  '["🏢","会社","account"]','["✉️","招待リンク","invite"]',
  '["👥","班管理","members"]','["👤","メンバー","members"]',
  '["📦","商材管理","products"]','["⚙️","アカウント設定","account"]',
  '["leader","owner"].includes(snap.role)','partnerSameAppSelectPanel(action==="invite"?"members":action)'])
  assert.ok(source.includes(phrase),"missing partner-safe operation "+phrase);
 for(const unsafe of ["openManagementPanel(","getDocs(","onSnapshot(","monthlyRevenue",
  "revenuePerUnit","unitPrice","pricingOptions"])
  assert.ok(!source.includes(unsafe),"unsafe finance menu "+unsafe);
 assert.match(html,/mountPartnerSafeManagementMenu\(\)/);
 assert.match(html,/if\(safeAccount\)safeAccount.hidden=true/);
});
