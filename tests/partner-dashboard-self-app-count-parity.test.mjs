import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const index=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const partner=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const slice=(text,start,end)=>{
 const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"missing UI section "+start);
 return text.slice(a,b);
};
const original=slice(index,'<div class="dashboard-app-grid">','id="dashboardDetailArea"');
const candidate=slice(partner,'<section id="dashboardBox" hidden>','<section id="recordsBox" hidden>');
const labels=s=>[...s.matchAll(/class="dashboard-app-title">([^<]+)<\/span>/g)].map(m=>m[1].trim());
const panels=[...candidate.matchAll(/data-count-panel="([^"]+)"/g)].map(m=>m[1]);

test("partner is a counts-only copy of all eleven original dashboard cards and ordering",()=>{
 const main=labels(original),copy=labels(candidate);
 assert.equal(main.length,11);
 assert.deepEqual(copy,main.map(x=>({
  "売上分析":"件数分析",
  "収益グラフ":"件数グラフ"
 })[x]||x));
 assert.deepEqual(panels,[
  "analysis","individual","productRanking","teamRanking","trend","teamDetail",
  "productSummary","report","goal","daily","history"
 ]);
 assert.equal(new Set(panels).size,11);
 for(const name of panels){
  assert.match(candidate,new RegExp('id="partnerPanel-'+name+'"'));
 }
});

test("uses the canonical dashboard card, summary and mobile CSS grammar",()=>{
 for(const css of [
  ".dashboard-summary{",".summary-card{",".summary-label{",".summary-value{",
  ".dashboard-app-grid{",".dashboard-app-button{",".dashboard-app-icon{",
  ".dashboard-app-title{",".dashboard-app-meta{",".dashboard-detail-area{",
  ".dashboard-app-content{","@media(max-width:700px)"
 ])assert.ok(partner.includes(css),css);
 assert.match(candidate,/<input id="dashboardPartnerMonth" type="month"/);
 assert.match(candidate,/id="countKpis" class="dashboard-summary"/);
 assert.match(candidate,/id="periodMonth" aria-pressed="true"/);
 assert.match(partner,/let countPeriod="month"/);
});

test("the original login, recording, people, owner administration and CSV survive unchanged",()=>{
 for(const id of [
  "loginForm","companyCodeLoginForm","inviteAccept","appBox","recordsBox","peopleBox",
  "listBox","hubBox","missingBox","staffSelect","save","revision","countGrid",
  "privateCountGrid","makeTeam","privateProductAdmin","moveStaffAction","hubCompanySelect",
  "hubTeamCountRows","countCsv","countGoal","countGoalSave","countGoalClear",
  "countTeamRank","countStaffRank","countProductRank","countTeamSelect","countTeamProducts",
  "countTeamPeople","countDailyRows"
 ]) assert.ok(partner.includes('id="'+id+'"'),id);
 const ids=[...partner.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,"duplicate id in partner HTML");
 assert.match(partner,/expectedVersion:record\?\.version\?\?0/);
 assert.match(partner,/const verified=\(await get\(\{date\}\)\)\.data/);
 assert.match(partner,/countDayCache\.clear\(\);refresh\(\)/);
});

test("partner copy cannot import internal Firestore or finance data and does not open money cards",()=>{
 const script=slice(partner,'<script type="module">','</script>');
 assert.match(script,/httpsCallable\(functions,name\)/);
 for(const name of [
  "getPartnerWorkspace","managePartnerWorkspace",
  "acceptPartnerWorkspaceInvite","submitPartnerWorkspaceCounts"
 ])assert.ok(script.includes(name),name);
 assert.doesNotMatch(script,/firebase-firestore|firebase\/firestore|cloudflare-finance/);
 assert.doesNotMatch(candidate,/id="monthlyRevenue"|id="salesAnalysisContent"|id="revenueChartContent"/);
 assert.match(candidate,/件数分析/);
 assert.match(candidate,/件数グラフ/);
 assert.match(script,/\.textContent=/);
 assert.match(script,/report\.value/);
});

test("repeated month loads reject stale sessions and never publish partial counts",()=>{
 assert.match(partner,/function currentCountIdentity\(\)/);
 assert.match(partner,/currentCountIdentity\(\)!==uid/g);
 assert.match(partner,/countPeriod==="month"\?\$\("dashboardPartnerMonth"\)\.value\+"-01"/);
 assert.match(partner,/countLoadId\+\+/);
 assert.match(partner,/clearCountOnlyDashboard\(\)/);
 assert.match(partner,/不完全な件数は表示しません/);
 assert.match(partner,/summary\.hasUnverifiedTeams/);
 assert.match(partner,/countExportRows=\{summary,days\}/);
 assert.match(partner,/countPeriod!=="month"\|\|!countExportRows\|\|!auth\.currentUser\?\.uid/);
});

