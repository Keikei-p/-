import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||html;
const a=source.indexOf("// Open a saved person's latest counts directly from the history");
const b=source.indexOf("async function loadPartnerRevisionHistory()",a);
assert.ok(a>0&&b>a,"historical correction handoff must exist");

function makeHarness(options={}){
 const date="2026-11-02",id="staff_linkth_1";
 const nodes={
  pInlineDate:{value:date},
  pInlineStaff:{value:"other",options:[]},
  pInlineSaveStatus:{textContent:""},
  partnerPanelRecord:{scrollIntoView(){this.scrolled=true;}},
 };
 const initial={date,companyName:"株式会社LinkTh",staff:[],records:[]};
 const fresh={
  date,companyName:"株式会社LinkTh",role:"leader",
  staff:[{id,active:true,kind:"account",uid:"user1"}],
  records:[{staffId:id,version:7,totalCount:4,counts:{NURO:4}}],
  teams:[{id:"team_1",name:"1班",active:true}],categories:["NURO"]
 };
 Object.assign(fresh,options.fresh||{});
 const calls={reads:0,renders:0,counts:0,save:0,status:[],confirm:0};
 const context={
  auth:{currentUser:{uid:"user1"}},
  partnerInlineData:initial,partnerInlineBusy:false,
  partnerInlineWorkspaceCompany:"",
  partnerSameAppSelectedPanel:"history",
  window:{confirm(){calls.confirm++;return options.acceptDiscard??true;}},
  pInline(id){return nodes[id]},
  partnerInlineHasUnsavedCounts(){return options.unsaved??false},
  partnerInlineStatus(message,bad){calls.status.push({message,bad})},
  async readPartnerWorkDay(payload){calls.reads++;assert.equal(payload.date,date);
   return {data:fresh};},
  partnerInlineRender(){calls.renders++;
   nodes.pInlineStaff.options=fresh.staff.map(p=>({value:p.id}));},
  partnerInlineRenderCounts(){calls.counts++;},
  partnerSameAppSelectPanel(panel){context.partnerSameAppSelectedPanel=panel},
 };
 vm.runInNewContext(source.slice(a,b)+";globalThis.openHistory=partnerInlineOpenHistoryCorrection;",context);
 return {context,calls,nodes,initial,fresh,date,id};
}

test("history correction opens CURRENT version in the original two-column input; no save on open",async()=>{
 const h=makeHarness();
 await h.context.openHistory(h.id,h.date);
 assert.equal(h.calls.reads,1,"fresh server read before user editing");
 assert.equal(h.context.partnerInlineData,h.fresh);
 assert.equal(h.context.partnerSameAppSelectedPanel,"record");
 assert.equal(h.nodes.pInlineStaff.value,h.id);
 assert.equal(h.calls.renders,1);
 assert.equal(h.calls.counts,1);
 assert.match(h.nodes.pInlineSaveStatus.textContent,/最新の第7版/);
 assert.equal(h.nodes.partnerPanelRecord.scrolled,true);
 assert.equal(h.context.partnerInlineBusy,false);
 assert.equal(h.calls.save,0,"opening history must never write or overwrite a version");
});

test("unsaved two-column entries are never discarded without consent",async()=>{
 const h=makeHarness({unsaved:true,acceptDiscard:false});
 await h.context.openHistory(h.id,h.date);
 assert.equal(h.calls.confirm,1);
 assert.equal(h.calls.reads,0);
 assert.equal(h.context.partnerInlineData,h.initial);
 assert.equal(h.context.partnerSameAppSelectedPanel,"history");
});

test("disabled or invisible historical staff never bypasses existing save role checks",async()=>{
 const h=makeHarness({fresh:{staff:[{id:"staff_linkth_1",active:false,kind:"account",uid:"user1"}]}});
 await h.context.openHistory(h.id,h.date);
 assert.equal(h.calls.reads,1);
 assert.equal(h.context.partnerInlineData,h.initial);
 assert.equal(h.context.partnerSameAppSelectedPanel,"history");
 assert.equal(h.calls.status.at(-1).bad,true);
});

test("member can only open their own current account entry",async()=>{
 const h=makeHarness({fresh:{
  role:"member",staff:[{id:"staff_linkth_1",active:true,kind:"account",uid:"different_uid"}]
 }});
 await h.context.openHistory(h.id,h.date);
 assert.equal(h.context.partnerInlineData,h.initial);
 assert.equal(h.calls.status.at(-1).bad,true);
});

test("history cards offer direct edit action and preserve audit snapshots",()=>{
 assert.match(html,/id="partnerPanelHistory"[\s\S]{0,270}この実績を修正/);
 const history=source.slice(source.indexOf("async function loadPartnerRevisionHistory()"),
  source.indexOf("async function partnerInlineFetch()"));
 assert.match(history,/edit\.onclick=\(\)=>void partnerInlineOpenHistoryCorrection\(event\.staffId,date\)/);
 assert.match(history,/event\.version!==latest\.version/);
 assert.match(history,/履歴として保持/);
 assert.doesNotMatch(history,/submitPartnerWorkspaceCounts|partnerInlineSave\(/);
 assert.match(source,/const expected=\{date,staffId,counts,cbCounts,workLocation,workTeamId,/);
 assert.match(source,/expectedVersion:before\?\.version\?\?0/);
});

test("both HQ and partners use a single redacted count-only ranking API",()=>{
 assert.match(source,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(source,/const readPartnerWorkDay = httpsCallable\(partnerCountFunctions,"getPartnerWorkspace"\)/);
 assert.match(source,/const payload=\{date,sharedRankings:true\}/);
 assert.match(source,/if\(partner&&partnerInlineWorkspaceCompany\)/);
 assert.match(source,/const partnerSum=response\.companies\.reduce/);
 assert.match(source,/companyRows\.push\(\{name:"🏢 直営",count:internal\.totalCount\}\)/);
 assert.match(source,/const productTotals=new Map\(categories\.map\(k=>\[k,response\.productCounts\[k\]\+internal\.counts\[k\]\]\)\)/);
 assert.match(source,/const partnerRankings=\{/);
 assert.match(source,/renderPartnerFlatTeamDetails\(content,response\)/);
 assert.match(source,/renderSharedCountTeamDetails\(content,response\)/);
});
