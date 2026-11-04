const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('let ownerCountManagementGeneration=0;');
const b=html.indexOf('pInline("ownerPartnerDashboardRefresh").onclick=',a);
function fixture(){
 const nodes=Object.fromEntries(['ownerPartnerDashboardDate','ownerSharedDetailTree','ownerSharedDetailStatus','ownerSharedRankingContent','ownerSharedRankingsStatus','ownerPartnerDashboardDetails','allTeamsOverviewContent'].map(id=>[id,{value:'2026-11-04',hidden:false,textContent:'old',replaceChildren(){this.textContent='';}}]));
 const pending=[],calls=[],auth={currentUser:{uid:'owner'}};
 const ctx={pInline:id=>nodes[id],auth,canLoadPartnerRanking:()=>true,loadOwnerPartnerDetails:()=>new Promise(resolve=>pending.push(resolve)),loadSharedDailyStandings:async(...args)=>calls.push(args)};
 vm.runInNewContext(html.slice(a,b)+';this.run=refreshOwnerCountManagement;',ctx);
 return {nodes,pending,calls,auth,run:ctx.run};
}
test('opening management clears obsolete details and retrieves shared member counts after company audit',async()=>{
 const f=fixture(),run=f.run();assert.equal(f.nodes.ownerSharedDetailTree.textContent,'');assert.equal(f.nodes.ownerSharedRankingContent.textContent,'');assert.equal(f.calls.length,0);
 f.pending[0]();await run;assert.deepEqual(f.calls,[['ownerDetail',true]]);
});
test('fast date changes do not restart older day details after the newer request',async()=>{
 const f=fixture(),old=f.run();f.nodes.ownerPartnerDashboardDate.value='2026-11-03';const current=f.run();
 f.pending[1]();await current;f.pending[0]();await old;assert.equal(f.calls.length,1);
});
test('sign-out and closed management prevent a queued detail fetch',async()=>{
 for(const kind of ['logout','closed']){const f=fixture(),run=f.run();if(kind==='logout')f.auth.currentUser=null;else f.nodes.allTeamsOverviewContent.hidden=true;f.pending[0]();await run;assert.equal(f.calls.length,0);}
});
test('shared details start expanded and merged form keeps additional products and unique input IDs',()=>{
 assert.match(html,/<details class="p-inline-card owner-partner-additional" open>/);
 for(const id of ['pInlineWorkingTeam','pInlineWorkLocation','pInlineExtraFields','pInlineEntryTotals'])assert.equal(html.split('id="'+id+'"').length-1,1,id);
});
