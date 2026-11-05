"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8").replace(/\r\n/g,"\n");
const start=source.indexOf("function makeCanonicalCountRankRow(");
const end=source.indexOf("// Same company -> team -> person -> product tree",start);
const segment=source.slice(start,end);
function dom(){
 const create=tag=>{
  const e={tag,className:"",textContent:"",children:[],dataset:{},
   classes:[],classList:{add(cls){e.classes.push(cls);}},
   append(...nodes){for(const x of nodes){
    if(x.tag==="fragment")e.children.push(...x.children);
    else e.children.push(x);
   }},
   replaceChildren(...nodes){e.children.length=0;e.append(...nodes)}
  };return e;
 };
 const doc={createElement:create,createDocumentFragment:()=>create("fragment")};
 const sandbox={document:doc};vm.runInNewContext(segment+
  "\nthis.make=makeCanonicalCountRankRow;this.render=renderCanonicalCountRankRows;"+
  "\nthis.appendShared=appendSharedRankingRows;",sandbox);
 return {create,...sandbox};
}
function resultRows(el){const hits=[];const walk=e=>{
 if(e.className==="ranking-row")hits.push(e);
 for(const x of e.children||[])walk(x);
 };walk(el);return hits;}
function textOf(node){return [node.textContent,...(node.children||[]).map(textOf)].join(" ");}
test("same HQ/partner markup ranks counts only, correctly handles ties and provisional labels",()=>{
 const {create,render,appendShared}=dom();
 const records=[{name:"🤝 協力店・佐藤",count:3},{name:"🏢 直営・山田",count:5},
  {name:"🤝 協力店・田中",count:5}];
 const owner=create("div"),partner=create("div");
 assert.equal(render(owner,records,true),3);
 appendShared(partner,"🏆 個人ランキング",records,true,true);
 assert.equal(resultRows(partner).length,3);
 assert.deepEqual(resultRows(owner).map(x=>x.className),resultRows(partner).map(x=>x.className));
 const rows=resultRows(partner);
 assert.deepEqual(rows.map(r=>r.children[0].children[0].textContent),["1位","1位","3位"]);
 assert.deepEqual(rows.map(r=>r.children[1].children[0].textContent),["5件","5件","3件"]);
 assert.deepEqual(rows.map(r=>r.children[0].children[0].classes),[["top1"],["top1"],["top3"]]);
 assert.equal(partner.children[0].className,"ranking-grid");
 assert.equal(partner.children.length,1,"original partner tab must not get a duplicate card");
 for(const word of ["totalRevenue","unitPrice","revenuePerUnit","¥","50000"])
  assert(!textOf(partner).includes(word));
 const provisional=create("div");render(provisional,records,false);
 assert.deepEqual(resultRows(provisional).map(r=>r.children[0].children[0].textContent),
  ["暫定1位","暫定1位","暫定3位"]);
 assert(resultRows(provisional).every(r=>!r.children[0].children[0].classes.length));
});
test("unverified quantities or malformed people never render partial rankings",()=>{
 const {create,render}=dom();
 for(const rows of [[{name:"許可",count:1},{name:"不明",count:null}],
  [{name:"許可",count:1},{name:"欠落"}],
  [{name:"許可",count:1},{name:"小数",count:1.5}],
  [{name:"許可",count:1},{name:"負数",count:-1}],
  [{name:"許可",count:1},{name:"文字列",count:"2"}]]){
  const target=create("div");
  assert.throws(()=>render(target,rows,false),/canonical_count_rank_invalid/);
  assert.equal(target.children.length,0,"must fail without displaying partial ranks");
 }
 const empty=create("div");render(empty,[],false);
 assert.match(textOf(empty),/未報告を0件とは扱いません/);
});
test("no HTML parsing of a hostile name, no owner revenue mode changes and no hidden local partner rank",()=>{
 const {create,render}=dom();
 const target=create("div");
 render(target,[{name:'<img src=x onerror=alert(1)>',count:1}],false);
 assert.equal(resultRows(target)[0].children[0].children[1].textContent,
  '<img src=x onerror=alert(1)>');
 assert.equal(target.children[0].tag,"div");
 const owner=source.slice(source.indexOf("function renderOwnerJointIndividualRanking(){"),
  source.indexOf("function renderIndividualRanking("));
 assert.match(owner,/renderCanonicalCountRankRows/);
 const original=source.slice(source.indexOf("function renderIndividualRanking("),
  source.indexOf("function renderIndividualRanking(",source.indexOf("function renderIndividualRanking(")+10)>0?
  source.indexOf("function renderIndividualRanking(",source.indexOf("function renderIndividualRanking(")+10):
  source.indexOf("function renderProductMemberRanking("));
 assert.match(original,/canCurrentUserViewRevenue\(\)/);
 assert.match(source,/appendSharedRankingRows\(content,heading,items,complete,true\)/);
 assert.match(source,/appendSharedRankingRows\(content,headings\[selected\],rows\[selected\],false,true\)/);
 assert.match(source,/renderPartnerSharedGroupCards\(content,response\)/);
 assert.match(source,/className="ranking-product-card"/);
 const originalPartner=source.slice(source.indexOf('<section id="partnerPanelRankings"'),
  source.indexOf('<section id="partnerPanelDetail"'));
 assert.equal((originalPartner.match(/id="partnerSharedRankingContent"/g)||[]).length,1);
 assert(!originalPartner.includes('totalRevenue'));
 assert(!segment.includes("getDocs(")&&!segment.includes("setDoc("));
});


