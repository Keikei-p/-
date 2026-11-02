import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const moduleText=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||html;
const a=moduleText.indexOf("function partnerSavedCountReadbackState(");
const b=moduleText.indexOf("function partnerCountSaveFailureMessage(",a);
assert.ok(a>=0&&b>a,"reconciliation must run before the save error UI");
const ctx={PARTNER_NURO_CB_TIERS:["0","20000","40000","60000","80000","unclassified"]};
vm.runInNewContext(moduleText.slice(a,b)+";globalThis.check=partnerSavedCountReadbackState;",ctx);
const check=ctx.check;
const categories=["NURO","SBMNP"];
const expected={
 date:"2026-11-02",companyName:"協力店",staffId:"staff1",expectedVersion:0,
 workTeamId:"team1",workLocation:"催事",categories,privateCounts:{},
 counts:{NURO:2,SBMNP:1},cbCounts:{NURO:{"0":1,"20000":1}}
};
const row={staffId:"staff1",version:1,teamIdSnapshot:"team1",workLocation:"催事",
 totalCount:3,counts:{NURO:2,SBMNP:1},cbCounts:{NURO:{"0":1,"20000":1}},privateCounts:{}};
const view=(r,over={})=>({date:expected.date,companyName:expected.companyName,records:r,...over});

test("confirmed original version 0 save is recognized by verified GET only",()=>{
 assert.equal(check(view([row]),expected),"saved");
});
test("lack of first entry is confirmed not saved; no speculation",()=>{
 assert.equal(check(view([]),expected),"not_saved");
});
test("same old version on edit means no new correction was saved",()=>{
 assert.equal(check(view([{...row,version:1}]),{...expected,expectedVersion:1}),"not_saved");
});
test("count CB and location mismatches always remain unknown rather than confirmed",()=>{
 assert.equal(check(view([{...row,cbCounts:{NURO:{"0":2}}}]),expected),"unknown");
 assert.equal(check(view([{...row,workLocation:"別現場"}]),expected),"unknown");
 assert.equal(check(view([{...row,totalCount:5}]),expected),"unknown");
 assert.equal(check(view([{...row,version:2}]),expected),"unknown");
});
test("wrong date/company response, invalid payload or zero list is never success",()=>{
 assert.equal(check(view([row],{date:"2026-11-01"}),expected),"unknown");
 assert.equal(check(view([row],{companyName:"別会社"}),expected),"unknown");
 assert.equal(check(null,expected),"unknown");
 assert.equal(check(view(null),expected),"unknown");
});
test("an unchanged private count or extra private count mismatch never hides a revision",()=>{
 const e={...expected,privateCounts:{custom:2}};
 const r={...row,privateCounts:{custom:2}};
 assert.equal(check(view([r]),e),"saved");
 assert.equal(check(view([{...r,privateCounts:{custom:1}}]),e),"unknown");
});
test("code never retries submit automatically, writes remain one operation, and keeps input on failed verification",()=>{
 const start=moduleText.indexOf('pInline("pInlineSave").onclick=()=>partnerInlineRun(');
 const end=moduleText.indexOf("// Original internal owner sees existing teams PLUS partner-company teams.",start);
 assert.ok(start>0&&end>start);
 const handler=moduleText.slice(start,end);
 assert.equal(handler.split("await partnerInlineSave(").length-1,1);
 assert.ok(handler.includes("await readPartnerWorkDay("));
 assert.ok(handler.includes('if(readback==="not_saved"){'));
 assert.ok(handler.includes('throw saveError;'));
 assert.ok(handler.includes('throw Error("save_not_committed");'));
 assert.ok(moduleText.includes("保存結果を確認できませんでした"));
 assert.ok(moduleText.includes("入力は保持しています"));
 assert.match(moduleText,/function partnerCountSaveFailureMessage/);
});

test("verified noncommit preserves original Firebase failure code for diagnosis",()=>{
 const a=moduleText.indexOf("function partnerCountSaveFailureMessage(");
 const b=moduleText.indexOf("async function partnerInlineRun(",a);
 assert.ok(a>0&&b>a);
 const context={};
 vm.runInNewContext(moduleText.slice(a,b)+";globalThis.describe=partnerCountSaveFailureMessage;",context);
 const describe=context.describe;
 assert.match(describe({code:"functions/internal"}),/functions\\/internal/);
 assert.match(describe({code:"functions/unavailable"}),/unavailable/);
 assert.match(describe({code:"functions/permission-denied"}),/認証・権限/);
 assert.match(describe({code:"functions/invalid-argument"}),/件数・NURO/);
 assert.match(describe({code:"functions/not-found"}),/functions\\/not-found/);
 assert.match(describe({message:"save_not_committed"}),/まだ保存されていません/);
});
