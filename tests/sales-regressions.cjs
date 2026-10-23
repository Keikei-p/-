const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const html = fs.readFileSync(process.env.SALES_HTML || path.join(__dirname, '../index.html'), 'utf8');
function source(name) {
  let start = html.indexOf(`function ${name}(`);
  if (html.slice(start - 6, start) === "async ") start -= 6;
  assert(start >= 0, `Missing function ${name}`);
  const end = html.indexOf('\n}', start);
  return html.slice(start, end + 2);
}
function context(names, values = {}) {
  const ctx = vm.createContext(values);
  vm.runInContext(names.map(source).join('\n'), ctx);
  return ctx;
}
function handler(name) {
  const start = html.indexOf(`${name}.onclick =`);
  const end = html.indexOf('\n  };', start);
  assert(start >= 0 && end > start);
  return html.slice(start, end + 5);
}
function element() {
  return { children: [], dataset: {}, style: {}, attributes: {}, _html: '', textContent: '', value: '',
    set innerHTML(value) { this._html = value; this.children = []; },
    get innerHTML() { return this._html; },
    get options() { return this.children; },
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelectorAll() { return []; }
  };
}
const document = { createElement: () => element() };

test('Realtime member refresh retains an authorized correction target outside own team', () => {
  const select = element(); select.value = 'other';
  const ctx = context(['updateRecordMemberOptions', 'ensureRecordMemberOption', 'canCurrentUserCorrectRecord'], {
    document, recordSupportMembersLabel:element(), recordSupportMembers:{checked:false}, recordMember: select, recordDate: {value:'2026-10-05'}, editingRecordId:'r',
    records:[{id:'r',uid:'other',date:'2026-10-05',companyId:'c',memberNameSnapshot:'過去の担当者'}],
    currentUser:{uid:'self'}, currentUserData:{uid:'self',companyId:'c',name:'自分'}, members:[],
    isCurrentCompanyOwner:()=>true,isCurrentTeamLeader:()=>false
  });
  ctx.updateRecordMemberOptions();
  assert.equal(select.value,'other');
  assert(select.options.some(o=>o.value==='other'));
  ctx.records[0].companyId='another-company';
  ctx.updateRecordMemberOptions();
  assert(!select.options.some(o=>o.value==='other'));
});

test('Deleted historical team remains selectable without changing membership history', () => {
  const select=element();
  const ctx=context(['showRecordCorrectionTeam'],{document,recordCorrectionTeam:select,
    recordCorrectionTeamGroup:element(),isCurrentTeamLeader:()=>false,isCurrentCompanyOwner:()=>true,
    members:[], recordMember:{value:'self'}, recordDate:{value:'2026-10-06'}, currentUserData:{}, getMemberTeamForDate:()=>({teamId:'new'}),teams:[{id:'new',name:'新班'}]});
  const record={teamId:'old',teamNameSnapshot:'旧班',teamHistory:[{fromTeamId:'old'}]};
  const before=JSON.stringify(record);
  ctx.showRecordCorrectionTeam(record);
  assert.equal(select.value,'old');
  assert(select.options.some(o=>o.value==='old'&&o.textContent.includes('履歴')));
  assert.equal(JSON.stringify(record),before);
  ctx.showRecordCorrectionTeam({teamId:'new'});
  assert.equal(select.options.filter(o=>o.value==='new').length,1);
});

test('Save locks form and releases lock on completion', () => {
  const ctx=context(['setRecordSaveInProgress'],{recordManagement:element(),saveRecordButton:element(),recordSaveInProgress:false});
  ctx.setRecordSaveInProgress(true);
  assert.equal(ctx.recordSaveInProgress,true);
  assert.equal(ctx.recordManagement.inert,true);
  assert.equal(ctx.recordManagement.attributes['aria-busy'],'true');
  ctx.setRecordSaveInProgress(false);
  assert.equal(ctx.recordManagement.inert,false);
  assert.equal(ctx.saveRecordButton.disabled,false);
});

test('Busy save blocks zero-report, clear, second save and edit without changing draft', async () => {
  const ctx=context(['editRecord'],{recordSaveInProgress:true,zeroResultRequested:false,
    noResultButton:{},clearRecordButton:{},saveRecordButton:{}});
  for(const name of ['noResultButton','clearRecordButton','saveRecordButton']) {
    vm.runInContext(handler(name),ctx);
    await ctx[name].onclick();
  }
  ctx.editRecord({});
  assert.equal(ctx.zeroResultRequested,false);
});

test('Zero report keeps input draft until persistence succeeds; cancel does not request a save', () => {
  let clicks=0,clears=0;
  const ctx=vm.createContext({recordSaveInProgress:false,zeroResultRequested:false,noResultButton:{},
    recordDate:{value:'2026-10-05'},recordMember:{value:'u'},confirm:()=>true,
    prepareProductInputList:()=>clears++,saveRecordButton:{click:()=>clicks++}});
  vm.runInContext(handler('noResultButton'),ctx);
  ctx.noResultButton.onclick();
  assert.equal(clicks,1);assert.equal(clears,0);assert.equal(ctx.zeroResultRequested,true);
  ctx.zeroResultRequested=false;ctx.confirm=()=>false;ctx.noResultButton.onclick();
  assert.equal(clicks,1);assert.equal(ctx.zeroResultRequested,false);
});

test('Records and goals listener failures visibly warn that values can be stale', () => {
  const subscriptions=[];const warnings=[];
  const ctx=context(['startRealtimeListeners'],{
    stopRealtimeListeners:()=>{},isCurrentCompanyManager:()=>false,currentUser:null,
    companyCollectionQuery:n=>n,recordsCollectionQuery:()=> 'records',revenueGoalsCollectionQuery:()=>null,
    onSnapshot:(query,next,error)=>{subscriptions.push({query,error});return ()=>{};},
    console:{error:()=>{}},databaseStatus:element(),showError:m=>warnings.push(m)
  });
  ctx.startRealtimeListeners();
  for(const query of ['records','goals']) {
    const sub=subscriptions.find(s=>s.query===query);
    assert.equal(typeof sub.error,'function');sub.error({code:'permission-denied'});
  }
  assert.equal(warnings.length,2);
  assert(warnings.every(m=>m.includes('再読み込み')));
  assert(ctx.databaseStatus.textContent.includes('停止'));
});

function textOf(node) { return node.innerHTML + node.textContent + node.children.map(textOf).join(''); }
test('Hidden team revenue is labeled hidden instead of showing a false zero', () => {
  const ctx=context(['renderSelectedTeamMemberDetail'],{document,members:[],
    recordBelongsToTeam:()=>false,buildTeamGoalProgress:()=>({totalTarget:0}),
    buildTeamRevenueGoalProgress:()=>({targetRevenue:0,actualRevenue:0,remainingRevenue:0,progress:0,barProgress:0}),
    escapeHtml:s=>s,formatYen:v=>`¥${v}`,canCurrentUserViewRevenueForTeam:()=>false});
  const container=element();ctx.renderSelectedTeamMemberDetail(container,{id:'other',name:'他班'},[]);
  assert(textOf(container).includes('売上非表示'));assert(!textOf(container).includes('¥0'));
  ctx.canCurrentUserViewRevenueForTeam=()=>true;
  const own=element();ctx.renderSelectedTeamMemberDetail(own,{id:'own',name:'自班'},[]);
  assert(textOf(own).includes('¥0'));
});