test("new report and trend are derived from validated counts, never new writes",()=>{
 const module=slice(partner,'<script type="module">','</script>');
 const block=slice(module,"function renderCountOnlyDashboard(summary,days){","function clearCountOnlyDashboard(){");
 assert.match(block,/const report=\[/);
 assert.match(block,/countReportBody/);
 assert.match(block,/countProductSummary/);
 assert.match(block,/countTrendChart/);
 assert.match(block,/const max=Math\.max\(1,\.\.\.summary\.days/);
 assert.doesNotMatch(block,/httpsCallable|save\(|manage\(|getFirestore|Firebase\.firestore|setDoc|updateDoc|addDoc|fetch\(/);
 assert.match(partner,/countHistoryOpen"\)\.onclick=\(\)=>activeTab\("View"\)/);
});


test("invite join requires an explicit, fresh transfer/secondary choice with no default",()=>{
 const section=slice(partner,'<section id="inviteAccept" hidden>','<section id="appBox" hidden>');
 assert.match(section,/id="transferExistingInternal" name="joinMembershipMode" type="radio"/);
 assert.match(section,/id="keepInternalMembership" name="joinMembershipMode" type="radio"/);
 assert.equal((section.match(/name="joinMembershipMode"/g)||[]).length,2);
 assert.doesNotMatch(section,/type="radio"[^>]*\schecked(?:\s|>)/);
 assert.match(section,/金額原票への旧権限が残る可能性/);
 const script=slice(partner,'$("join").onclick=async()=>{','\n$("logout").onclick=async()=>{');
 assert.match(script,/if\(transfer===keep\)/);
 assert.match(script,/if\(!window\.confirm\(warning\)\)return/);
 assert.match(script,/await action\(async\(\)=>\{/);
 assert.match(script,/transferCurrentCompany:\$\("transferExistingInternal"\)\.checked/);
 assert.match(partner,/onAuthStateChanged\(auth,async u=>\{[\s\S]*?\$\("transferExistingInternal"\)\.checked=false;[\s\S]*?\$\("keepInternalMembership"\)\.checked=false;/);
});

test("join never invokes mutation until one option is selected AND confirmed",async()=>{
 const script=slice(partner,'$("join").onclick=async()=>{','\n$("logout").onclick=async()=>{');
 const nodes={join:{},transferExistingInternal:{checked:false},
  keepInternalMembership:{checked:false},joinName:{value:"Test"}};
 let confirms=[],notices=[],calls=[],actions=0,permit=false;
 const context={
  inviteToken:"synthetic_invitation",loading:false,
  $:id=>nodes[id],notice:(s,bad)=>notices.push([s,bad]),
  window:{confirm:message=>{confirms.push(message);return permit}},
  action:async task=>{
   actions++;
   try{await task()}catch(e){
    // Captured BEFORE any follow-on action or history/location mutation.
    assert.equal(e.message,"TEST_CAPTURE_BEFORE_ANY_PRODUCTION_WRITE");
   }
  },
  accept:async payload=>{
   calls.push(payload);
   throw Error("TEST_CAPTURE_BEFORE_ANY_PRODUCTION_WRITE");
  }
 };
 runInNewContext(script,context);
 assert.equal(typeof nodes.join.onclick,"function");
 await nodes.join.onclick();
 assert.equal(actions,0);
 assert.equal(confirms.length,0);
 assert.equal(calls.length,0);
 assert.match(notices.at(-1)[0],/必ずどちらかを選択/);
 nodes.transferExistingInternal.checked=true;
 await nodes.join.onclick();
 assert.equal(confirms.length,1);
 assert.equal(actions,0,"cancelled primary transfer must not invoke backend");
 permit=true;
 await nodes.join.onclick();
 assert.equal(actions,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].transferCurrentCompany,true);
 nodes.transferExistingInternal.checked=false;
 nodes.keepInternalMembership.checked=true;
 permit=false;
 await nodes.join.onclick();
 assert.equal(actions,1,"cancelled dual membership must not invoke backend");
 permit=true;
 await nodes.join.onclick();
 assert.equal(actions,2);
 assert.equal(calls[1].transferCurrentCompany,false);
 // Bad DOM state must fail closed, never fall through into account update.
 nodes.transferExistingInternal.checked=true;
 await nodes.join.onclick();
 assert.equal(actions,2);
});

test("partner competition ranks preserve 1,1,3 and exclude unverified team from placements",()=>{
 const start=partner.indexOf("function competitionRanks(");
 const end=partner.indexOf("function renderTeamCountDetail()",start);
 assert.ok(start>=0&&end>start,"rank helper exists in existing dashboard");
 const rank=runInNewContext(partner.slice(start,end)+"\ncompetitionRanks");
 const rows=[{count:5},{count:5},{count:2},{count:1}];
 const result=Array.from(rank(rows,x=>x.count,(_,r)=>r));
 assert.deepEqual(result,[1,1,3,4]);
 const withUnknown=[
  {id:"__unverified__",count:10},
  {id:"1",count:5},
  {id:"2",count:5},
  {id:"3",count:2}
 ];
 assert.deepEqual(
  Array.from(rank(withUnknown,x=>x.count,(row,r)=>r,x=>x.id!=="__unverified__")),
  [null,1,1,3]
 );
 assert.throws(()=>rank([{count:2},{count:4}],x=>x.count,(x,r)=>r),
  /unordered count ranking/);
 assert.throws(()=>rank([{count:-1}],x=>x.count,(x,r)=>r),
  /invalid count ranking/);
 assert.deepEqual(rows,[{count:5},{count:5},{count:2},{count:1}],
  "display ranking must never mutate original counts");
});
test("all partner dashboard rank panels use the same count-only tie helper",()=>{
 for(const snippet of [
  "competitionRanks(people,p=>p.count",
  "competitionRanks(groupedProductCounts(",
  "competitionRanks(summary.groups,g=>g.count",
  "competitionRanks(summary.people,p=>p.count",
  "competitionRanks(Object.entries(summary.products)",
  'g=>g.id!=="__unverified__"'
 ])assert.ok(partner.includes(snippet),snippet);
 for(const prior of [
  'people.map((p,i)=>[i===0?"👑 1位":i+1',
  'summary.people.map((p,i)=>[i+1',
  'summary.groups.map((g,i)=>[g.id==="__unverified__"?"—":i+1',
 ])assert.ok(!partner.includes(prior),"obsolete sequence-based leaderboard: "+prior);
});
