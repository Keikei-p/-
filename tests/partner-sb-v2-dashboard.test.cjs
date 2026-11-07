"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const original=fs.readFileSync(path.join(__dirname,"../partner-workspace.html"),"utf8");
const staged=fs.readFileSync(path.join(__dirname,"../staging/partner-sb-v2/partner-workspace.html"),"utf8");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
  "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const legacy="SB光・AIR",PARTS=["SB光","SB AIR","旧未分類"];
const fn=name=>{
 const start=staged.indexOf("function "+name+"(");
 assert(start>=0,"required staged function: "+name);
 const end=staged.indexOf("\n}",start);
 assert(end>start);
 return staged.slice(start,end+2);
};
const context=vm.createContext({Date,Number,Object,Map,Set,KEYS,
 SB_LEGACY:legacy,SB_PARTS:PARTS});
vm.runInContext([
 fn("resolvedSbSplit"),
 fn("summarizeCountOnlyResponses"),
 fn("groupedProductCounts")
].join("\n"),context);

function count(changes={}){
 return Object.fromEntries(KEYS.map(k=>[k,changes[k]||0]));
}
function row(uid,combined,sbBreakdown){
 return {staffId:uid,counts:count({[legacy]:combined}),totalCount:combined,
  teamIdSnapshot:"team",
  ...(sbBreakdown?{sbBreakdown}:{})};
}
function day(date,records,{v2=true}={}){
 return {role:"owner",date,
  staff:[{id:"a",name:"担当A"},{id:"b",name:"担当B"}],
  records,categories:KEYS,
  ...(v2?{sbBreakdownSchema:"sb-separated-v1"}:{})};
}
function summarize(...days){
 return context.summarizeCountOnlyResponses(days,
  [{id:"team",name:"通信班"}],KEYS);
}
test("production page remains byte-identical base (no hidden premature version switch)",()=>{
 assert.match(original,/const KEYS=\["NURO"/);
 assert.doesNotMatch(original,/id="sbSplitBox"/);
 assert.match(staged,/id="sbSplitBox"/);
 assert.match(staged,/sbBreakdownSchema==="sb-separated-v1"/);
 assert.match(staged,/if\(supportsSbSplit\(\)\)syncSbCombined\(\)/);
 assert.match(staged,/SB_PARTS\.some\(k=>check\.sbBreakdown\?\.\[k\]/);
});
test("v2 counts: previous combined 5 are 5 unknown, never fabricated as hikari/Air",()=>{
 const result=summarize(day("2026-11-07",[row("a",5)]));
 assert.equal(result.total,5);
 assert.equal(result.products["SB光"],0);
 assert.equal(result.products["SB AIR"],0);
 assert.equal(result.products["旧未分類"],5);
 assert.equal(result.products[legacy],undefined);
 assert.equal(result.groups[0].count,5);
 assert.equal(result.people[0].count,5);
 assert.equal(result.teamProducts[0].products["旧未分類"],5);
});
test("v2 counts: verified hikari 2/Air 3 and unknown 5 total exactly 10",()=>{
 const old=day("2026-11-06",[row("a",5)]);
 const newer=day("2026-11-07",[row("b",5,
  {"SB光":2,"SB AIR":3,"旧未分類":0})]);
 const raw=JSON.stringify([old,newer]);
 const result=summarize(old,newer);
 assert.equal(result.total,10);
 assert.equal(result.products["SB光"],2);
 assert.equal(result.products["SB AIR"],3);
 assert.equal(result.products["旧未分類"],5);
 assert.equal(result.products[legacy],undefined);
 assert.equal(Object.values(result.products).reduce((sum,n)=>sum+n,0),10);
 assert.equal(result.groups[0].count,10);
 assert.equal(result.teamProducts[0].products["SB光"],2);
 assert.equal(result.teamProducts[0].products["SB AIR"],3);
 assert.equal(result.teamProducts[0].products["旧未分類"],5);
 assert.equal(JSON.stringify([old,newer]),raw,"dashboard must be read-only");
});
test("legacy server without schema keeps original combined key and saved value untouched",()=>{
 const old=day("2026-11-07",[row("a",5)],{v2:false});
 const result=summarize(old);
 assert.equal(result.total,5);
 assert.equal(result.products[legacy],5);
 assert.equal(result.products["SB光"],undefined);
 assert.equal(result.products["旧未分類"],undefined);
});
test("mixed v1/v2 responses in one ranking and wrong partition abort with no partial totals",()=>{
 const old=day("2026-11-06",[row("a",5)],{v2:false});
 const newer=day("2026-11-07",[row("b",5)]);
 assert.throws(()=>summarize(old,newer),/mixed_sb_schema/);
 assert.throws(()=>summarize(day("2026-11-07",[row("a",5,
  {"SB光":4,"SB AIR":3,"旧未分類":0})])),/sb_count_mismatch/);
});
test("staged UI does not fetch money or auto-rewrite legacy category in database",()=>{
 assert.doesNotMatch(staged,/firebase-firestore\.js|getFirestore\(|getDoc\(|getDocs\(|\brevenuePerUnit\b|\btotalRevenue\b|\bunitPrice\b/);
 assert.doesNotMatch(staged,/migrateLegacy|batchUpdate|deleteDoc\(/);
 assert.match(staged,/\$\("sbSplitBox"\)\.hidden=!sbMode/);
 assert.match(staged,/旧件数は勝手に振り分けません/);
});