test('Transactional correction replaces results and preserves metadata', async () => {
  for (const results of [{A:{count:1,revenuePerUnit:100}}, {C:{count:4,revenuePerUnit:300}}, {}]) {
    let stored={companyId:'c',uid:'u',date:'2026-10-06',teamId:'a',createdAt:'keep',createdByUid:'creator',custom:'keep',results:{A:{count:3},B:{count:2}}};
    const before=structuredClone(stored);
    const data={results,totalCount:Object.values(results).reduce((n,r)=>n+r.count,0),
      totalRevenue:Object.values(results).reduce((n,r)=>n+r.count*r.revenuePerUnit,0)};
    const ctx=context(['persistDailyRecord','recordRevision','recordConflict','validateFinancialRecordForSave','getRecordResults','calculateResultsTotals'],{
      db:{},query:()=>{},where:()=>{},recordsCollectionQuery:()=>{},
      getDocsFromServer:async()=>({size:1,docs:[{id:'r'}]}),
      runTransaction:async(db,callback)=>callback({get:async()=>({exists:()=>true,id:'r',data:()=>stored}),
        set:(ref,payload,options)=>{assert(options.mergeFields.includes('results'));for(const key of options.mergeFields)stored[key]=structuredClone(payload[key]);}})
    });
    await ctx.persistDailyRecord({id:'r'},data,before,ctx.recordRevision(before));
    assert.deepEqual(stored.results,results); assert.equal(stored.createdAt,'keep');assert.equal(stored.createdByUid,'creator');assert.equal(stored.custom,'keep');
    const totals=ctx.calculateResultsTotals(ctx.getRecordResults(stored));
    assert.equal(totals.count,data.totalCount);
    assert.equal(totals.revenue,Object.values(results).reduce((n,r)=>n+r.count*r.revenuePerUnit,0));
  }
});

test('Support choices are opt-in and inactive people stay excluded',()=>{
  const select=element();
  const ctx=context(['updateRecordMemberOptions'],{document,recordMember:select,
    recordSupportMembersLabel:element(),recordSupportMembers:{checked:false},
    recordDate:{value:'2026-10-06'},editingRecordId:null,records:[],
    currentUserData:{teamId:'a'},isCurrentCompanyOwner:()=>false,isCurrentTeamLeader:()=>true,
    members:[{id:'own',name:'自班',teamId:'a'},{id:'helper',name:'応援',teamId:'b'},{id:'inactive',teamId:'b',active:false}]});
  ctx.updateRecordMemberOptions();assert.deepEqual(select.options.map(o=>o.value),['own']);
  ctx.recordSupportMembers.checked=true;ctx.updateRecordMemberOptions();
  assert.deepEqual(select.options.map(o=>o.value),['own','helper']);
  assert(select.options[1].textContent.includes('応援'));
});

test('Only owner can correct another team; self and own team remain editable',()=>{
  const ctx=context(['canCurrentUserCorrectRecord'],{currentUser:{uid:'leader'},currentUserData:{companyId:'c',teamId:'a'},
    isCurrentCompanyOwner:()=>false,isCurrentTeamLeader:()=>true});
  assert.equal(ctx.canCurrentUserCorrectRecord({companyId:'c',teamId:'a',uid:'helper'}),true);
  assert.equal(ctx.canCurrentUserCorrectRecord({companyId:'c',teamId:'b',uid:'helper'}),false);
  ctx.isCurrentCompanyOwner=()=>true;
  assert.equal(ctx.canCurrentUserCorrectRecord({companyId:'c',teamId:'b',uid:'helper'}),true);
  assert.equal(ctx.canCurrentUserCorrectRecord({companyId:'foreign',teamId:'a',uid:'helper'}),false);
  ctx.isCurrentCompanyOwner=()=>false;ctx.isCurrentTeamLeader=()=>false;
  assert.equal(ctx.canCurrentUserCorrectRecord({companyId:'c',teamId:'b',uid:'leader'}),true);
  assert.equal(ctx.canCurrentUserCorrectRecord({companyId:'c',teamId:'a',uid:'other'}),false);
});

test('Stale edits, deleted records and simultaneous same-day registration stop without writes',async()=>{
  const initial={uid:'u',date:'2026-10-06',teamId:'a',results:{A:{count:1}}};
  let current=structuredClone(initial),writes=0;
  const ctx=context(['persistDailyRecord','recordRevision','recordConflict','validateFinancialRecordForSave'],{db:{},query:()=>{},where:()=>{},recordsCollectionQuery:()=>{},
    getDocsFromServer:async()=>({size:0,docs:[]}),
    runTransaction:async(db,callback)=>callback({get:async()=>({exists:()=>!!current,id:'r',data:()=>current}),set:()=>writes++})});
  const valid={results:{A:{count:1,revenuePerUnit:100}},totalCount:1,totalRevenue:100};
  await assert.rejects(ctx.persistDailyRecord({id:'r'},valid,null,null),{code:'record-conflict'});
  const rev=ctx.recordRevision(initial);current.results.A.count=2;
  await assert.rejects(ctx.persistDailyRecord({id:'r'},valid,initial,rev),{code:'record-conflict'});
  current=null;await assert.rejects(ctx.persistDailyRecord({id:'r'},valid,initial,rev),{code:'record-conflict'});
  ctx.getDocsFromServer=async()=>({size:2,docs:[{id:'r'},{id:'legacy'}]});
  await assert.rejects(ctx.persistDailyRecord({id:'r'},valid,null,null),{code:'record-conflict'});
  assert.equal(writes,0);
});

test('Choosing a helper with a different-team record does not load its historical revenue into the editor',async()=>{
  let prepared='not-called',message='';
  const ctx=context(['loadExistingRecordIntoForm','recordRevision'],{
    recordDate:{value:'2026-10-06'},recordMember:{value:'helper'},recordLocation:{value:'old'},saveRecordButton:{},
    findDailyRecord:()=>({id:'r',uid:'helper',date:'2026-10-06',teamId:'other',results:{A:{count:3,revenuePerUnit:999}}}),
    canCurrentUserCorrectRecord:()=>false,showRecordCorrectionTeam:()=>{},prepareProductInputList:value=>prepared=value,showError:value=>message=value
  });
  await ctx.loadExistingRecordIntoForm();
  assert.equal(prepared,undefined);assert.equal(ctx.editingRecordRevision,null);
  assert(message.includes('オーナー'));assert.equal(ctx.recordLocation.value,'');
});


test('Team ranking has three independent tabs without removing the existing dashboard', () => {
  for(const id of ['teamRankingRevenueButton','teamRankingRevenueProgressButton','teamRankingProgressButton']){
    assert(html.includes(`id="${id}"`), `Missing ranking tab ${id}`);
  }
  assert(html.includes('目標売上進捗'));
  assert(html.includes('目標件数進捗'));
  assert(html.includes('売上'));
  assert(html.includes('id="individualRankingContent"'));
});

test('Team ranking sorts revenue amount, revenue target ratio and count target ratio separately', () => {
  const rows=[
    {name:'A班',revenue:200000,count:12,revenueTarget:100000,revenueActual:200000,revenueProgress:200,totalTarget:60,totalActual:12,progress:20},
    {name:'B班',revenue:150000,count:20,revenueTarget:50000,revenueActual:150000,revenueProgress:300,totalTarget:20,totalActual:20,progress:100},
    {name:'C班',revenue:400000,count:30,revenueTarget:0,revenueActual:400000,revenueProgress:0,totalTarget:0,totalActual:30,progress:0},
    {name:'D班',revenue:40000,count:4,revenueTarget:100000,revenueActual:40000,revenueProgress:40,totalTarget:4,totalActual:4,progress:100}
  ];
  const ctx=context(['sortTeamRankingRows']);
  const names=mode=>Array.from(ctx.sortTeamRankingRows(structuredClone(rows),mode),r=>r.name);
  assert.deepEqual(names('revenue'),['C班','A班','B班','D班']);
  assert.deepEqual(names('revenueProgress'),['B班','A班','D班','C班']);
  assert.deepEqual(names('progress'),['B班','D班','A班','C班']);
});

