const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
const start=html.indexOf('function mountPartnerCanonicalNavigation(){');
const source=html.slice(start,html.indexOf('function renderPartnerCountOnlyExtras(){',start));

test('repeated partner layout mounting retains the same form, draft and detail nodes',()=>{
 const nodes=new Map(),cards=[];
 const record={hidden:true,value:'3',onclick:()=>{},nextElementSibling:null};
 const details={parentNode:null},dashboard={before(node){assert.equal(node,record);record.nextElementSibling=this;}};
 const target={replaceChildren(...next){cards.splice(0,cards.length,...next);if(details.parentNode===this){nodes.delete('partnerSameAppDashboardDetails');details.parentNode=null;}},
  append(node){assert.equal(node,details);node.parentNode=this;nodes.set('partnerSameAppDashboardDetails',node);}};
 const workspace={},userBar={nextElementSibling:null,after(node){this.nextElementSibling=node;}};
 for(const [id,node] of Object.entries({partnerPanelRecord:record,partnerSameAppDashboardDetails:details,
  partnerDashboard:dashboard,partnerSameAppNavigation:target,partnerInlineWorkspace:workspace}))nodes.set(id,node);
 const makeCard=()=>{const children=new Map();return {dataset:{},removeAttribute(){},setAttribute(){},
  querySelectorAll:()=>[],querySelector(selector){if(!children.has(selector))children.set(selector,{});return children.get(selector);}};};
 const original={querySelector:()=>({cloneNode:makeCard})};
 const ctx={pInline:id=>nodes.get(id),document:{querySelector:()=>original},appScreen:{querySelector:()=>userBar}};
 vm.runInNewContext(source+';this.mount=mountPartnerCanonicalNavigation;',ctx);
 const handler=record.onclick;
 assert.equal(ctx.mount(),true);assert.equal(ctx.mount(),true);
 assert.equal(nodes.get('partnerPanelRecord'),record);
 assert.equal(nodes.get('partnerSameAppDashboardDetails'),details);
 assert.equal(record.value,'3');assert.equal(record.onclick,handler);
 assert.equal(record.hidden,false);assert.equal(record.nextElementSibling,dashboard);
 assert.equal(userBar.nextElementSibling,workspace);
 assert.equal(cards.length,11);
 assert.deepEqual(cards.map(c=>c.dataset.partnerPanel),
  ['analysis','individual','product','team','chart','detail','products','report','goal','daily','history']);
 assert.doesNotMatch(source,/getDocs\(|onSnapshot\(|collection\(|setDoc\(|updateDoc\(/);
});

test('partner form shares internal card and total classes without adding finance fields',()=>{
 const a=html.indexOf('<section id="partnerPanelRecord"'),b=html.indexOf('<section id="partnerPanelRankings"',a);
 const form=html.slice(a,b);
 for(const style of ['record-card','record-title','record-description','record-grid','product-input-list','record-total','record-total-label','record-total-value','record-save-button','record-clear-button'])
  assert.ok(form.includes('class="'+style+'"'),style);
 assert.doesNotMatch(form,/totalRevenue|revenuePerUnit|unitPrice|recordTotalRevenue|合計売上/);
 assert.match(html,/id="partnerDashboard" class="dashboard-card"/);
 assert.match(html,/id="recordTotalRevenue"/,'original internal revenue remains');
});