function monthlyRankingFixture(){
 const start=source.indexOf('const ownerMonthlyRankCache=new Map();');
 const end=source.indexOf('const ownerJointIndividualDate=',start);
 const partnerStart=source.indexOf('async function loadPartnerMonthlySharedRankings(force=false){',end);
 const partnerEnd=source.indexOf('const partnerSharedRankingsMonth=pInline(',partnerStart);
 assert(start>=0&&end>start&&partnerStart>end&&partnerEnd>partnerStart);
 const pending=[],rendered=[],nodes={};
 for(const [name,value] of [
  ['ownerJointIndividualMonth','2026-11'],['ownerJointProductMonth','2026-11'],
  ['ownerJointIndividualStatus',''],['ownerJointProductStatus',''],
  ['partnerSharedRankingsMonth','2026-11'],
  ['partnerSharedRankingsStatus',''],['partnerSharedRankingContent','']
 ])nodes[name]={value,textContent:value,replaceChildren(){this.cleared=true}};
 nodes.partnerSharedRankingsSection={querySelector:()=>({textContent:''})};
 const state={uid:'owner',companyId:'direct',workspace:'partnerOne'};
 const ctx={
  Map,Date,auth:{currentUser:{uid:state.uid}},
  currentUserData:{companyId:state.companyId},
  getTodayString:()=> '2026-11-05',
  document:{getElementById:id=>nodes[id]},
  pInline:id=>nodes[id],
  partnerInlineWorkspaceCompany:state.workspace,
  PARTNER_QUICK_RANK_KEYS:['NURO','SBMNP'],
  partnerSameAppSelectedPanel:'individual',
  canReadSharedCountOnlyRanks:()=>true,
  renderOwnerJointIndividualRanking:()=>rendered.push('Individual'),
  renderOwnerJointProductRanking:()=>rendered.push('Product'),
  appendSharedRankingRows:()=>rendered.push('partner'),
  readPartnerMonthlySharedCounts:payload=>new Promise(resolve=>pending.push({payload,resolve})),
  console:{error(){}}
 };
 const prefix='let sharedDailyRankingGeneration=0;const sharedDailyRequestSequences=new Map();'+
  'const sharedDailyRankCache=new Map();'+
  'let ownerJointIndividualMode=true,ownerJointProductMode=true;'+
  'let ownerJointIndividualSnapshot=null,ownerJointProductSnapshot=null;'+
  'let ownerJointProductDateKey="";let partnerSharedRankPeriod="month";';
 vm.runInNewContext(prefix+source.slice(start,end)+source.slice(partnerStart,partnerEnd)+
  '\nownerJointIndividualPeriod="month";ownerJointProductPeriod="month";'+
  '\nthis.owner=loadOwnerMonthlySharedRanks;this.partner=loadPartnerMonthlySharedRankings;'+
  '\nthis.switchCard=(card)=>nextSharedMonthlyRequest(card);'+
  '\nthis.invalidateVerifiedCounts=()=>invalidateSharedRankingReadCaches();'+
  '\nthis.rankingCache=ownerMonthlyRankCache;this.dailyCache=sharedDailyRankCache;'+
  '\nthis.switchPartnerDay=()=>{nextSharedMonthlyRequest("partner");partnerSharedRankPeriod="day"};'+
  '\nthis.invalidateSession=()=>{++sharedDailyRankingGeneration};',ctx);
 const ownerReply=()=>({scope:'shared_monthly_counts_only',role:'hub',
  month:'2026-11',complete:false,people:[{companyName:'協力店',name:'担当A',totalCount:3}],
  companies:[],direct:{people:[{name:'担当B',totalCount:2}]},
  groupStandings:[],recordsVerified:1,partnerRowsVerified:1});
 const partnerReply=()=>({scope:'shared_monthly_counts_only',role:'partner',
  month:'2026-11',complete:false,people:[],teams:[],companies:[],
  categories:['NURO','SBMNP'],productCounts:{NURO:0,SBMNP:0},
  additionalTotalCount:0,direct:{people:[],teams:[],counts:{NURO:0,SBMNP:0},
   otherCount:0},groupStatus:'unverified'});
 return {ctx,state,nodes,rendered,pending,ownerReply,partnerReply,
  resolve(index,reply){pending[index].resolve({data:reply});}};
}
test('the original HQ individual and product monthly ranking cards complete independently',async()=>{
 const f=monthlyRankingFixture();
 const individual=f.ctx.owner('Individual');
 const product=f.ctx.owner('Product');
 assert.equal(f.pending.length,2);
 f.resolve(1,f.ownerReply());await product;
 f.resolve(0,f.ownerReply());await individual;
 assert.deepEqual(f.rendered,['Product','Individual']);
});
test('monthly rankings ignore stale responses for same card but not the other card',async()=>{
 const f=monthlyRankingFixture();
 const old=f.ctx.owner('Individual');
 const latest=f.ctx.owner('Individual');
 const product=f.ctx.owner('Product');
 f.resolve(1,f.ownerReply());await latest;
 f.resolve(2,f.ownerReply());await product;
 f.resolve(0,f.ownerReply());await old;
 assert.deepEqual(f.rendered,['Individual','Product']);
});
test('partner monthly and HQ monthly may resolve together, without cancelling either',async()=>{
 const f=monthlyRankingFixture();
 const owner=f.ctx.owner('Product');
 const partner=f.ctx.partner();
 f.resolve(1,f.partnerReply());await partner;
 f.resolve(0,f.ownerReply());await owner;
 assert.deepEqual(f.rendered,['partner','Product']);
});
test('card switch, company/workspace change and logout invalidate only relevant monthly results',async()=>{
 {
  const f=monthlyRankingFixture();
  const individual=f.ctx.owner('Individual'),product=f.ctx.owner('Product');
  f.ctx.switchCard('Individual');
  f.resolve(0,f.ownerReply());await individual;
  f.resolve(1,f.ownerReply());await product;
  assert.deepEqual(f.rendered,['Product']);
 }
 {
  const f=monthlyRankingFixture();
  const partner=f.ctx.partner(),owner=f.ctx.owner('Individual');
  f.ctx.switchPartnerDay();
  f.resolve(0,f.partnerReply());await partner;
  f.resolve(1,f.ownerReply());await owner;
  assert.deepEqual(f.rendered,['Individual']);
 }
 {
  const f=monthlyRankingFixture();
  const owner=f.ctx.owner('Individual'),partner=f.ctx.partner();
  f.ctx.currentUserData.companyId='differentCompany';
  f.ctx.partnerInlineWorkspaceCompany='differentWorkspace';
  f.resolve(0,f.ownerReply());await owner;
  f.resolve(1,f.partnerReply());await partner;
  assert.deepEqual(f.rendered,[]);
 }
 {
  const f=monthlyRankingFixture();
  const owner=f.ctx.owner('Individual'),partner=f.ctx.partner();
  f.ctx.invalidateSession();
  f.resolve(0,f.ownerReply());await owner;
  f.resolve(1,f.partnerReply());await partner;
  assert.deepEqual(f.rendered,[]);
 }
});