test('Revenue ranking modes do not include teams without revenue viewing permission',()=>{
  const teams=[{id:'mine',name:'自班',active:true},{id:'other',name:'他班',active:true},
    {id:'retired',name:'終了班',active:false}];
  const teamMap={mine:{count:2,revenue:2000},other:{count:10,revenue:999999},retired:{count:10,revenue:999999}};
  const monthly=[{teamId:'mine'}];
  let revenueGoalCalls=0;
  const ctx=context(['buildTeamRankingRows'],{
    teams,
    canCurrentUserViewRevenueForTeam:id=>id==='mine',
    buildTeamGoalProgress:()=>({totalTarget:10,totalActual:2,remaining:8,progress:20}),
    buildTeamRevenueGoalProgress:()=>{revenueGoalCalls++;return {targetRevenue:10000,actualRevenue:2000,remainingRevenue:8000,progress:20}}
  });
  const before=JSON.stringify([teamMap,monthly]);
  assert.deepEqual(Array.from(ctx.buildTeamRankingRows(teamMap,monthly,'revenue'),r=>r.id),['mine']);
  assert.deepEqual(Array.from(ctx.buildTeamRankingRows(teamMap,monthly,'revenueProgress'),r=>r.id),['mine']);
  assert.deepEqual(Array.from(ctx.buildTeamRankingRows(teamMap,monthly,'progress'),r=>r.id),['mine','other']);
  assert.equal(revenueGoalCalls,2);
  assert.equal(JSON.stringify([teamMap,monthly]),before);
});

test('Revenue goal progress is calculated from existing target and record units',()=>{
  const ctx=context(['getTeamRevenueGoal','buildTeamRevenueGoalProgress'],{
    revenueGoals:[{id:'rg',teamId:'a',month:'2026-10',targetRevenue:40000}],
    dashboardMonth:{value:'2026-10'},
    canCurrentUserViewRevenueForTeam:id=>id==='a',
    recordBelongsToTeam:(record,team)=>record.teamId===team.id,
    getDisplayRecordResults:record=>record.results
  });
  const monthly=[{teamId:'a',results:[{count:5,revenuePerUnit:5000}]},
    {teamId:'b',results:[{count:1,revenuePerUnit:999999}]}];
  const goal=ctx.buildTeamRevenueGoalProgress({id:'a'},monthly);
  assert.equal(goal.targetRevenue,40000);
  assert.equal(goal.actualRevenue,25000);
  assert.equal(goal.remainingRevenue,15000);
  assert.equal(goal.progress,62.5);
  assert.equal(ctx.buildTeamRevenueGoalProgress({id:'b'},monthly).progress,0);
  ctx.revenueGoals=[];
  const unconfigured=ctx.buildTeamRevenueGoalProgress({id:'a'},monthly);
  assert.equal(unconfigured.targetRevenue,0);
  assert.equal(unconfigured.progress,0);
});


test('Renamed product displays current master name by stable ID without rewriting historical values',()=>{
  const sourceRecords=[
    {id:'r1',companyId:'c',date:'2026-10-15',results:{
      evergreen:{productName:'HTB',count:2,revenuePerUnit:10000},
      htb:{productName:'HTB',count:2,revenuePerUnit:0}
    }},
    {id:'r2',companyId:'c',date:'2026-10-15',results:{
      evergreen:{productName:'HTB',count:1,revenuePerUnit:10000}
    }}
  ];
  const before=JSON.stringify(sourceRecords);
  const ctx=context(['getRecordResults','currentProductDisplayName',
    'currentCatalogRevenueUnitForDisplay','getDisplayRecordResults'],{
    products:[
      {id:'evergreen',name:'エバーグリーン',revenue:20000},
      {id:'htb',name:'HTB',revenue:0}
    ],
    canCurrentUserViewRevenueForRecord:()=>true,
    getProductPricingOptions:p=>[{cashback:0,revenuePerUnit:p.revenue}]
  });
  const first=Array.from(ctx.getDisplayRecordResults(sourceRecords[0]));
  assert.equal(first[0].productName,'エバーグリーン');
  assert.equal(first[1].productName,'HTB');
  assert.equal(first[0].count,2);
  assert.equal(first[0].revenuePerUnit,20000);
  assert.equal(first[1].revenuePerUnit,0);
  assert.equal(JSON.stringify(sourceRecords),before);
  assert.equal(ctx.getRecordResults(sourceRecords[0])[0].productName,'HTB');
  ctx.canCurrentUserViewRevenueForRecord=()=>false;
  const masked=Array.from(ctx.getDisplayRecordResults(sourceRecords[0]));
  assert.equal(masked[0].productName,'エバーグリーン');
  assert.equal(masked[0].revenuePerUnit,0);
  assert.equal(JSON.stringify(sourceRecords),before);
});

test('Missing product ID or deleted product falls back to stored name, not a guessed replacement',()=>{
  const ctx=context(['currentProductDisplayName'],{
    products:[{id:'evergreen',name:'エバーグリーン'}]
  });
  assert.equal(ctx.currentProductDisplayName({productId:'old-unknown',productName:'HTB'}),'HTB');
  assert.equal(ctx.currentProductDisplayName({productName:'HTB'}),'HTB');
  assert.equal(ctx.currentProductDisplayName({productId:'evergreen',productName:'HTB'}),'エバーグリーン');
});

test('Product summary groups by product IDs so equal old labels do not merge',()=>{
  const start=html.indexOf('function renderDashboard(');
  const finish=html.indexOf('function addAnalysisValue(',start);
  assert(start>=0 && finish>start);
  const source=html.slice(start,finish);
  assert.match(source,/const productKey =\s*result\.productId/);
  assert.match(source,/productMap\[productKey\]\.count/);
  assert.match(source,/productMap\[productKey\]\.revenue/);
  const summary=source.includes('renderProductSummary(');
  assert.equal(summary,true);
});


test('Count-only daily target calculator divides remaining product targets into realistic integer-day patterns',()=>{
  const ctx=context(['buildDailyCountPlan']);
  const goal={rows:[
    {productId:'nuro',name:'NURO光',target:30,actual:18,remaining:12},
    {productId:'ym',name:'YMNＰ',target:20,actual:15,remaining:5},
    {productId:'done',name:'完了商材',target:4,actual:6,remaining:0}
  ]};
  const before=JSON.stringify(goal);
  const plan=ctx.buildDailyCountPlan(goal,10);
  assert.equal(plan.days,10);
  assert.equal(plan.remainingTotal,17);
  assert.equal(plan.averagePerDay,1.7);
  assert.equal(plan.rows.length,3);
  assert.equal(plan.rows[0].averagePerDay,1.2);
  assert.equal(plan.rows[0].basic,1);
  assert.equal(plan.rows[0].extraDays,2);
  assert.equal(plan.rows[1].averagePerDay,0.5);
  assert.equal(plan.rows[1].basic,0);
  assert.equal(plan.rows[1].extraDays,5);
  assert.equal(plan.rows[2].remaining,0);
  for(const row of plan.rows) assert.equal(row.basic*plan.days + row.extraDays,row.remaining);
  assert.equal(JSON.stringify(goal),before);
  assert.equal(ctx.buildDailyCountPlan(goal,0),null);
  assert.equal(ctx.buildDailyCountPlan(goal,-1),null);
  assert.equal(ctx.buildDailyCountPlan(goal,2.5),null);
  assert.equal(ctx.buildDailyCountPlan(goal,367),null);
  assert.equal(ctx.buildDailyCountPlan(goal,'abc'),null);
});

