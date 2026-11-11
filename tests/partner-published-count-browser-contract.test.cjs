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

test("Owner correction UI lists saved reports only and cannot submit a new staff day",()=>{
 const ownerBlock=extract(index,
  'function openOwnerPartnerCountEditor(parent,company){',
  '\n// Original internal owner sees existing teams PLUS partner-company teams.');
 assert(ownerBlock.includes('const recorded=new Set(entry.records.filter(row=>'),
  "staff dropdown must exclude unreported staff");
 assert(ownerBlock.includes('recorded.has(p.id)'),
  "only saved entries may be selectable for correction");
 assert(ownerBlock.includes('if(!record||!Number.isSafeInteger(record.version)||record.version<1)return;'),
  "submit must refuse new records without a verified version");
 assert(ownerBlock.includes('expectedVersion:record.version'),
  "submit must carry exact saved version, never an implicit zero");
 assert(!ownerBlock.includes('record?.version??0'),
  "no new staff-day reports in Owner correction UI");
});

test("Owner correction editor excludes unreported staff and retains original login identity",()=>{
 const start=index.indexOf("function openOwnerPartnerCountEditor(");
 const end=index.indexOf("\n// Original internal owner sees",start);
 assert(start>=0&&end>start);
 const owner=index.slice(start,end);
 assert.match(owner,/const initiatingOwnerUid=auth\.currentUser\?\.uid;/);
 assert.match(owner,/auth\.currentUser\?\.uid===initiatingOwnerUid/);
 assert.match(owner,/if\(!record\)\{/);
 assert.match(owner,/recorded\.has\(p\.id\)/);
 assert.match(owner,/if\(!record\|\|!Number\.isSafeInteger\(record\.version\)/);
 assert.match(owner,/ownerPartnerCompanyId:company\.partnerCompanyId/);
 assert.match(owner,/includeOwnerCorrectionEntries:true/);
 assert.doesNotMatch(owner,/signInWithEmailAndPassword|updateDoc\(|deleteDoc\(/);
});

test("joint count dashboard is present in both original audiences but never fetches while hard OFF",async()=>{
 assert.match(index,/id="nicoVerifiedSameAppHubJointMonth" hidden/);
 assert.match(index,/id="nicoVerifiedSameAppPartnerJointMonth" hidden/);
 assert.match(index,/const NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=false;/);
 const start=index.indexOf("const NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=false;");
 const end=index.indexOf("let partnerInlineData=",start);
 assert(start>0&&end>start);
 const sandbox={
  window:{get location(){throw Error("NETWORK_OR_ORIGIN_ACCESSED");}},
  document:{getElementById(){throw Error("DOM_READ_ON_DISABLED_RELEASE");}}
 };
 vm.runInNewContext(index.slice(start,end)+"\nthis.mount=mountSameAppJointMonth;",sandbox,{timeout:1000});
 await sandbox.mount("hub");
 await sandbox.mount("partner");
 assert(!index.includes("NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=true"),
  "browser may not activate its own release gate");
});