test('verified saved counts clear BOTH ranking caches and prevent pre-save month replay',async()=>{
 const f=monthlyRankingFixture();
 // Simulate a stale user-visible leaderboard already cached.
 f.ctx.rankingCache.set('owner|direct|2026-11',
  {checkedAt:Date.now(),value:f.ownerReply()});
 f.ctx.dailyCache.set('owner|direct|2026-11-05',
  {checkedAt:Date.now(),value:{totalCount:1}});
 const preSave=f.ctx.owner('Product',true);
 assert.equal(f.pending.length,1);
 f.ctx.invalidateVerifiedCounts();
 assert.equal(f.ctx.rankingCache.size,0);
 assert.equal(f.ctx.dailyCache.size,0);
 f.resolve(0,f.ownerReply());await preSave;
 assert.deepEqual(f.rendered,[],'a response started before the write may not return to UI');
 const afterSave=f.ctx.owner('Product');
 assert.equal(f.pending.length,2,'post-save query must re-read from server');
 f.resolve(1,f.ownerReply());await afterSave;
 assert.deepEqual(f.rendered,['Product']);
});
test('manual monthly refresh ignores the 3-minute cached result for both roles',async()=>{
 const f=monthlyRankingFixture();
 const old=f.ctx.owner('Individual');
 f.resolve(0,f.ownerReply());await old;
 assert.equal(f.ctx.rankingCache.size,1);
 await f.ctx.owner('Individual');
 assert.equal(f.pending.length,1,'ordinary immediate repeat may reuse verified cache');
 const refresh=f.ctx.owner('Individual',true);
 assert.equal(f.pending.length,2,'explicit refresh must fetch server even inside TTL');
 f.resolve(1,f.ownerReply());await refresh;
 const partner=f.ctx.partner();
 f.resolve(2,f.partnerReply());await partner;
 await f.ctx.partner();
 assert.equal(f.pending.length,3);
 const partnerRefresh=f.ctx.partner(true);
 assert.equal(f.pending.length,4);
 f.resolve(3,f.partnerReply());await partnerRefresh;
});
test('only verified server readback updates rank caches; extra-ledger confirmation refreshes visible ranking',()=>{
 const refreshStart=source.indexOf('async function partnerInlineFetch(){');
 const refreshEnd=source.indexOf('async function openSameAppPartnerWorkspace(',refreshStart);
 const fetcher=source.slice(refreshStart,refreshEnd);
 assert.match(fetcher,/if\(!snap\|\|!/);
 const success=fetcher.indexOf('invalidateSharedRankingReadCaches();');
 assert(success>fetcher.indexOf('const snap=(await readPartnerWorkDay'));
 assert(success<fetcher.indexOf('partnerInlineData=snap;'));
 const extraStart=source.indexOf('async function savePartnerExtra(){');
 const extraEnd=source.indexOf('pInline("pInlineExtraSave").onclick=',extraStart);
 const extra=source.slice(extraStart,extraEnd);
 assert.match(extra,/if\(matching&&\(!result\|\|result.saved===true/);
 const confirmed=extra.indexOf('invalidateSharedRankingReadCaches();');
 assert(confirmed>extra.indexOf('if(matching&&'));
 assert.match(extra.slice(confirmed),/loadSharedDailyStandings\("partner",true\)/);
 const savedStart=source.indexOf('async function partnerInlineRun(work){');
 const savedEnd=source.indexOf('function partnerInlinePayload(data){',savedStart);
 const saved=source.slice(savedStart,savedEnd);
 assert.match(saved,/const message=await work\(\);/);
 assert.match(saved,/invalidateSharedRankingReadCaches\(\);/);
 assert.match(saved,/if\(!await partnerInlineFetch\(\)\)throw/);
 const buttons=source.slice(source.indexOf('for(const which of ["Individual","Product"]){'),
   source.indexOf('const partnerSharedRankingsMonth=pInline('));
 assert.match(buttons,/loadOwnerMonthlySharedRanks\(which,true\)/);
 assert.match(source,/void loadPartnerMonthlySharedRankings\(true\)/);
});


function foregroundSharedRankFixture(){
 const start=source.indexOf('let lastVisibleSharedRankingRefreshAt=0;');
 const end=source.indexOf('for(const nav of ["partnerSameAppNavigation","partnerManagementTabs"]){',start);
 assert(start>=0&&end>start,'foreground-only focus handler should exist');
 const events=[],calls=[],inputs={date:'2026-11-05',cb:'40000',count:'7'};
 const nodes={
  partnerSameAppDashboardDetails:{hidden:false},
  partnerPanelRankings:{hidden:false},
  individualRankingContent:{hidden:false},
  productRankingContent:{hidden:false}
 };
 let now=100000;
 const ctx={
  document:{visibilityState:'visible',addEventListener:(name,fn)=>events.push({name,fn})},
  window:{addEventListener:(name,fn)=>events.push({name,fn})},
  auth:{currentUser:{uid:'owner'}},
  appScreen:{style:{display:'block'},dataset:{partnerCountOnly:'true'}},
  partnerInlineData:{role:'member'},
  partnerSameAppSelectedPanel:'individual',
  ownerJointIndividualMode:true,ownerJointProductMode:true,
  ownerJointIndividualPeriod:'month',ownerJointProductPeriod:'day',
  canReadSharedCountOnlyRanks:()=>true,
  pInline:id=>nodes[id],
  Date:{now:()=>now},
  loadSharedDailyStandings:(which,force)=>calls.push({which,force}),
  loadOwnerMonthlySharedRanks:(which,force)=>calls.push({which,force,month:true})
 };
 vm.runInNewContext(source.slice(start,end)+'\nthis.refresh=refreshVisibleSharedRankingsOnResume;',ctx);
 return {ctx,events,calls,nodes,inputs,run:()=>ctx.refresh(),clock:t=>now=t};
}
test('switching back to a partner ranking refreshes server counts without touching unsaved input',()=>{
 const f=foregroundSharedRankFixture();
 assert.deepEqual(f.events.map(x=>x.name).sort(),['focus','visibilitychange']);
 const before=JSON.stringify(f.inputs);
 assert.equal(f.run(),true);
 assert.deepEqual(f.calls.map(x=>x.which),['partner']);
 assert.equal(f.calls[0].force,true);
 assert.equal(JSON.stringify(f.inputs),before,'two-column count/CB drafts must survive');
 f.clock(105000);
 assert.equal(f.events.find(e=>e.name==='visibilitychange').fn(),false);
 assert.equal(f.calls.length,1,'focus+visibility must not double-read');
 f.clock(200001);assert.equal(f.run(),true);
 assert.equal(f.calls.length,2,'foreground re-entry may refresh again after 90s');
});
test('background, hidden rank panel, logged-out and edit-only partner screens do not fetch',()=>{
 const f=foregroundSharedRankFixture();
 f.ctx.document.visibilityState='hidden';
 assert.equal(f.run(),false);
 f.ctx.document.visibilityState='visible';
 f.nodes.partnerPanelRankings.hidden=true;
 assert.equal(f.run(),false);
 f.nodes.partnerPanelRankings.hidden=false;
 f.ctx.partnerSameAppSelectedPanel='record';
 assert.equal(f.run(),false);
 f.ctx.partnerSameAppSelectedPanel='individual';
 f.ctx.auth.currentUser=null;
 assert.equal(f.run(),false);
 assert.equal(f.calls.length,0);
});
test('owner individual and product rankings are independently refreshed only when visible',()=>{
 const f=foregroundSharedRankFixture();
 f.ctx.appScreen.dataset.partnerCountOnly='false';
 assert.equal(f.run(),true);
 assert.deepEqual(f.calls.map(x=>[x.which,x.force,x.month||false]),
  [['Individual',true,true],['Product',true,false]]);
 f.calls.length=0;
 f.clock(200001);f.nodes.productRankingContent.hidden=true;
 assert.equal(f.run(),true);
 assert.deepEqual(f.calls.map(x=>x.which),['Individual']);
 f.calls.length=0;
 f.clock(300002);f.ctx.ownerJointIndividualMode=false;
 assert.equal(f.run(),false);
 assert.equal(f.calls.length,0);
});
test('forced partner day/month routing and tab opening bypass local TTL but never auto-save',()=>{
 const start=source.indexOf('async function loadSharedDailyStandings(where,force=false){');
 const end=source.indexOf('const ownerMonthlyRankCache=new Map();',start);
 const ranking=source.slice(start,end);
 assert.match(ranking,/return loadPartnerMonthlySharedRankings\(force\)/);
 const nav=source.slice(source.indexOf('function partnerSameAppSelectPanel(name){'),
  source.indexOf('// Mirror the original dashboard toggle:',source.indexOf('function partnerSameAppSelectPanel(name){')));
 assert.match(nav,/loadSharedDailyStandings\("partner",true\)/);
 const startResume=source.indexOf('let lastVisibleSharedRankingRefreshAt=0;');
 const endResume=source.indexOf('for(const nav of ["partnerSameAppNavigation","partnerManagementTabs"]){',startResume);
 const resume=source.slice(startResume,endResume);
 assert(!/partnerInlineFetch\(|partnerInlineSave\(|submitPartnerWorkspaceCounts\(|setDoc\(|updateDoc\(/.test(resume));
 assert.match(resume,/90000/);
});
