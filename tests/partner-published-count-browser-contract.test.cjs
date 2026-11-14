"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const index=fs.readFileSync("index.html","utf8");
const partner=fs.readFileSync("partner-workspace.html","utf8");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const section=(src,start,end)=>{
 const a=src.indexOf(start);
 const b=src.indexOf(end,a+start.length);
 assert(a>=0&&b>a,"Expected inspected original browser handler: "+start);
 return src.slice(a,b);
};
test("same-app partner input shows ONLY server approved ON categories and zeroes OFF in save",()=>{
 const render=section(index,"function partnerInlineRenderCounts(){",
  "function partnerInlineRender(){");
 const save=section(index,'pInline("pInlineSave").onclick=()=>partnerInlineRun(async()=>{',
  "const wireCounts=Object.fromEntries");
 const fetch=section(index,"async function partnerInlineFetch(){",
  "partnerInlineStatus(\"最新の件数");
 assert(render.includes("const enabledKeys=snap.enabledCategories??snap.categories"));
 assert(render.includes("for(const key of enabledKeys)"));
 assert(render.includes("snap.enabledCategories?.length===0"));
 assert(save.includes("const enabledKeys=snap.enabledCategories??snap.categories"));
 assert(save.includes('if(!enabledKeys.includes(key)){counts[key]=0;continue;}'));
 assert(!save.includes("parsedCb")&&!save.includes("wireCbCounts"));
 assert(!save.includes("cbCounts:"));
 assert(!render.includes("input.dataset.cbTier")&&!render.includes("CB0円"),
  "Partner must enter NURO count without money-tier fields");
 assert(fetch.includes("snap.enabledCategories.some(key=>!snap.categories.includes(key))"));
 assert(!save.includes("counts={...before?.counts}"),
  "No browser-side reconstruction of unpublished saved history");
});
test("standalone partner page disables OFF inputs and emits zero for all nine keys",()=>{
 const valuesSrc=section(partner,"function values(){","function privateValues(){");
 const input=KEYS.map((key,i)=>({dataset:{key},value:i===0?"3":"7",
  disabled:i!==0}));
 const sandbox={grid:{querySelectorAll:()=>input}};
 vm.runInNewContext(valuesSrc+"\nthis.read=values;",sandbox,{timeout:1000});
 const result=sandbox.read();
 assert.deepEqual(Object.keys(result).sort(),KEYS.slice().sort());
 assert.equal(result.NURO,3);
 for(const key of KEYS.slice(1))assert.equal(result[key],0,
  "hidden old history cannot be sent from browser: "+key);
 input[0].value="not a number";
 assert.throws(()=>sandbox.read(),/invalid count/);
 const render=section(partner,"function renderSelected(){",
  '$("hubTeamCompanySelect").onchange=');
 assert(render.includes("const published=data.enabledCategories??KEYS"));
 assert(render.includes("x.disabled=!allowed"));
 assert(render.includes("x.parentElement.hidden=!allowed"));
 assert(render.includes('published.length===0'));
 const refresh=section(partner,"async function refresh(){",
  '$("date").onchange=');
 assert(refresh.includes("res.enabledCategories.some(key=>!KEYS.includes(key))"));
});
test("both screens keep financial originals and published switch disabled",()=>{
 assert(index.includes('partnerInlineSave = httpsCallable(partnerCountFunctions,"submitPartnerWorkspaceCounts")'));
 assert(index.includes("partnerInlineRenderCounts()"));
 assert(partner.includes('get=call("getPartnerWorkspace")')||
        partner.includes('getPartnerWorkspace'));
 assert(!index.includes("NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED = true"));
 assert(!partner.includes("NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=true"));
});
