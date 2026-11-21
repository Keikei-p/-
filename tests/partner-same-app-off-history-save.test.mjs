/**
 * Same-app partner ON-only correction: the browser sends zero for Owner-OFF
 * categories, while the existing server preserves immutable historic counts.
 * This synthetic isolated test never reads/writes Firebase or sales finance.
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const extract=(from,to)=>{
 const start=html.indexOf(from),end=html.indexOf(to,start);
 assert(start>=0&&end>start,"missing partner-only source "+from);
 return html.slice(start,end);
};
const readback=extract("function partnerSavedCountReadbackState(",
 "function partnerCountSaveFailureMessage(");
const save=extract("function partnerInlineCountsUnchanged(",
 "// Hub Owner-only partner count correction.");
const categories=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const countMap=({nuro=1,combined=4}={})=>Object.fromEntries(
 categories.map(k=>[k,k==="NURO"?nuro:k==="SB光・AIR"?combined:0]));
const base=(nuro=1,combined=4)=>({
 staffId:"worker",version:1,counts:countMap({nuro,combined}),
 privateCounts:{},privateTotalCount:0,totalCount:nuro+combined,
 workLocation:"現場",teamIdSnapshot:"team1"
});
function harness({previous=base(),entered="2",returned,authMode="code",enabled=["NURO"]}={}){
 const date="2026-11-21",calls=[],controls={
  pInlineSave:{},pInlineStaff:{value:"worker"},pInlineDate:{value:date},
  pInlineRecordDate:{value:date},pInlineWorkLocation:{value:"現場"},
  pInlineWorkingTeam:{value:"team1"},
  pInlineCountFields:{querySelectorAll:query=>query==="input[data-count-key]"?
   enabled.map(k=>({dataset:{countKey:k},value:k==="NURO"?entered:"0"})):[]}
 };
 // Server storage is not the same as the partner's count-only GET.
 // Simulate the verified server projection: OFF categories are zeroed and
 // totalCount contains ONLY the published categories.
 const source=previous?structuredClone(previous):null;
 const redact=row=>{
  if(!row)return null;
  const visible=Object.fromEntries(categories.map(k=>[
   k,enabled.includes(k)?row.counts[k]:0
  ]));
  return {...row,counts:visible,
   totalCount:Object.values(visible).reduce((n,v)=>n+v,0)};
 };
 const savedPrivate=previous?.privateCounts??{};
 const serverOriginal={...base(Number(entered),previous?.counts?.["SB光・AIR"]??0),
  version:previous?.version+1||1,privateCounts:{...savedPrivate},
  privateTotalCount:Object.values(savedPrivate).reduce((n,v)=>n+v,0)};
 const server=returned??{date,companyName:"協力店A",
  records:[redact(serverOriginal)]};
 const snap={date,companyName:"協力店A",role:"owner",categories,
  enabledCategories:enabled,teams:[{id:"team1",active:true}],
  staff:[{id:"worker",active:true,teamId:"team1"}],
  privateProducts:[],records:previous?[redact(previous)]:[]};
 const ctx=vm.createContext({
  partnerInlineData:snap,partnerInlineWorkspaceCompany:"",
  pInline:id=>controls[id],
  partnerInlineIdentity:()=>authMode==="code"?"code-session-epoch:1":"email:worker",
  partnerMainValidId:x=>typeof x==="string"&&/^[A-Za-z0-9_-]+$/.test(x),
  partnerInlinePayload:x=>x,
  partnerInlineRun:async(work,options)=>{
   assert.equal(options.kind,"save");return await work();
  },
  partnerMainCountSubmit:async x=>{calls.push({kind:"POST",body:JSON.parse(JSON.stringify(x))});
   return {data:{saved:true,date,staffId:"worker",version:previous?.version+1||1}};
  },
  partnerMainCountRead:async x=>{calls.push({kind:"GET",body:JSON.parse(JSON.stringify(x))});
   return {data:server};
  }
 });
 vm.runInContext(readback+save,ctx);
 return {ctx,snap,source,calls,run:()=>vm.runInContext('pInline("pInlineSave").onclick()',ctx)};
}
test("Owner OFF historical categories do not make an unchanged ON report create a new audit",async()=>{
 for(const mode of ["code","email"]){
  const x=harness({entered:"1",authMode:mode});
  const result=await x.run();
  assert.match(result,/変更がないため訂正履歴は追加していません/);
  assert.deepEqual(x.calls,[],"neither count POST nor readback GET should run");
 }
});
test("Owner ON correction reads back masked OFF counts without modifying the original source",async()=>{
 for(const mode of ["code","email"]){
  const x=harness({authMode:mode});
  assert.match(await x.run(),/実績を修正できました/);
  assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
  const sent=x.calls[0].body.counts;
  assert.equal(sent.NURO,2);
  assert.equal(sent["SB光・AIR"],0,"disabled product is never re-entered");
  assert.equal(x.calls[0].body.expectedVersion,1);
  assert.equal(x.calls[0].body.privateCounts!=null,true);
  assert.deepEqual(x.calls[1].body,{date:"2026-11-21"});
  assert.equal(x.snap.records[0].counts["SB光・AIR"],0,
   "current server GET redacts OFF counts");
  assert.equal(x.snap.records[0].totalCount,1);
  assert.equal(x.source.counts["SB光・AIR"],4,
   "immutable original source stays separate from the public projection");
 }
});
test("redacted GET with inconsistent visible total must fail closed without retry",async()=>{
 const bad={date:"2026-11-21",companyName:"協力店A",records:[{
  ...base(2,0),version:2,totalCount:6,
  counts:countMap({nuro:2,combined:0})
 }]};
 const x=harness({returned:bad});
 await assert.rejects(x.run(),/save_verify/);
 assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"],
  "never perform a second count POST on mismatch");
});
test("an unredacted OFF category cannot pass the count-only GET readback",async()=>{
 const bad={date:"2026-11-21",companyName:"協力店A",records:[{
  ...base(2,4),version:2,counts:countMap({nuro:2,combined:4})
 }]};
 const x=harness({returned:bad});
 await assert.rejects(x.run(),/save_verify/);
 assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
});
test("a partner cannot infer a historical OFF value from the authenticated GET",async()=>{
 const x=harness({previous:base(1,9),entered:"1"});
 assert.match(await x.run(),/変更がないため訂正履歴は追加していません/);
 assert.equal(x.snap.records[0].counts["SB光・AIR"],0);
 assert.equal(x.source.counts["SB光・AIR"],9);
 assert.deepEqual(x.calls,[]);
});
test("retired private product history is retained during ON-only correction",async()=>{
 for(const mode of ["code","email"]){
  const previous=base();
  previous.privateCounts={oldPrivate:7};
  previous.privateTotalCount=7;
  const x=harness({previous,authMode:mode});
  assert.match(await x.run(),/実績を修正できました/);
  assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
  assert.deepEqual(x.calls[0].body.privateCounts,{},
   "the retired category must not be re-entered by the browser");
  assert.equal(x.source.privateCounts.oldPrivate,7);
  assert.equal(x.snap.records[0].privateCounts.oldPrivate,7);
 }
});
test("readback refuses silently lost retired private counts, without a second POST",async()=>{
 const previous=base();
 previous.privateCounts={oldPrivate:7};
 previous.privateTotalCount=7;
 const bad={date:"2026-11-21",companyName:"協力店A",records:[{
  ...base(2,0),version:2,privateCounts:{},privateTotalCount:0
 }]};
 const x=harness({previous,returned:bad});
 await assert.rejects(x.run(),/save_verify/);
 assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
 assert.equal(x.source.privateCounts.oldPrivate,7);
});
test("readback refuses incorrect private total and phantom private IDs",async()=>{
 const previous=base();
 previous.privateCounts={oldPrivate:7};
 previous.privateTotalCount=7;
 for(const badPrivate of [
  {privateCounts:{oldPrivate:7},privateTotalCount:0},
  {privateCounts:{oldPrivate:7,phantom:1},privateTotalCount:8}
 ]){
  const bad={date:"2026-11-21",companyName:"協力店A",records:[{
   ...base(2,0),version:2,...badPrivate
  }]};
  const x=harness({previous,returned:bad});
  await assert.rejects(x.run(),/save_verify/);
  assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
 }
});
test("legacy all-products-ON mode still edits the original full ledger",async()=>{
 const x=harness({previous:base(1,0),enabled:categories});
 assert.match(await x.run(),/実績を修正できました/);
 assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
 assert.equal(x.calls[0].body.counts.NURO,2);
});
test("new first-ever report with OFF categories creates one verified version",async()=>{
 const x=harness({previous:null});
 assert.match(await x.run(),/実績を登録できました/);
 assert.equal(x.calls[0].body.expectedVersion,0);
 assert.equal(x.calls[0].body.counts["SB光・AIR"],0);
 assert.deepEqual(x.calls.map(c=>c.kind),["POST","GET"]);
});
test("the release keeps the existing server immutable-OFF guard and self UI",()=>{
 const server=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
 const fence=readFileSync(new URL("../functions-partner-workspace/submission-publication-guard.cjs",import.meta.url),"utf8");
 assert.match(server,/effectiveCounts\[key\]=prior\[key\]/);
 assert.match(server,/if\(counts\[key\]!==0\)fail\("failed-precondition"\)/);
 assert.match(fence,/if\(!policy\.allowed\.has\(key\)&&after\[key\]!==before\[key\]\)deny\(\)/);
 assert.match(html,/const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;/);
 assert.match(html,/const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;/);
});
