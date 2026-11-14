import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {stripOwnerMonthlyTeamIntegration} from './helpers/strip-owner-monthly-team-integration.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('reversing only monthly additions restores the exact reviewed production + #698 tab',()=>{
 const original=Buffer.from(stripOwnerMonthlyTeamIntegration(html));
 const hash=createHash('sha1').update(Buffer.from('blob '+original.length+'\0')).update(original).digest('hex');
 assert.equal(hash,'63f61cbf0badad066ff1c07380e79567c6c67c9e');
});
class Element{
 constructor(){this.children=[];this.hidden=false;this.textContent='';}
 replaceChildren(...children){this.children=children;this.textContent='';}
 appendChild(child){this.children.push(child);}
 querySelectorAll(){return this.controls??=[];}
}
function harness({enabled=true,pending=false}={}){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 node('ownerPartnerDashboardDetails').controls=[new Element(),new Element()];
 const calls=[],renders=[];
 let release;
 const payload={role:'hub_owner'};
 const user={uid:'owner'};
 const ctx={NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED:enabled,
  document:{getElementById:node,createElement:()=>new Element()},
  auth:{currentUser:user},currentUser:user,currentUserData:{companyId:'hub'},
  recordsReady:true,recordsSubscribedMonth:'2026-11',dashboardMonth:{value:'2026-11'},
  allowed:true,canLoadPartnerRanking:()=>ctx.allowed,getTodayString:()=>'2026-11-13',
  console:{error(){}},Date,
  injectedBridgeModule:{createVerifiedJointMonthHttpBridge(options){
   assert.equal(options.auth,ctx.auth);
   return {async load(args){
    calls.push(args);
    if(pending)await new Promise(resolve=>{release=resolve;});
    return payload;
   }};
  }},injectedViewModule:{renderOwnerPartnerTeamCards(args){renders.push(args);}}
 };
 const start=html.indexOf('// Draft/NO DEPLOY: never infer partner teams');
 const end=html.indexOf('function renderAllTeamsOverview(',start);
 const code=html.slice(start,end)
  .replace('import("./ranking/verified-joint-month-http-bridge.mjs")','Promise.resolve(injectedBridgeModule)')
  .replace('import("./ranking/unified-partner-team-cards.mjs")','Promise.resolve(injectedViewModule)');
 runInNewContext(code,ctx);
 return {ctx,node,calls,renders,release:()=>release(),payload};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('OFF leaves the production daily panel untouched and makes no request',async()=>{
 const h=harness({enabled:false});
 h.node('ownerPartnerDashboardList').textContent='existing production output';
 await h.ctx.refreshOwnerVerifiedPartnerTeamCards();
 assert.equal(h.node('ownerPartnerDashboardList').textContent,'existing production output');
 assert.equal(h.calls.length,0);
});
test('ON reuses production root and dashboard month; hides independent date and duplicate detail',async()=>{
 const h=harness();
 await h.ctx.refreshOwnerVerifiedPartnerTeamCards();
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].period.day,'2026-11-01');
 assert.equal(h.calls[0].period.asOf,'2026-11-13');
 assert.equal(h.renders[0].month,'2026-11');
 assert.equal(h.renders[0].root,h.node('ownerPartnerDashboardList'));
 assert(h.node('ownerPartnerDashboardDetails').controls.every(x=>x.hidden));
 await h.ctx.refreshOwnerVerifiedPartnerTeamCards();
 assert.equal(h.calls.length,2,'save/correction rerender must read fresh totals, without a 90-second stale cache');
});
test('account, company, permission and period changes discard pending results',async()=>{
 for(const change of [
  c=>{c.auth.currentUser={uid:'other'};},
  c=>{c.currentUser={uid:'other'};},
  c=>{c.currentUserData.companyId='other';},
  c=>{c.allowed=false;},
  c=>{c.dashboardMonth.value='2026-10';},
  c=>{c.recordsSubscribedMonth='2026-10';}
 ]){
  const h=harness({pending:true});
  const task=h.ctx.refreshOwnerVerifiedPartnerTeamCards();
  await tick();change(h.ctx);h.release();await task;
  assert.equal(h.renders.length,0);
 }
});
test('stale app identity and unavailable current-month records never request data',async()=>{
 for(const change of [c=>{c.currentUser={uid:'other'};},c=>{c.recordsReady=false;},c=>{c.allowed=false;}]){
  const h=harness();change(h.ctx);
  await h.ctx.refreshOwnerVerifiedPartnerTeamCards();
  assert.equal(h.calls.length,0);
 }
});
test('legacy automatic publisher stops this candidate before loading Hosting credentials',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/nico-login-restore.yml',import.meta.url),'utf8');
 const guard=workflow.indexOf('- name: Stop integrated dashboard candidate before Hosting credentials');
 const credentials=workflow.indexOf('- name: Load approved Hosting-only service identity');
 assert(guard>0&&guard<credentials);
 assert.match(workflow.slice(guard,credentials),/STOP_INTEGRATED_DASHBOARD_REQUIRES_SEPARATE_SIGNED_RELEASE/);
 assert.match(workflow.slice(guard,credentials),/exit 1/);
});
