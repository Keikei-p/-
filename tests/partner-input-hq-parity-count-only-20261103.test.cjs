"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
const between=(start,end)=>{
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"source contract missing "+start);
 return html.slice(a,b);
};
const countParser=between("function partnerCountInputNumber(input){","function updatePartnerExtraTotals(){");
const entryRenderer=between("function renderPartnerEntryTotals(){","function partnerInlineRenderCounts(){");
const extraRenderer=between("function updatePartnerExtraTotals(){","function renderPartnerExtra(){");
function input(dataset,value){return {dataset,value:String(value)};}
function harness({extraReady=true,additional="4",archived=3}={}){
 const records=extraReady?[{staffId:"u1",archivedTotal:archived,totalCount:archived+4}]:[];
 const nodes={
  pInlineEntryTotals:{textContent:""},
  pInlineSaveStatus:{textContent:""},
  pInlineStaff:{value:"u1"},
  pInlineExtraTotals:{textContent:""},
  pInlineExtraSave:{disabled:false},
  pInlineCountFields:{
   querySelectorAll:()=>[
    input({cbTier:"0"},"2"),input({cbTier:"20000"},"3"),
    input({countKey:"SBMNP"},"1"),input({privateCountId:"p1"},"2")
   ],
   querySelector:()=>nodes.cbTitle
  },
  pInlineExtraFields:{querySelectorAll:()=>[input({extraId:"extraA"},additional)]},
  cbTitle:{textContent:""},
 };
 const ctx={
  pInline:id=>nodes[id],
  partnerExtra:{records},partnerExtraBusy:false,partnerInlineBusy:false,
  partnerExtraValid:()=>extraReady,partnerInlineHasUnsavedCounts:()=>false
 };
 vm.runInNewContext(countParser+extraRenderer+entryRenderer+
  "\nthis.render=renderPartnerEntryTotals;this.refreshExtra=updatePartnerExtraTotals;"+
  "this.parse=partnerCountInputNumber;",ctx);
 return {nodes,ctx};
}
test("the original HQ form and the partner form both use responsive two-column compact product cards",()=>{
 assert.match(html,/\.product-input-list\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2/);
 assert.match(html,/#partnerInlineWorkspace #pInlineCountFields\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/#partnerInlineWorkspace #pInlineExtraFields\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/id="pInlineExtraFields" class="product-input-list"/);
 assert.match(html,/id="pInlineCountFields" class="product-input-list"/);
 assert.match(html,/className="p-inline-field product-input-group product-input-group--compact"/);
 assert.match(html,/className="product-plan-input"/);
});
test("count inputs reject blank, exponent, decimal, negative and overflow rather than guessing zero",()=>{
 const {ctx}=harness();
 for(const [text,expected] of [["0",0],["5",5],["9999",9999],["",null],[" ",null],
  ["1e2",null],["-1",null],["1.5",null],["10000",null]]){
  assert.equal(ctx.parse(input({},text)),expected,text);
 }
});
test("the unified per-person daily total includes original, CB, private, extra and archived verified quantities",()=>{
 const {ctx,nodes}=harness();
 ctx.render();
 assert.match(nodes.pInlineEntryTotals.textContent,/入力中の合計 15件/);
 assert.match(nodes.pInlineEntryTotals.textContent,/通常 6件・専用 2件・追加 4件・過去の追加商材 3件/);
 assert.match(nodes.cbTitle.textContent,/NURO光｜CB別件数（合計 5件）/);
 assert.doesNotMatch(nodes.pInlineEntryTotals.textContent,/単価|売上|利益|revenue/i);
});
test("unverified additional-product read cannot be rendered as a zero or a verified grand total",()=>{
 const {ctx,nodes}=harness({extraReady:false});
 ctx.render();
 assert.match(nodes.pInlineEntryTotals.textContent,/追加商材 未確認/);
 assert.match(nodes.pInlineEntryTotals.textContent,/全体合計は保留/);
 assert.doesNotMatch(nodes.pInlineEntryTotals.textContent,/入力中の合計/);
});
test("empty added-product input blocks the verified grand total and disables independent save",()=>{
 const {ctx,nodes}=harness({additional:""});
 ctx.refreshExtra();
 assert.match(nodes.pInlineExtraTotals.textContent,/件数を確認/);
 assert.match(nodes.pInlineEntryTotals.textContent,/全体合計は保留/);
 assert.equal(nodes.pInlineExtraSave.disabled,true);
});
test("historical quantities survive zero-report UX; no implicit extra-ledger reset",()=>{
 const source=between('pInline("pInlineZero").onclick=()=>{','pInline("pInlineAddTeam").onclick=');
 assert.match(source,/if\(!partnerExtraValid\(\)\)/);
 assert.match(source,/if\(partnerExtraDirty\(\)\)/);
 assert.match(source,/extraSaved\?\.totalCount/);
 assert.match(source,/input\[data-private-count-id\]\[readonly\]/);
 assert.doesNotMatch(source,/writePartnerAdditionalCounts|(?:tx\.)?delete\(/);
});
test("independent ledger writes retain verified readbacks, draft protection, and explicit two-step labeling",()=>{
 const basic=between('pInline("pInlineSave").onclick=()=>{','// Original internal owner sees existing teams');
 const extra=between("async function savePartnerExtra(){",'pInline("pInlineExtraSave").onclick=');
 assert.match(basic,/partnerInlineCountsUnchanged/);
 assert.match(basic,/partnerSavedCountReadbackState\(verified,expected\)/);
 assert.match(extra,/readPartnerAdditionalCounts\(partnerInlinePayload\(\{date\}\)\)/);
 assert.match(extra,/verified\?\.version===before\+1/);
 assert.match(html,/通常・専用商材を保存（訂正）/);
 assert.match(html,/通常・専用商材を登録/);
 assert.match(html,/保存先が別です/);
 assert.match(html,/追加商材の件数を保存/);
 assert.doesNotMatch(basic,/tx\.delete|clear\(\)/);
});