test('Calculator UI next to report uses counts only and never exposes revenue amounts or product pricing',()=>{
  const indexReport=html.indexOf('id="reportBuilderToggle"');
  const indexCalc=html.indexOf('id="dailyGoalCalculatorToggle"');
  assert(indexReport>=0 && indexCalc>indexReport && indexCalc-indexReport<1200);
  const selected=element();
  selected.replaceChildren=()=>{selected.children=[];};
  selected.value='';
  const days=element();days.value='10';
  const result=element();
  let renderedMonth='',renderedTeam='';
  const copyButton={disabled:true};
  const copyFallback={hidden:true};
  const ctx=context([
    'buildDailyCountPlan','dailyCountAllocationLabel',
    'formatDailyCountPlanForCopy','renderDailyGoalCalculator'
  ],{
    document,
    dailyGoalTeamSelect:selected,dailyGoalDaysInput:days,dailyGoalCalculatorResult:result,
    copyDailyGoalButton:copyButton,dailyGoalCopyFallback:copyFallback,
    dashboardMonth:{value:'2026-10'},
    currentUserData:{teamId:'a'},
    teams:[{id:'a',name:'第1班',active:true},{id:'b',name:'第2班',active:true}],
    records:[{date:'2026-10-16',teamId:'a'}],
    buildTeamGoalProgress:(team,monthly)=>{
      renderedMonth=monthly[0].date;
      renderedTeam=team.id;
      return {rows:[
        {productId:'p1',name:'NURO光',target:30,actual:18,remaining:12},
        {productId:'p2',name:'エバーグリーン',target:20,actual:15,remaining:5}
      ]};
    },
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  });
  ctx.renderDailyGoalCalculator();
  assert.equal(renderedMonth,'2026-10-16');
  assert.equal(renderedTeam,'a');
  assert.equal(selected.value,'a');
  assert.equal(selected.children.length,2);
  assert(result.innerHTML.includes('残り目標件数'));
  assert(result.innerHTML.includes('NURO光'));
  assert(result.innerHTML.includes('エバーグリーン'));
  assert(result.innerHTML.includes('1日平均 1.2件'));
  assert(result.innerHTML.includes('2件の日 × 2日'));
  assert(result.innerHTML.includes('1件の日 × 5日'));
  assert(!/¥|￥|円|売上|収益|単価|revenue/i.test(result.innerHTML));
  assert.equal(copyButton.disabled,false);
  assert.equal(copyFallback.hidden,true);
  assert(ctx.dailyGoalCopyText.includes('NURO光'));
  assert(!/¥|￥|円|売上|収益|単価|revenue/i.test(ctx.dailyGoalCopyText));
  days.value='0';
  ctx.renderDailyGoalCalculator();
  assert(result.textContent.includes('1〜366'));
  assert.equal(copyButton.disabled,true);
  assert.equal(ctx.dailyGoalCopyText,'');
});

test('Calculator has manager-only launcher and no Firestore persistence',()=>{
  const start=html.indexOf('function buildDailyCountPlan(');
  const end=html.indexOf('function buildTeamRevenueGoalProgress(',start);
  assert(start>=0 && end>start);
  const segment=html.slice(start,end);
  assert(!/setDoc|updateDoc|addDoc|writeBatch|runTransaction|formatYen/.test(segment));
  assert(html.includes('dailyGoalCalculatorToggle.style.display ='));
  assert(html.includes('renderDailyGoalCalculator();'));
});


test('One-tap daily goal copy includes team, month, operating days, product breakdown and integers only',()=>{
  const ctx=context(['dailyCountAllocationLabel','formatDailyCountPlanForCopy']);
  const plan={
    days:10,remainingTotal:17,averagePerDay:1.7,
    rows:[
      {productId:'a',name:'NURO光',target:30,actual:18,remaining:12,averagePerDay:1.2,basic:1,extraDays:2},
      {productId:'b',name:'エバーグリーン',target:20,actual:15,remaining:5,averagePerDay:0.5,basic:0,extraDays:5},
      {productId:'c',name:'HTB',target:4,actual:4,remaining:0,averagePerDay:0,basic:0,extraDays:0}
    ]
  };
  const original=JSON.stringify(plan);
  const actual=ctx.formatDailyCountPlanForCopy('1班','2026-10',plan);
  assert(actual.startsWith('🎯 目標日割り計算'));
  for(const content of [
    '1班｜2026-10','残り稼働：10日','目標まで残り：17件',
    '1日平均：1.7件','NURO光','エバーグリーン','HTB',
    '目標30件 / 現在18件 / 残り12件',
    '1日平均1.2件','2件の日 × 2日 / 1件の日 × 8日',
    '1件の日 × 5日 / 0件の日 × 5日','目標達成済み'
  ]) assert(actual.includes(content),content);
  assert(!/¥|￥|円|売上|収益|単価|revenue/i.test(actual));
  assert.equal(JSON.stringify(plan),original);
  assert.equal(ctx.formatDailyCountPlanForCopy('1班','2026-10',null),'');
  assert.equal(ctx.formatDailyCountPlanForCopy('1班','2026-10',{rows:[]}), '');
});

test('Copy button writes the prepared text to the clipboard on user click',async()=>{
  const copied=[],success=[],errors=[];
  let clickHandler=null;
  const button={addEventListener:(event,fn)=>{
    assert.equal(event,'click');clickHandler=fn;
  }};
  const fallback={hidden:false};
  const ctx=vm.createContext({
    copyDailyGoalButton:button,dailyGoalCopyText:'1班｜残り10日｜NURO光 1日平均1.2件',
    dailyGoalCopyFallback:fallback,
    navigator:{clipboard:{writeText:async value=>copied.push(value)}},
    showSuccess:message=>success.push(message),
    showError:message=>errors.push(message),
    document:{}
  });
  const start=html.indexOf('copyDailyGoalButton.addEventListener("click"');
  const end=html.indexOf('\n});',start);
  assert(start>=0 && end>start);
  vm.runInContext(html.slice(start,end+4),ctx);
  assert.equal(typeof clickHandler,'function');
  await clickHandler();
  assert.deepEqual(copied,['1班｜残り10日｜NURO光 1日平均1.2件']);
  assert.equal(fallback.hidden,true);
  assert(success[0].includes('コピーしました'));
  assert.equal(errors.length,0);
  ctx.dailyGoalCopyText='';
  await clickHandler();
  assert.equal(copied.length,1);
  assert(errors[0].includes('残り稼働日数'));
});

test('When clipboard is blocked on iPhone, manual copy text is displayed without revenue',async()=>{
  let handler;
  const temporary={
    style:{},value:'',readOnly:false,
    focus:()=>{},select:()=>{},setSelectionRange:()=>{},remove:()=>{}
  };
  const fallback={
    hidden:true,value:'',
    focus:()=>{},select:()=>{},setSelectionRange:()=>{}
  };
  const errors=[];
  const ctx=vm.createContext({
    dailyGoalCopyText:'🎯 目標日割り計算\nNURO光｜残り5件',
    copyDailyGoalButton:{addEventListener:(event,fn)=>handler=fn},
    dailyGoalCopyFallback:fallback,
    navigator:{clipboard:{writeText:async()=>{throw new Error('Denied')}}},
    document:{createElement:()=>temporary,body:{appendChild:()=>{}},execCommand:()=>false},
    showSuccess:()=>{throw Error('Must not claim copy succeeded')},
    showError:message=>errors.push(message)
  });
  const start=html.indexOf('copyDailyGoalButton.addEventListener("click"');
  const end=html.indexOf('\n});',start);
  vm.runInContext(html.slice(start,end+4),ctx);
  await handler();
  assert.equal(fallback.hidden,false);
  assert.equal(fallback.value,ctx.dailyGoalCopyText);
  assert(errors[0].includes('長押し'));
  assert(!/¥|￥|円|売上|収益|単価|revenue/i.test(fallback.value));
});


