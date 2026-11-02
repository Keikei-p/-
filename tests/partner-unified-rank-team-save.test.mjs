import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const original=html.slice(html.indexOf('function renderSharedCountTeamDetails('),
  html.indexOf('async function loadSharedDailyStandings('));

test('partner dashboard hides duplicate partner-only ranks and management shortcuts, not the canonical safe menu',()=>{
  assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerManagementTabs,/);
  assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerPanelRankings>\.p-inline-card:first-child/);
  assert.match(html,/function mountPartnerSafeManagementMenu\(\)/);
  assert.match(html,/\["✉️","招待リンク","invite"\]/);
  assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerSameAppNavigation>\[data-partner-panel="members"\]/);
  assert.match(html,/const chosen=partner\?partnerSameAppSelectedPanel:"all"/);
  assert.match(html,/chosen==="all"\|\|chosen==="individual"/);
  assert.match(html,/chosen==="all"\|\|chosen==="product"/);
  assert.match(html,/chosen==="all"\|\|chosen==="team"/);
  assert.match(html,/void loadSharedDailyStandings\("partner"\)/);
  assert.doesNotMatch(html,/renderPartnerRankingOnlyPanel\(\);\s*void loadSharedDailyStandings\("partner"\)/);
});
test('team accordion: one tap on a team reveals member and product counts with no company/person accordion',()=>{
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.className='';}
    append(...xs){this.children.push(...xs);}
    replaceChildren(...xs){this.children=[...xs];}
  }
  const document={createElement:tag=>new Node(tag)};
  const partnerMainAppendRow=(parent,name,count)=>{const n=new Node('row');n.textContent=name+':'+count;parent.append(n);};
  const ctx={document,partnerMainAppendRow,Error};
  const fn=vm.runInNewContext(original+';renderSharedCountTeamDetails',ctx);
  const root=new Node('root');
  const report={
    categories:['NURO','ウォーター'],
    direct:{totalCount:2,peopleVerified:true,teams:[{key:'t1',name:'直営1班',totalCount:2}],
      people:[{name:'山田',teamKey:'t1',totalCount:2,counts:{NURO:1,'ウォーター':1}}]},
    companies:[{id:'p1',name:'協力店A',totalCount:3,peopleVerified:true}],
    teams:[{companyId:'p1',key:'p1t1',name:'協力店A1班',totalCount:3}],
    people:[{companyId:'p1',teamKey:'p1t1',name:'佐藤',totalCount:3,counts:{NURO:2,'ウォーター':1}}],
    missingCompanies:[]
  };
  fn(root,report);
  assert.equal(root.children.length,2);
  assert.ok(root.children.every(group=>group.tag==='section'));
  for(const section of root.children){
    assert.equal(section.children[1].tag,'details');
    assert.equal(section.children[1].children[0].tag,'summary');
    assert.equal(section.children[1].children[1].tag,'div');
    assert.equal(section.children[1].children[1].children[0].tag,'strong');
    assert.ok(section.children[1].children[1].children.some(x=>x.tag==='row'));
  }
  const partner=root.children[1].children[1].children[1];
  assert.equal(partner.children[0].textContent,'👤 佐藤｜3件');
  assert.equal(partner.children[1].textContent,'NURO:2件');
  assert.equal(partner.children[2].textContent,'ウォーター:1件');
  assert.doesNotMatch(JSON.stringify(root),/売上|単価|Revenue|Price/);
});
test('save failures are distinguished without erasing drafts or authorizing retry of uncertain writes',()=>{
  for(const category of ['functions/permission-denied','functions/failed-precondition',
   'functions/unauthenticated','functions/invalid-argument','functions/data-loss',
   'functions/resource-exhausted'])
    assert.ok(html.includes('code==="'+category+'"'),category);
  assert.match(html,/上書きせず、二重登録もしないで「更新」で履歴を確認/);
  assert.match(html,/入力内容は保持しています/);
  assert.match(html,/if\(completed\)\{[\s\S]{0,500}partnerInlineRenderCounts\(\)/);
  assert.match(html,/console\.warn\("partner_workspace_operation_error",code\|\|"unclassified"\)/);
  assert.doesNotMatch(html,/console\.warn\("partner_workspace_operation_error",error\?\.message/);
});
