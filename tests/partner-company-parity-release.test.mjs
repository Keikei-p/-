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
 assert.equal((mount.match(/cloneNode\(true\)/g)||[]).length,2,"the extra input card and eleven canonical dashboard cards share markup");
 assert.match(mount,/card\.removeAttribute\("id"\)/);
 assert.match(mount,/card\.removeAttribute\("style"\)/);
 assert.match(mount,/card\.querySelectorAll\("\[id\]"\)/);
 assert.match(mount,/target\.replaceChildren\(\.\.\.cards\)/);
 assert.match(mount,/target\.append\(details\)/);
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
 assert.match(html,/function partnerSameAppPositionPanel\(name\)/);
});

test("safe hamburger menu mirrors the original while blocking native financial actions",()=>{
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] \.user-bar \.management-tab-shell\{display:none!important\}/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] \.user-bar \.partner-safe-menu\{display:block!important\}/);
 const source=scope("function mountPartnerSafeManagementMenu(){","\n// Partner sees original dashboard-style menu");
 for(const phrase of ["management-tab-button","management-tab-panel","quick-menu-button",
  '["🏢","会社","account"]','["✉️","招待リンク","invite"]',
  '["👥","班管理","members"]','["👤","メンバー管理","members"]',
  '["📦","商材追加・管理","catalog"]','["⚙️","アカウント設定","account"]',
  '["leader","owner"].includes(snap.role)','partnerSameAppSelectPanel(action)'])
  assert.ok(source.includes(phrase),"missing partner-safe operation "+phrase);
 for(const unsafe of ["openManagementPanel(","getDocs(","onSnapshot(","monthlyRevenue",
  "revenuePerUnit","unitPrice","pricingOptions"])
  assert.ok(!source.includes(unsafe),"unsafe finance menu "+unsafe);
 assert.match(html,/mountPartnerSafeManagementMenu\(\)/);
 assert.match(html,/if\(safeAccount\)safeAccount.hidden=name!=="account"/);
});

