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
 assert.match(html,/今日の実績を登録・確認できます/);
 assert.match(source,/partnerInlineStatus\("最新の件数を表示しています。"\)/);
 assert.match(source,/const readPartnerWorkDay = httpsCallable\(partnerCountFunctions,"getPartnerWorkspace"\)/);
 assert.match(source,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(html,/monthlyRevenue/);
});

test("one persistent record element is placed immediately after count summary, not inside toggle details",()=>{
 const mount=snippet("function mountPartnerCanonicalNavigation(){","function renderPartnerCountOnlyExtras(){");
 assert.match(mount,/const record=pInline\("partnerPanelRecord"\)/);
 assert.match(mount,/querySelector\("\.dashboard-summary"\)/);
 assert.match(mount,/summary\.after\(record\)/);
 assert.match(mount,/record\.hidden=false/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerPanelRecord\{display:block!important/);
 assert.equal((html.match(/id="partnerPanelRecord"/g)||[]).length,1);
 const part=snippet("function partnerSameAppSelectPanel(name){","function partnerSameAppTogglePanel(name){");
 assert.match(part,/if\(name==="record"\)\{/);
 assert.match(part,/form\.hidden=false/);
 assert.match(part,/if\(partnerInlineData\)form\.scrollIntoView/);
 assert.match(part,/if\(partnerInlineData&&name==="history"\)/);
 assert.match(part,/loadSharedDailyStandings\("partnerDetail"\)/);
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
 const save=snippet('pInline("pInlineSave").onclick=()=>partnerInlineRun(async()=>',
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
  partnerInlineBusy:false,
  partnerInlineData:{staff:[{id:"a",active:true}]},
  auth:{currentUser:{uid:"u"}},
  sharedDailyRankingGeneration:0,
  sharedDailyRankCache:new Map(),
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
 await context.perform(async()=> "登録済みの件数と同じです。変更はありません。",{kind:"save"});
 assert.notEqual(ui.get("pInlineSaveStatus").dataset.result,"success");
 await context.perform(async()=> {throw Object.assign(Error("no"),{code:"functions/permission-denied"})},{kind:"save",refresh:false});
 assert.equal(ui.get("pInlineSaveStatus").dataset.result,"error");
 assert.doesNotMatch(ui.get("pInlineSaveStatus").textContent,/実績を登録できました/);
 assert.match(html,/#partnerInlineWorkspace #pInlineSaveStatus\[data-result="success"\]/);
 assert.match(source,/pInline\("pInlineSaveStatus"\)\.dataset\.result="pending"/);
 assert.match(source,/pInline\("pInlineSaveStatus"\)\.dataset\.result="error"/);

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
