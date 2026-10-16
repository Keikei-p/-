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
    const data={results,totalCount:Object.values(results).reduce((n,r)=>n+r.count,0)};
    const ctx=context(['persistDailyRecord','recordRevision','recordConflict','getRecordResults','calculateResultsTotals'],{
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
  const ctx=context(['persistDailyRecord','recordRevision','recordConflict'],{db:{},query:()=>{},where:()=>{},recordsCollectionQuery:()=>{},
    getDocsFromServer:async()=>({size:0,docs:[]}),
    runTransaction:async(db,callback)=>callback({get:async()=>({exists:()=>!!current,id:'r',data:()=>current}),set:()=>writes++})});
  await assert.rejects(ctx.persistDailyRecord({id:'r'},{},null,null),{code:'record-conflict'});
  const rev=ctx.recordRevision(initial);current.results.A.count=2;
  await assert.rejects(ctx.persistDailyRecord({id:'r'},{},initial,rev),{code:'record-conflict'});
  current=null;await assert.rejects(ctx.persistDailyRecord({id:'r'},{},initial,rev),{code:'record-conflict'});
  ctx.getDocsFromServer=async()=>({size:2,docs:[{id:'r'},{id:'legacy'}]});
  await assert.rejects(ctx.persistDailyRecord({id:'r'},{},null,null),{code:'record-conflict'});
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
  const ctx=context(['getRecordResults','currentProductDisplayName','getDisplayRecordResults'],{
    products:[
      {id:'evergreen',name:'エバーグリーン',revenue:20000},
      {id:'htb',name:'HTB',revenue:0}
    ],
    canCurrentUserViewRevenueForRecord:()=>true
  });
  const first=Array.from(ctx.getDisplayRecordResults(sourceRecords[0]));
  assert.equal(first[0].productName,'エバーグリーン');
  assert.equal(first[1].productName,'HTB');
  assert.equal(first[0].count,2);
  assert.equal(first[0].revenuePerUnit,10000);
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
