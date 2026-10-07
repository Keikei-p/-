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