test('Product ranking uses stable product IDs and sums per UID across historical team transfers',()=>{
  const ctx=context([
    'getRecordResults','currentProductDisplayName',
    'getCurrentMemberName','getCurrentTeamName',
    'recordBelongsToTeam','productRankingRecordMatchesTeam',
    'rankProductMemberCounts','buildProductMemberRanking'
  ],{
    products:[
      {id:'nuro',name:'NURO光',active:true},
      {id:'water',name:'ウォーター',active:true},
      {id:'htb',name:'HTB',active:true}
    ],
    teams:[{id:'a',name:'1班'},{id:'b',name:'2班'}],
    members:[{id:'alice',name:'田中さん',teamId:'b'}, {id:'bob',name:'佐藤さん',teamId:'b'}]
  });
  const records=[
    {id:'r1',date:'2026-10-11',uid:'alice',teamId:'a',teamNameSnapshot:'1班',
      results:{nuro:{productName:'HTB',count:2,revenuePerUnit:100000},water:{productName:'ウォーター',count:1,revenuePerUnit:50000}}},
    {id:'r2',date:'2026-10-12',uid:'alice',teamId:'b',teamNameSnapshot:'2班',
      results:{nuro:{productName:'HTB',count:2,revenuePerUnit:100000}}},
    {id:'r3',date:'2026-10-13',uid:'bob',teamId:'b',teamNameSnapshot:'2班',
      results:{nuro:{productName:'NURO光',count:3,revenuePerUnit:80000},htb:{productName:'HTB',count:1,revenuePerUnit:0}}},
    {id:'r4',date:'2026-10-13',uid:'bob',teamId:'b',teamNameSnapshot:'2班',
      results:{water:{productName:'ウォーター',count:1,revenuePerUnit:0}}}
  ];
  const before=JSON.stringify(records);
  const all=ctx.buildProductMemberRanking(records,'');
  const nuro=all.find(item=>item.key==='id:nuro');
  assert.equal(nuro.name,'NURO光');
  assert.equal(nuro.count,7);
  assert.deepEqual(Array.from(nuro.members,p=>[p.name,p.count,p.rank,p.teamName]),
    [['田中さん',4,1,'複数班で獲得'],['佐藤さん',3,2,'2班']]);
  const water=all.find(item=>item.key==='id:water');
  assert.equal(water.count,2);
  const htb=all.find(item=>item.key==='id:htb');
  assert.equal(htb.count,1);
  assert(!all.some(item=>item.key==='legacy:HTB'));
  assert.equal(ctx.buildProductMemberRanking(records,'a').find(item=>item.key==='id:nuro').count,2);
  assert.equal(ctx.buildProductMemberRanking(records,'b').find(item=>item.key==='id:nuro').count,5);
  assert.deepEqual(Array.from(ctx.buildProductMemberRanking(records,'a').find(item=>item.key==='id:nuro').members,p=>p.name),['田中さん']);
  assert.equal(JSON.stringify(records),before);
  assert(!/revenue|price|¥|￥|単価|売上/i.test(JSON.stringify(all)));
});

test('Product ranking sorts count descending and ties are assigned shared ranks (1,1,3)',()=>{
  const ctx=context(['rankProductMemberCounts']);
  const data=[
    {key:'x1',name:'同名',count:3},
    {key:'x2',name:'同名',count:3},
    {key:'x3',name:'下位',count:1},
    {key:'x4',name:'最高',count:5}
  ];
  const before=JSON.stringify(data);
  const ranked=ctx.rankProductMemberCounts(data);
  assert.deepEqual(Array.from(ranked,x=>[x.key,x.rank]),[['x4',1],['x1',2],['x2',2],['x3',4]]);
  assert.equal(JSON.stringify(data),before);
});

test('Deleted product and no-productId historical records remain separate instead of guessing',()=>{
  const ctx=context([
    'getRecordResults','currentProductDisplayName',
    'getCurrentMemberName','getCurrentTeamName',
    'recordBelongsToTeam','productRankingRecordMatchesTeam',
    'rankProductMemberCounts','buildProductMemberRanking'
  ],{
    products:[{id:'htb',name:'HTB',active:true}],
    teams:[{id:'one',name:'1班'}],members:[]
  });
  const records=[
    {id:'a',uid:'a',date:'2026-10-01',teamId:'one',teamNameSnapshot:'1班',
      results:{htb:{productName:'HTB',count:2,revenuePerUnit:10000}}},
    {id:'b',uid:'b',date:'2026-10-02',teamId:'one',teamNameSnapshot:'1班',
      results:[{productName:'HTB',count:3,revenuePerUnit:40000}]},
    {id:'c',uid:'c',date:'2026-10-03',teamId:'one',teamNameSnapshot:'1班',
      results:{deleted:{productName:'旧商材',count:1,revenuePerUnit:0}}}
  ];
  const result=ctx.buildProductMemberRanking(records,'');
  assert.equal(result.find(item=>item.key==='id:htb').count,2);
  assert.equal(result.find(item=>item.key==='legacy:HTB').count,3);
  assert.equal(result.find(item=>item.key==='id:deleted').count,1);
  assert.equal(result.find(item=>item.key==='id:deleted').name,'旧商材');
});

test('Column controls are independent, persist as local preferences, and do not affect team ranking',()=>{
  const written=[];
  const makeButtons=()=>[1,2,3].map(count=>({
    dataset:{rankingCols:String(count)},attributes:{},
    setAttribute(key,value){this.attributes[key]=value;}
  }));
  const individualButtons=makeButtons(),productButtons=makeButtons();
  const individual={querySelectorAll:()=>individualButtons},product={querySelectorAll:()=>productButtons};
  const individualList={dataset:{}},productList={dataset:{}},productCatalog={dataset:{}};
  const ctx=context([
    'normalizeRankingColumnCount','rankingLayoutStorageKey',
    'updateRankingLayoutControls','setRankingColumns'
  ],{
    individualRankingColumns:1,productRankingColumns:1,
    individualRankingLayout:individual,productRankingLayout:product,
    individualRankingList:individualList,productRankingMemberList:productList,
    productRankingProductList:productCatalog,
    safeLocalStorageSet:(key,value)=>{written.push([key,value]);return true;}
  });
  assert.equal(ctx.normalizeRankingColumnCount(3),3);
  for(const bad of [0,4,'all',-1,2.5,null]) assert.equal(ctx.normalizeRankingColumnCount(bad),1);
  ctx.setRankingColumns('individual',3);
  assert.equal(individualList.dataset.columns,'3');
  assert.equal(productList.dataset.columns,undefined);
  assert.equal(individualButtons[2].attributes['aria-pressed'],'true');
  ctx.setRankingColumns('product',2);
  assert.equal(productList.dataset.columns,'2');
  assert.equal(productCatalog.dataset.columns,'2');
  assert.equal(individualList.dataset.columns,'3');
  assert.equal(productButtons[1].attributes['aria-pressed'],'true');
  assert.deepEqual(written,[
    ['sales-ranking-layout-individual-v1','3'],
    ['sales-ranking-layout-product-v1','2']
  ]);
});

test('Product ranking interface is count-only, manager-gated, and dashboard switches current month',()=>{
  const start=html.indexOf('function buildProductMemberRanking(');
  const end=html.indexOf('/* =====================================================\n   班ランキング',start);
  assert(start>=0 && end>start);
  const code=html.slice(start,end);
  assert(!/formatYen|revenuePerUnit|totalRevenue|\.revenue\b|\.price\b/.test(code));
  assert(html.includes('productRankingToggle.style.display ='));
  assert(html.includes('isCurrentCompanyManager() ? "" : "none"'));
  assert(html.includes('renderProductMemberRanking(monthly)'));
  assert(html.includes('data-columns="1"'));
  assert(html.includes('data-ranking-cols="3"'));
  assert(html.includes('id="productRankingTeamSelect"'));
  assert(html.includes('productRankingTeamSelect.addEventListener("change"'));
});


