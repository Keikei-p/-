import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const owner=readFileSync(new URL("../ranking/owner-product-visibility-panel.mjs",import.meta.url),"utf8");
const server=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const index=readFileSync(new URL("../functions-partner-workspace/index.js",import.meta.url),"utf8");
const marker="const sbSeparateActive=()=>",from=html.indexOf(marker),to=html.indexOf("function privateValues()",from);
if(from<0||to<0)throw Error("SPLIT_MOBILE_SOURCE_NOT_FOUND");
const code=html.slice(from,to);
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
function fixture({date="2026-11-18",on=true,split=true,light="2",air="3",legacy=5}={}){
 const inputs=KEYS.map(key=>({dataset:{key},disabled:key==="SB光・AIR"&&split,
  value:key==="SB光・AIR"?String(legacy):"0"}));
 const grid={querySelectorAll:()=>inputs};
 const ctx={Number,Error,Object,KEYS,grid,sbLegacyCount:legacy,
  sbInputs:{"SB光":{value:light},"SB AIR":{value:air}},
  data:{sbSeparateInputEnabled:split,
   enabledCategories:on?KEYS:KEYS.filter(k=>k!=="SB光・AIR")},
  $:key=>key==="date"?{value:date}:{value:""}
 };
 runInNewContext(code+";globalThis.testValues=values;globalThis.testSplit=sbForSave;",ctx);
 return {values:()=>ctx.testValues(),breakdown:()=>ctx.testSplit(),ctx};
}
test("new 光2 AIR3 with historic combined 5 reports exactly 10 to existing key",()=>{
 const f=fixture();
 assert.equal(f.values()["SB光・AIR"],10);
 assert.deepEqual(JSON.parse(JSON.stringify(f.breakdown())),{"SB光":2,"SB AIR":3,"旧未分類":5});
 assert.deepEqual(Object.keys(f.values()).sort(),KEYS.slice().sort());
});
test("date before start has old 5 in one combined field; no split",()=>{
 const f=fixture({date:"2026-11-17"});
 assert.equal(f.values()["SB光・AIR"],5);
 assert.equal(f.breakdown(),null);
});
test("server flag OFF gives legacy combined input unchanged",()=>{
 const f=fixture({split:false});
 assert.equal(f.values()["SB光・AIR"],5);
 assert.equal(f.breakdown(),null);
});
test("published OFF does not submit a fabricated split/unknown count",()=>{
 const f=fixture({on:false,legacy:5});
 assert.equal(f.values()["SB光・AIR"],0);
 assert.equal(f.breakdown(),null);
});
test("invalid separate input fails, never silently rounds or clamps counts",()=>{
 for(const bad of ["-1","1.5","10000","2円","Infinity","NaN",""]){
  const f=fixture({light:bad});
  assert.throws(()=>f.values(),/invalid separated SB count/);
 }
});
test("count payload strictly adds per-person breakdown only after server advertises input gate",()=>{
 assert.match(html,/data\?\.sbSeparateInputEnabled===true/);
 assert.match(html,/const payload=\{date,staffId,counts,privateCounts/);
 assert.match(html,/if\(sbBreakdown\)payload\.sbBreakdown=sbBreakdown/);
 assert.match(html,/check\.sbBreakdown\?\.\[k\]!==sbBreakdown\[k\]/);
 assert.match(server,/planSplitWrite\(\{date,/);
 assert.match(server,/priorBreakdown:old\.sbBreakdown/);
 assert.match(server,/sbBreakdown:splitPlan\.breakdown/);
 assert.match(index,/NICO_PARTNER_LIGHT_AIR_SPLIT_ENABLED==="enabled"/);
 assert.match(index,/NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/);
});
test("ranking still uses original nine combined categories and old history untouched",()=>{
 const source=readFileSync(new URL("../functions-partner-workspace/shared-count-standings.cjs",import.meta.url),"utf8");
 assert.match(source,/const KEYS=Object\.freeze\(\["NURO".*"SB光・AIR".*"U-NEXT"\]\)/);
 assert.doesNotMatch(source,/SB光\"\s*,\s*\"SB AIR/);
 assert.match(server,/counts:effectiveCounts,totalCount:effectiveTotal/);
 assert.match(server,/summaryRef\(s\.hubId,date,s\.cid\)/);
 assert.doesNotMatch(html,/\bgetFirestore\(|firebase-firestore\.js/);
});
test("Owner primary switches list only current products, archived history remains accessible",()=>{
 assert.match(owner,/const primary=view\.products\.filter\(p=>p\.active\)/);
 assert.match(owner,/const historical=view\.products\.filter\(p=>!p\.active\)/);
 assert.match(owner,/el\(document,"details"\)/);
 assert.match(owner,/if\(product\.active\)page\.appendChild\(label\)/);
 assert.match(owner,/else archived\?\.appendChild\(label\)/);
 assert.match(owner,/旧商材・取扱終了/);
});
