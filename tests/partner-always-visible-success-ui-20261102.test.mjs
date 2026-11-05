import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||html;
function snippet(start,end){
 const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,"missing boundaries "+start);
 return source.slice(i,j);
}

test("partner UI no longer repeats the money/price loading notice, while server-only count API stays",()=>{
 assert.doesNotMatch(html,/件数を表示しています。金額・単価は読み込んでいません/);
 assert.doesNotMatch(html,/協力店には件数だけを表示し、売上・単価の原票は読み込みません/);
 assert.match(html,/班・メンバー・商材・実績を一元管理できます/);
 assert.match(source,/partnerInlineStatus\("最新の件数を表示しています。"\)/);
 assert.match(source,/const readPartnerWorkDay = httpsCallable\(partnerCountFunctions,"getPartnerWorkspace"\)/);
 assert.match(source,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(html,/monthlyRevenue/);
});

test("one persistent record element precedes the dashboard, matching the internal company",()=>{
 const mount=snippet("function mountPartnerCanonicalNavigation(){","function renderPartnerCountOnlyExtras(){");
 assert.match(mount,/const record=pInline\("partnerPanelRecord"\)/);
 assert.match(mount,/const dashboard=pInline\("partnerDashboard"\)/);
 assert.match(mount,/dashboard\.before\(record\)/);
 assert.match(mount,/record\.hidden=false/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerPanelRecord\{display:block!important/);
 assert.equal((html.match(/id="partnerPanelRecord"/g)||[]).length,1);
 const part=snippet("function partnerSameAppSelectPanel(name){","function partnerSameAppTogglePanel(name){");
 assert.match(part,/if\(name==="record"\)\{/);
 assert.match(part,/form\.hidden=false/);
 assert.match(part,/if\(partnerInlineData\)form\.scrollIntoView/);
 assert.match(part,/if\(partnerInlineData&&name==="history"\)/);
 assert.match(part,/if\(partnerInlineData&&name==="detail"\)pInline\("pInlineTeamDetails"\)\.hidden=false/);
 const legacy=snippet('pInline("pPartnerRecordToggle").onclick=()=>{','pInline("pPartnerMemberShortcut").onclick');
 assert.doesNotMatch(legacy,/panel\.hidden=!panel\.hidden/);
});

test("record card click never hides the always-visible form or disturbs other dashboard panels",()=>{
 const code=snippet("function partnerSameAppTogglePanel(name){",'window.addEventListener("resize"');
 const fields={
  partnerSameAppDashboardDetails:{hidden:false},
  partnerGlobalDateToolbar:{hidden:true}
 };
 const calls=[],attrs=[];
 const button={setAttribute:(k,v)=>attrs.push([k,v])};
 const ctx={
  partnerSameAppSelectedPanel:"chart",
  pInline:id=>fields[id]||({querySelectorAll:()=>[button]}),
  partnerSameAppSelectPanel:name=>calls.push(name)
 };
 vm.runInNewContext(code+"\nthis.toggle=partnerSameAppTogglePanel;",ctx);
 ctx.toggle("record");
 assert.deepEqual(calls,["record"]);
 assert.equal(fields.partnerSameAppDashboardDetails.hidden,false);
 ctx.toggle("chart");
 assert.equal(fields.partnerSameAppDashboardDetails.hidden,true,"other details still toggle");
 assert.equal(attrs.filter(x=>x[0]==="aria-expanded").length,2);
});

test("confirmation only happens after verified server readback for both new and edited rows",()=>{
 const save=snippet('pInline("pInlineSave").onclick=()=>{',
  "// Original internal owner sees existing teams PLUS partner-company teams.");
 assert.match(save,/const readback=partnerSavedCountReadbackState\(verified,expected\)/);
 assert.match(save,/const verifiedMessage=before\?"✅ 実績を修正できました！":"✅ 実績を登録できました！"/);
 assert.match(save,/if\(readback==="saved"\)return verifiedMessage/);
 assert.match(save,/result\.version!==expected\.expectedVersion\+1\|\|readback!=="saved"/);
 assert.match(save,/return verifiedMessage;/);
 assert.equal(save.split("await partnerInlineSave(").length-1,1,"never retry writes automatically");
 assert.match(save,/if\(partnerInlineCountsUnchanged/);
 assert.match(save,/登録済みの件数と同じです/);
});

test("success is rendered beside Save, remains visible after refresh; errors must not show success",async()=>{
 const code=snippet("async function partnerInlineRun(work){","function partnerInlinePayload(data){");
 const ui=new Map();
 for(const name of [
  "pInlineSaveStatus","pInlineSave","pInlineDate","pInlineRecordDate",
  "pInlineStaff","pInlineWorkingTeam","pInlineWorkLocation","pInlineRefresh",
  "pInlineZero","pInlineClear"
 ])ui.set(name,{disabled:false,textContent:"",dataset:{}});
 const messages=[];
 const context={
  partnerInlineBusy:false,partnerExtraDirty:()=>false,partnerProductMonthlyNonce:0,partnerProductMonthlyCache:null,
  partnerInlineData:{staff:[{id:"a",active:true}]},
  auth:{currentUser:{uid:"u"}},
  sharedDailyRankingGeneration:0,
  sharedDailyRankCache:new Map(),
  invalidateSharedRankingReadCaches:()=>{context.invalidations=(context.invalidations||0)+1;},
  pInline:id=>ui.get(id)||null,
  partnerInlineStatus:msg=>messages.push(msg),
  partnerCountSaveFailureMessage:()=>"保存に失敗しました。",
  async partnerInlineFetch(){ui.get("pInlineSaveStatus").textContent="";return true;},
  partnerInlineRenderCounts(){ui.get("pInlineSaveStatus").textContent="";},
  renderPartnerPrivateProductCatalog(){},
 };
 ui.get("pInlineStaff").value="a";
 vm.runInNewContext(code+";this.perform=partnerInlineRun;",context);
 await context.perform(async()=> "✅ 実績を登録できました！",{kind:"save"});
 assert.equal(ui.get("pInlineSaveStatus").dataset.result,"success");
 assert.match(ui.get("pInlineSaveStatus").textContent,/実績を登録できました/);
 assert.equal(context.invalidations,1,"verified save invalidates stale counts");
 await context.perform(async()=> "登録済みの件数と同じです。変更はありません。",{kind:"save"});
 assert.notEqual(ui.get("pInlineSaveStatus").dataset.result,"success");
 await context.perform(async()=> {throw Object.assign(Error("no"),{code:"functions/permission-denied"})},{kind:"save",refresh:false});
 assert.equal(ui.get("pInlineSaveStatus").dataset.result,"error");
 assert.doesNotMatch(ui.get("pInlineSaveStatus").textContent,/実績を登録できました/);
 assert.match(html,/#partnerInlineWorkspace #pInlineSaveStatus\[data-result="success"\]/);
});

test("original HQ finance / security rules, invite, saved history and merged rankings remain untouched",()=>{
 for(const marker of [
  "partnerInlineOpenHistoryCorrection","partnerInlineRemoveManagedStaff",
  "loadSharedDailyStandings","partnerSavedCountReadbackState",
  "privateCounts:wirePrivateCounts","partnerSameAppPositionPanel",
  "signInWithEmailAndPassword","monthlyRevenue",
  'id="partnerPanelInvite"','id="partnerPanelHistory"'
 ])assert.ok(html.includes(marker),marker);
});


test("role switch scrubs in-memory internal prices and stale monetary DOM without any database writes",()=>{
 const code=snippet("function isolateInternalFinanceForPartnerWorkspace(){",
  "async function openSameAppPartnerWorkspace(");
 const cleared=[],nodes=Array.from({length:6},(_,i)=>({
  replaceChildren(){cleared.push(i);}
 }));
 const ctx={
  products:[{id:"price",unitPrice:87000,pricingOptions:[{price:50000}]}],
  records:[{totalRevenue:500000}],
  revenueGoals:[{targetRevenue:1000000}],
  annualChartRecords:[{totalRevenue:500000}],
  members:[{email:"private@example.test"}],
  teams:[{name:"old team"}],goals:[{total:1}],
  currentUserData:{companyId:"internal",canViewRevenue:true,companyRole:"owner"},
  currentCompanyData:{companyKind:"internal",name:"Nico"},
  editingProductId:"price",editingRecordId:"old",editingRecordRevision:5,
  productList:nodes[0],productPricingEditor:nodes[1],
  editProductPricingEditor:nodes[2],individualRankingList:nodes[3],
  productRankingMemberList:nodes[4],monthlyRevenue:nodes[5]
 };
 vm.runInNewContext(code+"\nthis.scrub=isolateInternalFinanceForPartnerWorkspace;",ctx);
 ctx.scrub();
 for(const key of ["products","records","revenueGoals","members","teams","goals"])
  assert.equal(ctx[key].length,0,key);
 for(const key of ["currentUserData","currentCompanyData","annualChartRecords",
  "editingProductId","editingRecordId","editingRecordRevision"])
  assert.equal(ctx[key],null,key);
 assert.equal(cleared.length,6,"both old price editors and ranking DOM are scrubbed");
 const open=snippet("async function openSameAppPartnerWorkspace(",
  "// The callable may commit before the phone loses its response.");
 const mode=open.indexOf('appScreen.dataset.partnerCountOnly="true";'),
  stop=open.indexOf("stopRealtimeListeners();"),
  scrub=open.indexOf("isolateInternalFinanceForPartnerWorkspace();"),
  fetch=open.indexOf("await partnerInlineFetch();");
 assert(mode>=0&&stop>mode&&scrub>stop&&fetch>scrub,
  "partner-only mode and memory cleanup happen before async reads");
 assert(!/deleteDoc\(|setDoc\(|updateDoc\(|runTransaction\(/.test(code));
});
test("a pending legacy product read cannot rehydrate prices after switching to partner",async()=>{
 const code=snippet("async function loadProducts(","function clearProductLongPress()");
 let resolveRead,rendered=0;
 const ctx={
  appScreen:{dataset:{partnerCountOnly:false}},
  auth:{currentUser:{uid:"owner"}},
  currentUserData:{companyId:"direct"},
  products:[{id:"stale",unitPrice:45000}],
  getDocs:()=>new Promise(resolve=>{resolveRead=resolve;}),
  companyCollectionQuery:()=>({type:"products"}),
  compareProductsByOrder:()=>0,
  renderProducts:()=>{rendered++;},
  catalogOwner:()=>false,
  isCurrentCompanyManager:()=>false,
  console:{error(){}},
  showError:()=>{throw Error("unexpected error UI");}
 };
 vm.runInNewContext(code+"\nthis.read=loadProducts;",ctx);
 const first=ctx.read();
 assert.equal(typeof resolveRead,"function");
 ctx.appScreen.dataset.partnerCountOnly="true";
 ctx.products=[];
 resolveRead({forEach:fn=>fn({id:"secret",data:()=>({unitPrice:90000})})});
 assert.equal(await first,false);
 assert.equal(ctx.products.length,0);
 assert.equal(rendered,0);
 assert.equal(await ctx.read(),false,"partner may not even start the old getDocs");
});
test("partner-only mode never starts financial Firestore listeners",()=>{
 const start=source.indexOf("function startRealtimeListeners() {");
 const end=source.indexOf("function stopRealtimeListeners()",start);
 assert(start>=0&&end>start);
 const code=source.slice(start,end);
 const ctx={appScreen:{dataset:{partnerCountOnly:"true"}}};
 vm.runInNewContext(code+"\nthis.start=startRealtimeListeners;",ctx);
 assert.equal(ctx.start(),undefined,"return before invoking any legacy listener");
 const firstGuard=code.indexOf('if(typeof appScreen!=="undefined"&&appScreen?.dataset?.partnerCountOnly==="true")return;');
 const stop=code.indexOf("stopRealtimeListeners();");
 assert(firstGuard>=0&&stop>firstGuard,"role guard before old listener reset");
});


test("queued internal Firestore snapshots are invalid after a partner or company switch",()=>{
 const a=source.indexOf('  const listenerSession=typeof internalListenerSessionGeneration==="number"');
 const b=source.indexOf('  loadLocalRankingGroups();',a);
 assert(a>=0&&b>a,'internal snapshot epoch must be captured after subscription reset');
 const ctx={
  internalListenerSessionGeneration:5,
  recordQueryGeneration:10,
  appScreen:{dataset:{partnerCountOnly:"false"}},
  currentUserData:{companyId:"direct"},
  currentUser:{uid:"owner"}
 };
 vm.runInNewContext(source.slice(a,b)+'\nthis.verify=internalSnapshotIsCurrent;',ctx);
 assert.equal(ctx.verify(),true);
 ctx.recordQueryGeneration+=1;
 assert.equal(ctx.verify(),true,"changing dashboard month never cancels catalog listeners");
 ctx.internalListenerSessionGeneration+=1;
 assert.equal(ctx.verify(),false,"a fresh listener session rejects an old queued callback");
 ctx.internalListenerSessionGeneration=5;
 ctx.appScreen.dataset.partnerCountOnly="true";
 assert.equal(ctx.verify(),false,"partner cannot revive an old finance listener");
 ctx.appScreen.dataset.partnerCountOnly="false";
 ctx.currentUserData.companyId="other";
 assert.equal(ctx.verify(),false,"changing original company rejects prior callback");
 ctx.currentUserData.companyId="direct";
 ctx.currentUser.uid="another";
 assert.equal(ctx.verify(),false,"another user's callbacks cannot rehydrate prior prices");
 const stop=snippet('function stopRealtimeListeners() {','async function loadTeams(');
 assert.match(stop,/\+\+internalListenerSessionGeneration;/);
});
test("all six original Firebase listeners check the context before mutating UI",()=>{
 const start=source.indexOf('function startRealtimeListeners() {');
 const end=source.indexOf('function stopRealtimeListeners() {',start);
 const code=source.slice(start,end);
 const callbacks=[
  /companyMembersCollectionRef\(\),\s*snapshot => \{\s*if\(!internalSnapshotIsCurrent\(\)\)return;/,
  /currentUser\.uid\s*\),\s*async userSnap => \{\s*if\(!internalSnapshotIsCurrent\(\)\)return;/,
  /companyCollectionQuery\("teams"\),\s*snapshot => \{\s*if\(!internalSnapshotIsCurrent\(\)\)return;/,
  /companyCollectionQuery\("products"\),\s*snapshot => \{\s*if\(!internalSnapshotIsCurrent\(\)\)return;/,
  /companyCollectionQuery\("goals"\),\s*snapshot => \{\s*if\(!internalSnapshotIsCurrent\(\)\)return;/,
  /revenueGoalQuery,\s*snapshot => \{\s*if\(!internalSnapshotIsCurrent\(\)\)return;/
 ];
 for(const re of callbacks)assert.match(code,re);
 assert.match(code,/await loadMembers\(\);\s*if\(internalSnapshotIsCurrent\(\)\)startRealtimeListeners\(\)/);
 assert.match(code,/if\(internalSnapshotIsCurrent\(\)\)startRealtimeListeners\(\)/);
 assert(!/setDoc\(|deleteDoc\(|updateDoc\(|runTransaction\(/.test(code));
});


test("old company team/member readers discard late results when switching to partner",async()=>{
 const helper=snippet("function sameInternalReadContext(companyId,uid,session){",
  "function companyCollectionQuery(");
 const functionSource=name=>{
  const start=source.indexOf("async function "+name+"(");
  const end=source.indexOf("\n}\n",start);
  assert(start>=0&&end>start,"missing "+name);
  return source.slice(start,end+2);
 };
 for(const task of ["loadTeams","loadMembers"]){
  let resolveRead,rendered=0;
  const ctx={
   internalListenerSessionGeneration:1,
   currentUserData:{companyId:"direct",role:"leader"},
   auth:{currentUser:{uid:"owner"}},
   appScreen:{dataset:{partnerCountOnly:"false"}},
   teams:[{id:"old"}],members:[{id:"old",email:"private@example.test"}],
   getDocs:()=>new Promise(resolve=>{resolveRead=resolve;}),
   companyCollectionQuery:()=>({}),
   companyMembersCollectionRef:()=>({}),
   isCurrentCompanyManager:()=>true,
   renderTeams:()=>{rendered++;},
   renderMembers:()=>{rendered++;},
   renderOwnerTransferOptions:()=>{rendered++;},
   loadOwnerPartnerCompanyTeams:async()=>{rendered++;},
   compareProductsByOrder:()=>0,console:{error(){}}
  };
  vm.runInNewContext(helper+"\n"+functionSource(task)+
   "\nthis.invoke="+task+";this.check=sameInternalReadContext;",ctx);
  const inflight=ctx.invoke();
  assert.equal(typeof resolveRead,"function");
  ctx.appScreen.dataset.partnerCountOnly="true";
  ctx.internalListenerSessionGeneration=2;
  ctx.teams=[];ctx.members=[];
  resolveRead({forEach:fn=>fn({id:"inherited",data:()=>({name:"Internal member",unitPrice:99999})})});
  assert.equal(await inflight,false,task+" must ignore old role result");
  assert.equal(ctx.teams.length,0);
  assert.equal(ctx.members.length,0);
  assert.equal(rendered,0);
  assert.equal(await ctx.invoke(),false,task+" must not start old Firestore readers");
 }
});
test("same-company reader rejects UID changes, company switches and listener generations",()=>{
 const code=snippet("function sameInternalReadContext(companyId,uid,session){",
  "function companyCollectionQuery(");
 const ctx={currentUserData:{companyId:"direct"},
  auth:{currentUser:{uid:"owner"}},appScreen:{dataset:{partnerCountOnly:"false"}},
  internalListenerSessionGeneration:3};
 vm.runInNewContext(code+"\nthis.check=sameInternalReadContext;",ctx);
 assert.equal(ctx.check("direct","owner",3),true);
 ctx.currentUserData.companyId="another";
 assert.equal(ctx.check("direct","owner",3),false);
 ctx.currentUserData.companyId="direct";
 ctx.auth.currentUser.uid="another";
 assert.equal(ctx.check("direct","owner",3),false);
 ctx.auth.currentUser.uid="owner";
 ctx.internalListenerSessionGeneration=4;
 assert.equal(ctx.check("direct","owner",3),false);
 ctx.internalListenerSessionGeneration=3;
 ctx.appScreen.dataset.partnerCountOnly="true";
 assert.equal(ctx.check("direct","owner",3),false);
});