test('Champion Stage only decorates an existing row and leaves ranking data unchanged', () => {
  const created=[];
  function node() {
    return {
      children:[],
      attributes:{},
      className:"",
      textContent:"",
      classes:[],
      classList:{ add(name){this._owner.classes.push(name);} },
      appendChild(child) { this.children.push(child); },
      setAttribute(key,value){this.attributes[key]=value;}
    };
  }
  const mockDocument={
    createElement(tag){
      const result=node();
      result.tag=tag;
      result.classList._owner=result;
      created.push(result);
      return result;
    }
  };
  const ctx=context(['decorateRankingChampion'],{document:mockDocument});
  for(const [scope,expected] of [
    ['individual','MONTHLY CHAMPION'],
    ['product','PRODUCT CHAMPION']
  ]){
    const card=node();
    card.classList._owner=card;
    const priorData={rank:1,count:12,revenue:999999};
    const snapshot=JSON.stringify(priorData);
    ctx.decorateRankingChampion(card,scope);
    assert(card.classes.includes('ranking-row--champion'));
    assert.equal(card.children.length,1);
    const banner=card.children[0];
    assert.equal(banner.className,'ranking-champion-banner');
    assert.match(banner.children[0].innerHTML,/<svg viewBox="0 0 96 96"/);
    assert.match(banner.children[0].innerHTML,/<path d="M13 30/);
    assert(!banner.children[0].innerHTML.includes('<image'));
    assert.equal(banner.children[0].attributes['aria-hidden'],'true');
    assert.equal(banner.children.length,5);
    assert.deepEqual(banner.children.slice(2).map(node=>node.textContent),['✦','✦','✦']);
    assert(banner.children.slice(2).every(node=>node.attributes['aria-hidden']==='true'));
    assert.equal(banner.children[1].children[0].textContent,expected);
    assert.equal(banner.children[1].children[1].textContent,'今月のチャンピオン');
    assert.equal(JSON.stringify(priorData),snapshot);
    assert(!/¥|￥|円|revenue|price|売上|単価/.test(JSON.stringify(card.children.map(b => b.className))));
  }
});

test('Champion UI is exclusive to rank one and keeps existing 1/2/3-column grid for others', () => {
  const individual=source('renderIndividualRanking');
  const product=source('renderProductMemberRanking');
  const decoration=source('decorateRankingChampion');
  assert(individual.includes('if (index === 0) {\n        decorateRankingChampion(row, "individual");'));
  assert(product.includes('if (person.rank === 1) {\n      decorateRankingChampion(row, "product");'));
  assert(!/setDoc|updateDoc|runTransaction|localStorage|revenuePerUnit|sort\(/.test(decoration));
  const cssStart=html.indexOf('RANKING CHAMPION STAGE');
  const cssEnd=html.indexOf('.ranking-row,\n.summary-row',cssStart);
  assert(cssStart > 0 && cssEnd > cssStart);
  const css=html.slice(cssStart,cssEnd);
  assert(css.includes('grid-column: 1 / -1'));
  assert(css.includes('.ranking-grid[data-columns] > .ranking-row--champion'));
  assert(css.includes('prefers-reduced-motion: reduce'));
  assert(css.includes('ranking-champion-shine'));
  assert(html.includes('data-columns="1"'));
  assert(html.includes('data-ranking-cols="2"'));
  assert(html.includes('data-ranking-cols="3"'));
  assert(!source('renderTeamRanking').includes('decorateRankingChampion'));
});


test('iPhone Champion entrance waits until champion enters viewport and replays on reopening',()=>{
  let observer=null;
  class FakeObserver {
    constructor(cb,options){this.cb=cb;this.options=options;this.observed=[];this.unobserved=[];this.disconnected=false;observer=this;}
    observe(item){this.observed.push(item);}
    unobserve(item){this.unobserved.push(item);}
    disconnect(){this.disconnected=true;}
    visible(item){this.cb([{target:item,isIntersecting:true}]);}
  }
  const classes=new Set();
  const row={
    offsetWidth:330,
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}
  };
  const panel={
    hidden:false,
    querySelectorAll(selector){assert.equal(selector,'.ranking-row--champion');return [row];}
  };
  const ctx=context(['beginRankingChampionEntrance'],{
    window:{matchMedia:()=>({matches:false})},
    IntersectionObserver:FakeObserver,
    rankingChampionObserver:null
  });
  ctx.beginRankingChampionEntrance(panel);
  assert.equal(observer.observed.length,1);
  assert.equal(observer.options.threshold,0.1);
  assert.equal(classes.has('ranking-champion--animate'),false);
  const first=observer;
  observer.visible(row);
  assert.equal(classes.has('ranking-champion--animate'),true);
  assert.deepEqual(observer.unobserved,[row]);

  // 次に開いた時は古い監視を止めてから新規登録する。
  ctx.beginRankingChampionEntrance(panel);
  assert.equal(first.disconnected,true);
  assert.notEqual(observer,first);
  assert.equal(observer.observed.length,1);
});

test('Reduced motion preference suppresses animation and hidden panels cannot animate',()=>{
  const used=[];
  const row={offsetWidth:20,classList:{add:name=>used.push(name),remove:name=>used.push('remove:'+name)}};
  const panel={hidden:false,querySelectorAll:()=>[row]};
  const ctx=context(['beginRankingChampionEntrance'],{
    window:{matchMedia:()=>({matches:true})},
    IntersectionObserver:undefined,
    rankingChampionObserver:null
  });
  ctx.beginRankingChampionEntrance(panel);
  assert.equal(used.length,0);
  ctx.window.matchMedia=()=>({matches:false});
  panel.hidden=true;
  ctx.beginRankingChampionEntrance(panel);
  assert.equal(used.length,0);
  panel.hidden=false;
  ctx.beginRankingChampionEntrance(panel);
  assert.deepEqual(used,['remove:ranking-champion--animate','ranking-champion--animate']);
});

test('Champion Stage animates only on visible ranking openings and remains strictly decorative',()=>{
  const start=html.indexOf('RANKING CHAMPION STAGE');
  const end=html.indexOf('.ranking-row,\n.summary-row',start);
  assert(start>=0 && end>start);
  const css=html.slice(start,end);
  assert(css.includes('ranking-champion--animate'));
  assert(css.includes('@media (prefers-reduced-motion: reduce)'));
  const base=css.slice(css.indexOf('.ranking-grid[data-columns] > .ranking-row--champion {'),css.indexOf('.ranking-grid > .ranking-row--champion::before {'));
  assert(!base.includes('animation: ranking-champion-entrance'));
  const baseShine=css.slice(css.indexOf('.ranking-grid > .ranking-row--champion::after {'),css.indexOf('.ranking-grid .ranking-row--champion > * {'));
  assert(!baseShine.includes('animation: ranking-champion-shine'));
  const menu=source('setupDashboardMenu');
  assert(menu.includes('item.content === individualRankingContent'));
  assert(menu.includes('item.content === productRankingContent'));
  assert(menu.includes('beginRankingChampionEntrance(item.content)'));
  const productRender=source('renderProductMemberRanking');
  assert(productRender.includes('beginRankingChampionEntrance(productRankingContent)'));
  assert(!/setDoc|updateDoc|addDoc|runTransaction|revenuePerUnit|formatYen/.test(source('beginRankingChampionEntrance')));
  assert(!source('renderIndividualRanking').includes('beginRankingChampionEntrance'));
});


test('Premium champion styling is one-shot transform/opacity animation without network imagery or timers',()=>{
  const cssStart=html.indexOf('RANKING CHAMPION STAGE');
  const cssEnd=html.indexOf('.ranking-row,\n.summary-row',cssStart);
  const css=html.slice(cssStart,cssEnd);
  assert(css.includes('ranking-champion-crown-rise'));
  assert(css.includes('ranking-champion-halo'));
  assert(css.includes('ranking-champion-twinkle'));
  assert(css.includes('ranking-champion-shine'));
  assert(css.includes('prefers-reduced-motion: reduce'));
  for(const part of ['.ranking-champion-crown::before', '.ranking-champion-spark--a', '.ranking-champion-spark--b', '.ranking-champion-spark--c']){
    assert(css.includes(part),part);
  }
  const animations=[...css.matchAll(/animation:\s*ranking-champion-[^;]+;/g)].map(match=>match[0]);
  assert(animations.length>=5);
  assert(animations.every(rule=>!/(\binfinite\b|\blinear\b)/i.test(rule)));
  const keyframes=[...css.matchAll(/@keyframes\s+ranking-champion-[\w-]+\s*\{([\s\S]*?)\n\}/g)];
  assert(keyframes.length>=5);
  for(const match of keyframes){
    assert(!/(background-position|box-shadow|filter|height|width|top|left):/i.test(match[1]),match[0].slice(0,120));
    assert(/(opacity|transform):/.test(match[1]));
  }
  const crown=source('decorateRankingChampion');
  assert(crown.includes('svg viewBox="0 0 96 96"'));
  assert(crown.includes('"a", "b", "c"'));
  assert(!/(fetch\(|XMLHttpRequest|setInterval|setTimeout|requestAnimationFrame|setDoc|updateDoc)/.test(crown));
  const sourceAnimate=source('beginRankingChampionEntrance');
  assert(sourceAnimate.includes('prefers-reduced-motion: reduce'));
  assert(sourceAnimate.includes('IntersectionObserver'));
  assert(!sourceAnimate.includes('setInterval'));
});

test('Champion styling does not alter original leader eligibility or non-champion ranks',()=>{
  const individual=source('renderIndividualRanking');
  const product=source('renderProductMemberRanking');
  assert(individual.includes('if (index === 0) {\n        decorateRankingChampion(row, "individual");'));
  assert(product.includes('if (person.rank === 1) {\n      decorateRankingChampion(row, "product");'));
  const helper=source('decorateRankingChampion');
  assert(!/\.count|\.revenue|\.rank\s*=|sort\(|canCurrentUser|Firestore/.test(helper));
});


test('financial screens are denied by default for invited members and leaders',()=>{
  const names=['getEffectiveMasterUid','isCurrentCompanyMaster','isCurrentCompanyOwner',
    'canCurrentUserViewRevenue','canCurrentUserViewUnitPrice','canCurrentUserViewProductRevenue',
    'isMemberMaster','memberRevenuePermissionEnabled','memberUnitPricePermissionEnabled'];
  function actual(role,grants={}){
    const data={role,companyRole:role==='owner'?'owner':'member',...grants};
    const ctx=context(names,{currentUser:{uid:'new-person'},
      currentCompanyData:{ownerUid:'owner',masterUid:'master'},currentUserData:data});
    return [ctx.canCurrentUserViewRevenue(),ctx.canCurrentUserViewProductRevenue(),
      ctx.canCurrentUserViewUnitPrice(),
      ctx.memberRevenuePermissionEnabled({role,companyRole:'member',...grants}),
      ctx.memberUnitPricePermissionEnabled({role,companyRole:'member',...grants})];
  }
  for(const role of ['member','leader']){
    assert.deepEqual(actual(role),[false,false,false,false,false]);
    assert.deepEqual(actual(role,{canViewRevenue:false,canViewUnitPrice:false}),[false,false,false,false,false]);
    assert.deepEqual(actual(role,{canViewRevenue:true,canViewUnitPrice:false}),[true,true,false,true,false]);
    assert.deepEqual(actual(role,{canViewRevenue:false,canViewUnitPrice:true}),[false,false,false,false,false]);
    assert.deepEqual(actual(role,{canViewRevenue:true,canViewUnitPrice:true}),[true,true,true,true,true]);
  }
  assert.deepEqual(actual('owner',{canViewRevenue:false,canViewUnitPrice:false}).slice(0,3),[true,true,true]);
  const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
  assert(rules.includes("request.resource.data.canViewUnitPrice == false"));
  assert(rules.includes("getAfter(memberPath(request.resource.data.companyId, userId)).data.canViewUnitPrice"));
});


test('CB amount is never used as sales revenue: approved unit rate times count only',()=>{
  const ctx=context(['getProductPricingOptions','verifyNewRecordPricing','calculateResultsTotals'],{
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false}),
    normalizeCashbackOptions:values=>[...new Set([0,...(values||[])])].sort((a,b)=>a-b)
  });
  const legacy={id:'legacy',name:'旧CB商材',revenue:10000,cashbackOptions:[0,2000,20000]};
  const options=ctx.getProductPricingOptions(legacy);
  assert.equal(options.find(p=>p.cashback===0).revenuePerUnit,10000);
  assert.equal(options.find(p=>p.cashback===2000).revenuePerUnit,null);
  assert.equal(options.find(p=>p.cashback===20000).revenuePerUnit,null);
  assert.match(ctx.verifyNewRecordPricing({x:{productId:'legacy',cashback:2000,count:5,revenuePerUnit:2000}},[legacy]),/旧形式/);

  const electric={id:'electric',name:'とくする電気',pricingOptions:[{cashback:0,revenuePerUnit:10000}]};
  const nuro={id:'nuro',name:'NURO光',pricingOptions:[
    {cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:22500}]};
  const rows={
    electric:{productId:'electric',cashback:0,count:5,revenuePerUnit:10000},
    nuroBase:{productId:'nuro',cashback:0,count:2,revenuePerUnit:25000},
    nuroCB:{productId:'nuro',cashback:20000,count:3,revenuePerUnit:22500}
  };
  assert.equal(ctx.verifyNewRecordPricing(rows,[electric,nuro]),'');
  assert.equal(ctx.calculateResultsTotals(rows).count,10);
  assert.equal(ctx.calculateResultsTotals(rows).revenue,167500);
  assert.match(ctx.verifyNewRecordPricing({
    a:{productId:'electric',cashback:0,count:5,revenuePerUnit:2000}
  },[electric]),/単価/);
  assert.match(ctx.verifyNewRecordPricing({
    a:{productId:'nuro',cashback:20000,count:1,revenuePerUnit:20000}
  },[nuro]),/単価/);
  const missing={id:'missing',pricingOptions:[{cashback:0,revenuePerUnit:null}]};
  assert.match(ctx.verifyNewRecordPricing({
    a:{productId:'missing',cashback:0,count:1,revenuePerUnit:0}
  },[missing]),/単価/);
});

test('Product editor forbids blank, fractional and duplicate revenue prices',()=>{
  const c=context(['readPricingOptions']);
  const container=rows=>({querySelectorAll:()=>rows.map(([cb,rate])=>({
    querySelector:selector=>({value:selector.includes('pricing-cashback')?cb:rate})
  }))});
  assert.equal(c.readPricingOptions(container([['0','10000']])).options[0].revenuePerUnit,10000);
  for(const rows of [[['20000','']],[['0','']],[['0','100.1']],[['0','9007199254740992']],[['0','2000'],['0','3000']]]){
    assert.notEqual(c.readPricingOptions(container(rows)).error,'');
  }
  assert.equal(c.readPricingOptions(container([['0','0']])).error,'');
});

test('Unverified CB rate displays as missing rather than falsely showing zero yen',()=>{
  const ctx=context(['getProductPricingOptions','pricingOptionsText'],{
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false}),
    normalizeCashbackOptions:values=>[...new Set([0,...(values||[])])].sort((a,b)=>a-b),
    canCurrentUserViewUnitPrice:()=>true,
    formatCashbackPlanLabel:amount=>'CB'+amount,
    formatYen:amount=>'¥'+amount
  });
  const text=ctx.pricingOptionsText({name:'架空',revenue:10000,cashbackOptions:[0,2000]});
  assert.match(text,/CB2000 売上単価未設定/);
  assert(!text.includes('CB2000 ¥2000'));
});

