import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');

test('a single tap on team reveals member product counts, no extra company or member expansion',()=>{
 const from=html.indexOf('function renderSharedCountTeamDetails(');
 const to=html.indexOf('async function loadSharedDailyStandings(',from);
 assert.ok(from>0&&to>from);
 const source=html.slice(from,to);
 class Element{
  constructor(tag){this.tag=tag;this.textContent='';this.className='';this.children=[];}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
 }
 const document={createElement:tag=>new Element(tag)};
 const addRow=(node,label,count)=>{const row=new Element('row');row.textContent=label+' '+count;node.append(row);};
 const fn=vm.runInNewContext(source+';renderSharedCountTeamDetails',{document,partnerMainAppendRow:addRow,Error});
 const root=new Element('root');
 fn(root,{categories:['NURO','ウォーター'],
  direct:{totalCount:1,peopleVerified:true,
   teams:[{key:'d1',name:'1班',totalCount:1}],
   people:[{teamKey:'d1',name:'田中',totalCount:1,counts:{NURO:1,'ウォーター':0}}]},
  companies:[{id:'partner',name:'協力店A',totalCount:3,peopleVerified:true}],
  teams:[{companyId:'partner',key:'t1',name:'協力店A1班',totalCount:3}],
  people:[{companyId:'partner',teamKey:'t1',name:'佐藤',totalCount:3,counts:{NURO:2,'ウォーター':1}}],
  missingCompanies:[]});
 assert.equal(root.children.length,2);
 assert.ok(root.children.every(x=>x.tag==='section'));
 const team=root.children[1].children[1];
 assert.equal(team.tag,'details');
 assert.equal(team.children[0].tag,'summary');
 assert.match(team.children[0].textContent,/協力店A1班/);
 const person=team.children[1];
 assert.equal(person.tag,'div');
 assert.equal(person.children[0].tag,'strong');
 assert.equal(person.children[0].textContent,'👤 佐藤｜3件');
 assert.equal(person.children[1].textContent,'NURO 2件');
 assert.equal(person.children[2].textContent,'ウォーター 1件');
 assert.doesNotMatch(JSON.stringify(root),/売上|単価|¥/);
});

test('do not change deployed ranking, owner finance, invite or save error boundaries',()=>{
 assert.match(html,/function partnerCountSaveFailureMessage\(error\)/);
 assert.match(html,/arguments\[1\]\?\.kind==="save"\?partnerCountSaveFailureMessage\(error\)/);
 assert.match(html,/partnerSameAppSelectPanel\(action\)/);
 assert.match(html,/loadSharedDailyStandings\("partner"/);
 assert.match(html,/signInWithEmailAndPassword/);
 assert.match(html,/monthlyRevenue/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerManagementTabs\{display:none!important\}/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerPanelDetail>\.p-inline-card:first-child\{display:none!important\}/);
});
