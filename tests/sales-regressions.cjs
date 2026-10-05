const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const html = fs.readFileSync(process.env.SALES_HTML || path.join(__dirname, '../index.html'), 'utf8');
function source(name) {
  const start = html.indexOf(`function ${name}(`);
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
    document, recordMember: select, recordDate: {value:'2026-10-05'}, editingRecordId:'r',
    records:[{id:'r',uid:'other',date:'2026-10-05',companyId:'c',memberNameSnapshot:'過去の担当者'}],
    currentUser:{uid:'self'}, currentUserData:{uid:'self',companyId:'c',name:'自分'}, members:[],
    isCurrentCompanyOwner:()=>false,isCurrentTeamLeader:()=>false
  });
  ctx.updateRecordMemberOptions();
  assert.equal(select.value,'other');
  assert(select.options.some(o=>o.value==='other'));
  ctx.records[0].companyId='another-company';
  ctx.updateRecordMemberOptions();
  assert.equal(select.value,'self');
  assert(!select.options.some(o=>o.value==='other'));
});

test('Deleted historical team remains selectable without changing membership history', () => {
  const select=element();
  const ctx=context(['showRecordCorrectionTeam'],{document,recordCorrectionTeam:select,
    recordCorrectionTeamGroup:element(),teams:[{id:'new',name:'新班'}]});
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
    companyCollectionQuery:n=>n,recordsCollectionQuery:()=> 'records',
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
    escapeHtml:s=>s,formatYen:v=>`¥${v}`,canCurrentUserViewRevenueForTeam:()=>false});
  const container=element();ctx.renderSelectedTeamMemberDetail(container,{id:'other',name:'他班'},[]);
  assert(textOf(container).includes('売上非表示'));assert(!textOf(container).includes('¥0'));
  ctx.canCurrentUserViewRevenueForTeam=()=>true;
  const own=element();ctx.renderSelectedTeamMemberDetail(own,{id:'own',name:'自班'},[]);
  assert(textOf(own).includes('¥0'));
});

test('Correction replaces result map across normal and compatibility saves, preserving metadata', async () => {
  const start=html.indexOf('      try {\n\n        await setDoc(\n          recordRef,\n          data,');
  const end=html.indexOf('      let correctionAuditWarning',start);
  assert(start>0&&end>start);
  const block=html.slice(start,end);
  for(const failures of [0,1,2]) for(const results of [{A:{count:1,revenuePerUnit:100}},{C:{count:4,revenuePerUnit:300}},{}]) {
    let stored={createdAt:'keep',createdByUid:'creator',custom:'keep',results:{A:{count:3},B:{count:2}}},calls=0;
    const data={results,totalCount:Object.values(results).reduce((s,r)=>s+r.count,0),reportStatus:'submitted',reportedAt:'now',updatedByUid:'editor'};
    const ctx=context(['getRecordResults','calculateResultsTotals'],{data,recordRef:{id:'r'},existingDailyRecord:{},member:{},isManagedMember:()=>false,
      setDoc:async(ref,payload,options)=>{if(++calls<=failures)throw {code:'permission-denied'};
        assert(options.mergeFields.includes('results'));
        for(const key of options.mergeFields)stored[key]=structuredClone(payload[key]);}
    });
    await vm.runInContext('(async()=>{'+block+'})()',ctx);
    assert.deepEqual(stored.results,results);assert.equal(stored.createdAt,'keep');assert.equal(stored.createdByUid,'creator');assert.equal(stored.custom,'keep');
    const totals=ctx.calculateResultsTotals(ctx.getRecordResults(stored));
    assert.equal(totals.count,data.totalCount);
    assert.equal(totals.revenue,Object.values(results).reduce((s,r)=>s+r.count*r.revenuePerUnit,0));
  }
});