test('Existing unchanged prices are not overwritten; invalid new and changed counts stop saving',()=>{
  const c=context(['getProductPricingOptions','verifyNewRecordPricing','verifyChangedRecordPricing',
    'normalizeExistingResultMap','resultVariantKey','validateFinancialRecordForSave','recordConflict'],{
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false}),
    normalizeCashbackOptions:values=>[...new Set([0,...(values||[])])].sort((a,b)=>a-b)
  });
  const electric={id:'e',pricingOptions:[{cashback:0,revenuePerUnit:10000}]};
  const old={e:{productId:'e',cashback:0,count:5,revenuePerUnit:2000}};
  const untouched=JSON.stringify(old);
  assert.equal(c.verifyChangedRecordPricing(old,old,[electric]),'');
  assert.match(c.verifyChangedRecordPricing({
    e:{productId:'e',cashback:0,count:6,revenuePerUnit:2000}
  },old,[electric]),/単価/);
  // Updating a stale snapshot and its count together would silently overwrite
  // five historical prices; the owner must audit/correct the old price first.
  assert.match(c.verifyChangedRecordPricing({
    e:{productId:'e',cashback:0,count:6,revenuePerUnit:10000}
  },old,[electric]),/金額訂正/);
  assert.equal(c.verifyChangedRecordPricing({
    e:{productId:'e',cashback:0,count:6,revenuePerUnit:10000}
  },{e:{productId:'e',cashback:0,count:5,revenuePerUnit:10000}},[electric]),'');
  assert.equal(JSON.stringify(old),untouched);
  assert.equal(c.validateFinancialRecordForSave({
    results:{e:{productId:'e',cashback:0,count:5,revenuePerUnit:10000}},
    totalCount:5,totalRevenue:50000
  }),true);
  assert.throws(()=>c.validateFinancialRecordForSave({
    results:{e:{productId:'e',cashback:0,count:5,revenuePerUnit:2000}},
    totalCount:5,totalRevenue:50000
  }),/合計/);
  assert.throws(()=>c.validateFinancialRecordForSave({
    results:{e:{productId:'e',cashback:0,count:5,revenuePerUnit:null}},
    totalCount:5,totalRevenue:0
  }),/未設定/);
});