test("shared standings use one verified API and keep financial UI isolated",()=>{
 const source=scope("let sharedDailyRankingGeneration=0;",
   "\n// Partner sees original dashboard-style menu, not the finance DOM.");
 assert.match(source,/readPartnerWorkDay\(payload\)/);
 assert.match(source,/sharedRankings:true/);
 assert.match(source,/payload\.workspaceCompanyId=partnerInlineWorkspaceCompany/);
 assert.match(source,/response\?\.scope!=="shared_counts_only"/);
 assert.match(source,/response\.includesDirect!==true/);
 assert.match(source,/const internal=response\.direct/);
 assert.match(source,/companyRows\.push\(\{name:"🏢 直営"/);
 assert.match(source,/!Number\.isSafeInteger\(response\.productCounts\[k\]\)/);
 assert.match(source,/!recordsReady/);
 assert.match(source,/recordsSubscribedMonth!==date\.slice\(0,7\)/);
 assert.match(source,/appendSharedRankingRows\(content,"🏢 会社別件数"/);
 assert.match(source,/appendSharedRankingRows\(content,"🏆 個人ランキング"/);
 assert.match(source,/appendSharedRankingRows\(content,"👥 班ランキング"/);
 assert.match(source,/appendSharedRankingRows\(content,"📦 商材別件数"/);
 assert.match(source,/complete\?\s*"件数照合済み/);
 assert.match(source,/未報告・未照合/);
 for(const marker of ["getDocs(","getDoc(","onSnapshot(","collection(db,",
   "totalRevenue","revenuePerUnit","canCurrentUserViewUnitPrice("])
  assert.ok(!source.includes(marker),"unpermitted finance access "+marker);
 for(const id of ["partnerSharedRankingsSection","partnerSharedRankingsRefresh",
  "partnerSharedRankingsStatus","partnerSharedRankingContent",
  "ownerSharedRankingsSection","ownerSharedRankingsRefresh",
  "ownerSharedRankingsStatus","ownerSharedRankingContent"])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
});

test("corrected counts and date changes invalidate stale joint standings, while team detail opens the shared tree",()=>{
 const select=scope("function partnerSameAppSelectPanel(name){",
  '\npInline("partnerSameAppNavigation").addEventListener');
 assert.match(select,/name==="detail"/);
 assert.match(select,/loadSharedDailyStandings\("partnerDetail"\)/);
 const fetch=scope("async function partnerInlineFetch(){",
  "\nasync function openSameAppPartnerWorkspace(");
 assert.match(fetch,/loadSharedDailyStandings\("partner",true\)/);
 assert.match(fetch,/loadSharedDailyStandings\("partnerDetail",true\)/);
 const action=scope("async function partnerInlineRun(work){",
  "\nfunction partnerInlinePayload(data){");
 assert.match(action,/sharedDailyRankCache\.clear\(\)/);
 assert.match(action,/\+\+sharedDailyRankingGeneration/);
 assert.ok(action.indexOf("sharedDailyRankCache.clear()")<action.indexOf("await partnerInlineFetch()"),
  "invalidate only after successful mutation, before refreshing the visible screen");
 const reset=scope("function resetPartnerInline(){","// Clone the eleven button styles");
 assert.match(reset,/sharedDailyRankCache\.clear\(\)/);
 assert.match(reset,/\+\+sharedDailyRankingGeneration/);
 const memory=new Map([["company-A",42]]);
 const fields={pInlineStatus:{textContent:""},pInlineInviteUrl:{value:""},
  pInlineInviteResult:{hidden:false},partnerInlineWorkspace:{hidden:false},
  partnerInviteAtMain:{hidden:false}};
 const ctx={partnerInlineNonce:0,ownerPartnerTeamsNonce:0,partnerAuditNonce:0,
  sharedDailyRankingGeneration:0,sharedDailyRankCache:memory,
  partnerInlineData:{records:[{totalCount:2}]},partnerInlineWorkspaceCompany:"company-A",
  partnerInlineBusy:true,
  appScreen:{removeAttribute(){}},authScreen:{removeAttribute(){}},
  pInline:id=>fields[id]};
 runInNewContext(reset+"\nresetPartnerInline()",ctx);
 assert.equal(memory.size,0,"no old company's rank data after logout");
 assert.equal(ctx.sharedDailyRankingGeneration,1,"invalidate stale in-flight request");
 assert.equal(ctx.partnerAuditNonce,1,"invalidate stale audit requests on logout");
 assert.equal(ctx.partnerInlineWorkspaceCompany,"");
 assert.equal(ctx.partnerInlineData,null);
});


test("legacy direct product resolution keeps verified totals but never invents ranked people",()=>{
 const src=scope("function verifiedDirectDayCounts(date){","\nfunction appendSharedRankingRows(");
 assert.ok(src.includes("productTotals=new Map()"),"product accumulator must not shadow original catalog");
 assert.ok(src.includes("products.find("),"original catalog resolves product IDs");
 const ctx={
  recordsReady:true,recordsSubscribedMonth:"2026-11",dashboardMonth:{value:"2026-11"},
  canLoadPartnerRanking:()=>true,currentUserData:{companyId:"hub"},
  products:[{id:"p1",name:"NURO光"}],
  records:[
   {id:"old",companyId:"hub",date:"2026-11-02",teamId:"a",teamNameSnapshot:"旧1班",
    memberNameSnapshot:"不明",results:[{productId:"p1",count:2}],totalCount:2},
   {id:"verified",uid:"user42",companyId:"hub",date:"2026-11-02",
    teamId:"a",teamNameSnapshot:"旧1班",memberNameSnapshot:"実在",
    results:[{productId:"p1",count:3}],totalCount:3}
  ],
  getRecordResults:r=>r.results,
  getCurrentMemberName:r=>r.memberNameSnapshot,
  getCurrentTeamName:r=>r.teamNameSnapshot,
  sharedVerifiedProductCategory:name=>name==="NURO光"?"NURO":null
 };
 const result=runInNewContext(src+"\nverifiedDirectDayCounts('2026-11-02')",ctx);
 assert.equal(result.totalCount,5);
 assert.equal(result.teams.length,1);
 assert.equal(result.teams[0].totalCount,5,"historical team totals remain intact");
 assert.equal(result.people.length,1,"missing UID must not invent an individual");
 assert.equal(result.people[0].totalCount,3);
 assert.equal(result.peopleVerified,false);
 assert.equal(result.unverifiedPersonRecords,1);
 assert.equal(result.products[0].name,"NURO");
 assert.equal(result.products[0].count,5);
 assert.match(html,/report\.direct\.peopleVerified===true/);
 assert.match(html,/未報告・未照合の実績があります/);
});

test("partner dashboard opens the tapped canonical card in its own grid row and keeps count entry two columns",()=>{
 const css=scope('<style id="nicoPartnerSameAppStyle">','</style>');
 assert.match(css,/#partnerInlineWorkspace #pInlineCountFields\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/#partnerInlineWorkspace #partnerSameAppDashboardDetails\{grid-column:1\/-1/);
 const mount=scope("function mountPartnerCanonicalNavigation(){","\nfunction renderPartnerCountOnlyExtras(){");
 assert.match(mount,/recordButton\.dataset\.partnerPanel="record"/);
 assert.match(mount,/target\.append\(details\)/);
 assert.doesNotMatch(mount,/mount\.append\(input\)/);
 const position=scope("function partnerSameAppPositionPanel(name){","\nwindow.addEventListener");
 assert.match(position,/button\.offsetTop/);
 assert.match(position,/row\[row.length-1\]/);
 assert.match(position,/\.after\(detail\)/);
 const nav=scope('id="partnerSameAppNavigation"','id="partnerPanelMembers"');
 for(const id of ["record","individual","team","product","detail","daily","history"])
  assert.match(nav,new RegExp('data-partner-panel="'+id+'"'));
 assert.match(html,/id="partnerLegacyShortcuts" hidden/);
});
test("partner management contains standalone invitation, member, and private catalog tabs",()=>{
 for(const id of ["partnerPanelInvite","partnerPanelCatalog","partnerPanelMembers",
   "pInlineInviteTeam","pInlineInviteEmail","pInlineInviteRole","pInlineCreateInvite",
   "pInlineCustomName","pInlineAddPrivateProduct","pInlinePrivateProductList"])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 const menu=scope("function mountPartnerSafeManagementMenu(){","\n// Partner sees original dashboard-style menu");
 for(const action of ['["✉️","招待リンク","invite"]','["👤","メンバー管理","members"]',
   '["📦","商材追加・管理","catalog"]'])
  assert.ok(menu.includes(action),action);
 const select=scope("function partnerSameAppSelectPanel(name){",
  '\npInline("partnerSameAppNavigation").addEventListener');
 for(const id of ["partnerPanelInvite","partnerPanelCatalog","partnerPanelMembers"])
  assert.ok(select.includes(id),id);
 assert.match(html,/pInline\("pInlineInviteTeam"\)\.value/);
 assert.match(html,/action:"addPrivateProduct"/);
 assert.match(html,/action:"setPrivateProduct"/);
 assert.match(html,/privateCounts,expectedVersion/);
 assert.match(html,/saved\.privateCounts\?\.\[id\]/);
 assert.match(html,/if\(product\.active\)privateCounts\[id\]=n/);
 assert.match(html,/partnerInlineRun\(async\(\)=>/);
});


test("partner count inputs show live totals for public and company-only products",()=>{
 const source=scope("function renderPartnerEntryTotals(){",
   "\nfunction partnerInlineRenderCounts(){");
 const output={textContent:""};
 const fields=[
  {dataset:{countKey:"NURO"},value:"2"},
  {dataset:{countKey:"SBMNP"},value:"1"},
  {dataset:{privateCountId:"custom"},value:"4"}
 ];
 const node={querySelectorAll:()=>fields};
 const ctx={pInline:id=>id==="pInlineEntryTotals"?output:node};
 runInNewContext(source+"\nrenderPartnerEntryTotals();",ctx);
 assert.equal(output.textContent,"共有商材 3件｜協力店専用 4件");
 fields[2].value="-1";
 runInNewContext(source+"\nrenderPartnerEntryTotals();",ctx);
 assert.equal(output.textContent,"件数を確認してください");
 fields[2].value="4.5";
 runInNewContext(source+"\nrenderPartnerEntryTotals();",ctx);
 assert.equal(output.textContent,"件数を確認してください");
 assert.match(html,/id="pInlineEntryTotals"/);
 const mutation=scope("async function partnerInlineRun(work){",
   "\nfunction partnerInlinePayload(data){");
 assert.match(mutation,/partnerInlineRenderCounts\(\)/);
 assert.match(mutation,/renderPartnerPrivateProductCatalog\(\)/);
});

test("partner entry reuses canonical 2-column product cards with safe zero/clear operations",()=>{
 assert.match(html,/id="pInlineCountFields" class="product-input-list"/);
 assert.match(html,/id="pInlineSave" class="record-save-button"/);
 assert.match(html,/id="pInlineZero" class="record-clear-button"/);
 assert.match(html,/id="pInlineClear" class="record-clear-button"/);
 assert.match(html,/className="p-inline-field product-input-group product-input-group--compact"/);
 assert.match(html,/function partnerInlineClearFields\(\)/);
 const action=scope('pInline("pInlineStaff").onchange=partnerInlineRenderCounts;',
  '\npInline("pInlineAddTeam").onclick');
 assert.match(action,/input:not\(\[readonly\]\)/);
 assert.match(action,/renderPartnerEntryTotals\(\)/);
 assert.match(action,/保存済み実績は変更していません/);
 assert.match(action,/pInline\("pInlineSave"\)\.click\(\)/);
 const save=scope('pInline("pInlineSave").onclick=',"\n// Original internal owner sees existing teams");
 assert.match(save,/saved\.version!==result\?\.version/);
 assert.match(save,/saved\.privateCounts\?\.\[id\]/);
});
