"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const index=fs.readFileSync("index.html","utf8");
const partner=fs.readFileSync("partner-workspace.html","utf8");
function extract(source,start,end){
 const a=source.indexOf(start);
 assert(a>=0,"missing reviewed UI handler start");
 assert.equal(source.indexOf(start,a+1),-1,"ambiguous UI handler start");
 const b=source.indexOf(end,a+start.length);
 assert(b>a,"missing reviewed UI handler end");
 return source.slice(a,b);
}

test("same-app partner save never re-sends hidden OFF historical counts",async()=>{
 const handler=extract(index,
  'pInline("pInlineSave").onclick=()=>partnerInlineRun(async()=>{',
  '\n// Original internal owner');
 const original={...zero(),NURO:2,SBMNP:7};
 const page={
  pInlineSave:{},
  pInlineStaff:{value:"staff"},
  pInlineDate:{value:"2026-10-31"},
  pInlineCountFields:{querySelectorAll:()=>[
   {dataset:{countKey:"NURO"},value:"5"}]}
 };
 const saved=[];
 const snapshot={staff:[{id:"staff",active:true}],categories:KEYS,
  enabledCategories:["NURO"],
  records:[{staffId:"staff",counts:{...original},version:1}]};
 const sandbox={
  pInline:key=>{assert(page[key], "unknown element "+key);return page[key];},
  partnerInlineData:snapshot,
  partnerInlineRun:fn=>fn(),
  partnerInlinePayload:x=>x,
  partnerInlineSave:async x=>{saved.push(x);return {data:{version:2}};},
  readPartnerWorkDay:async()=>({data:{records:[
   {staffId:"staff",version:2,counts:saved[0].counts}]}})
 };
 vm.runInNewContext(handler,sandbox,{timeout:1000});
 const output=await page.pInlineSave.onclick();
 assert.match(output,/保存/);
 assert.equal(saved.length,1);
 assert.equal(saved[0].expectedVersion,1);
 assert.deepEqual(Object.keys(saved[0].counts).sort(),KEYS.slice().sort());
 assert.equal(saved[0].counts.NURO,5);
 assert.equal(saved[0].counts.SBMNP,0,"OFF count must be server-restored, not client-sent");
 assert.equal(snapshot.records[0].counts.SBMNP,7,"original record is never mutated");
});

test("standalone partner page zeros hidden OFF inputs but retains nine-key contract",()=>{
 const valuesSource=extract(partner,"function values(){","\nfunction privateValues()");
 const inputs=KEYS.map(key=>({dataset:{key},value:key==="NURO"?"3":"0",
  disabled:key!=="NURO"}));
 inputs[1].value="7"; // Historical OFF value must not leave the browser.
 const grid={querySelectorAll:()=>inputs};
 const sandbox={grid};
 vm.runInNewContext(valuesSource+"\nthis.values=values;",sandbox,{timeout:1000});
 const counts=sandbox.values();
 assert.equal(Object.keys(counts).length,KEYS.length);
 assert.equal(counts.NURO,3);
 assert.equal(counts.SBMNP,0);
 inputs[0].value="bad";
 assert.throws(()=>sandbox.values(),/invalid count/);
});

test("both partner pages use server enabledCategories and protect disabled saves",()=>{
 assert(index.includes("snap.enabledCategories??snap.categories"));
 assert(index.includes("snap.enabledCategories?.length===0"));
 assert(partner.includes("data.enabledCategories??KEYS"));
 assert(partner.includes("data.enabledCategories?.length===0"));
 assert(partner.includes("input.disabled=!allowed;input.parentElement.hidden=!allowed"));
 assert(!index.includes("Object.assign(Object.create(null),before?.counts"),
  "UI must not re-send legacy OFF count history");
});