test('Historical displayed sales use latest electric and Evergreen prices without changing records',()=>{
  const catalog=[
    {id:'tok',name:'とくする電気',pricingOptions:[{cashback:0,revenuePerUnit:10000}]},
    {id:'ever',name:'エバーグリーン',pricingOptions:[{cashback:0,revenuePerUnit:20000}]}
  ];
  const ctx=context(['getProductPricingOptions','getRecordResults',
    'currentProductDisplayName','currentCatalogRevenueUnitForDisplay','getDisplayRecordResults'],{
    products:catalog,
    canCurrentUserViewRevenueForRecord:()=>true,
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false}),
    normalizeCashbackOptions:()=>[0]
  });
  const oldElectric={id:'r1',uid:'u',teamId:'a',date:'2026-10-22',
    results:{tok:{productId:'tok',count:5,cashback:0,revenuePerUnit:2000}},
    totalCount:5,totalRevenue:10000};
  const oldEvergreen={id:'r2',uid:'u',teamId:'a',date:'2026-10-22',
    results:{ever:{productId:'ever',count:5,cashback:0,revenuePerUnit:16000}},
    totalCount:5,totalRevenue:80000};
  const before=JSON.stringify([oldElectric,oldEvergreen]);
  const el=ctx.getDisplayRecordResults(oldElectric);
  const ev=ctx.getDisplayRecordResults(oldEvergreen);
  assert.equal(el[0].count*el[0].revenuePerUnit,50000);
  assert.equal(ev[0].count*ev[0].revenuePerUnit,100000);
  assert.equal(JSON.stringify([oldElectric,oldEvergreen]),before,
    'Firestore source values, team, member and original price must not change');
  ctx.products=[{...catalog[0],pricingOptions:[{cashback:0,revenuePerUnit:11000}]},catalog[1]];
  assert.equal(ctx.getDisplayRecordResults(oldElectric)[0].revenuePerUnit,11000,
    'new master price must be reflected without any record writes');
  ctx.canCurrentUserViewRevenueForRecord=()=>false;
  assert.equal(ctx.getDisplayRecordResults(oldElectric)[0].revenuePerUnit,0,
    'revenue permission remains enforced');
});

test('NURO cashback tiers are priced by current CB-specific revenue rate, never cashback value',()=>{
  const catalog=[{id:'nuro',name:'NURO光',pricingOptions:[
    {cashback:0,revenuePerUnit:25000},
    {cashback:20000,revenuePerUnit:22500}
  ]}];
  const ctx=context(['getProductPricingOptions','getRecordResults',
    'currentProductDisplayName','currentCatalogRevenueUnitForDisplay','getDisplayRecordResults'],{
    products:catalog,
    canCurrentUserViewRevenueForRecord:()=>true,
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false}),
    normalizeCashbackOptions:()=>[0,20000]
  });
  const record={id:'r3',uid:'u',teamId:'a',date:'2026-10-22',results:{
    cb0:{productId:'nuro',cashback:0,count:2,revenuePerUnit:0},
    cb20k:{productId:'nuro',cashback:20000,count:3,revenuePerUnit:20000},
    unknown:{productId:'nuro',count:1,revenuePerUnit:15000},
    noMatch:{productId:'nuro',cashback:30000,count:1,revenuePerUnit:13000}
  }};
  const before=JSON.stringify(record);
  const rows=ctx.getDisplayRecordResults(record);
  assert.equal(rows[0].revenuePerUnit,25000);
  assert.equal(rows[1].revenuePerUnit,22500);
  assert.equal(rows[2].revenuePerUnit,15000,'unknown CB must not be guessed');
  assert.equal(rows[3].revenuePerUnit,13000,'unknown plan must not be guessed');
  assert.equal(JSON.stringify(record),before);
  // A pre-pricingOptions catalog with only legacy CB amounts cannot infer earnings.
  ctx.products=[{id:'nuro',name:'NURO光',revenue:25000,cashbackOptions:[0,20000]}];
  assert.equal(ctx.getDisplayRecordResults(record)[1].revenuePerUnit,20000);
});

test('Repricing a product refreshes dashboard without replacing the input draft',()=>{
  const htmlSource=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const listenerStart=htmlSource.indexOf('unsubscribeProducts =',htmlSource.indexOf('function startRealtimeListeners('));
  const listenerEnd=htmlSource.indexOf('/*\n    実績',listenerStart);
  assert(listenerStart>0 && listenerEnd>listenerStart);
  const listener=htmlSource.slice(listenerStart,listenerEnd);
  assert.match(listener,/prepareProductInputList\(\s*draftResults\s*\);[\s\S]*renderDashboard\(\)/);
  assert(!/updateDoc\s*\(|setDoc\s*\(|deleteDoc\s*\(/.test(listener));
});
