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

test("partner local leaderboard uses same ranks, separates zero from unreported and keeps retired history",()=>{
 const block=extract(index,"function partnerInlineRender(){",
  "\nasync function partnerInlineFetch(){");
 const elements=new Map();
 const box=id=>{
  if(!elements.has(id))elements.set(id,{
   hidden:false,disabled:false,textContent:"",value:"",
   children:[],replaceChildren(){this.children=[];},
   append(child){this.children.push(child);}
  });
  return elements.get(id);
 };
 const counts=(extra={})=>({...zero(),...extra});
 const state={role:"member",companyName:"協力店A",
  categories:KEYS,enabledCategories:["NURO","SBMNP"],
  teams:[
   {id:"t1",name:"1班",active:true},
   {id:"t2",name:"2班",active:true},
   {id:"t3",name:"3班",active:true}
  ],
  staff:[
   {id:"p1",name:"甲",teamId:"t1",active:true},
   {id:"p2",name:"乙",teamId:"t1",active:true},
   {id:"p3",name:"丙",teamId:"t2",active:true},
   {id:"p4",name:"未報告者",teamId:"t1",active:true},
   {id:"p5",name:"退職者",teamId:"t2",active:false}
  ],
  records:[
   {staffId:"p1",teamIdSnapshot:"t1",counts:counts({NURO:2,"SB光・AIR":7})},
   {staffId:"p2",teamIdSnapshot:"t1",counts:counts({SBMNP:2})},
   {staffId:"p3",teamIdSnapshot:"t2",counts:counts()},
   {staffId:"p5",teamIdSnapshot:"t2",counts:counts()}
  ]
 };
 const sandbox={
  partnerInlineData:state,
  pInline:box,
  document:{createElement(tag){return {tag,textContent:""};}},
  partnerMainAppendRow:(target,name,description)=>{
   target.children.push({name,description});
  },
  partnerInlineFillSelect:()=>{},
  partnerInlineRenderCounts:()=>{},
  mountSameAppJointMonth:()=>{}
 };
 vm.runInNewContext(block+"\nthis.render=partnerInlineRender;",sandbox,
  {timeout:1000});
 sandbox.render();
 const output=box("pInlineRanking").children;
 const rows=output.filter(r=>r.name);
 assert(output.some(x=>x.textContent==="班別（当日・協力店内）"));
 assert(output.some(x=>x.textContent==="個人別（当日・協力店内）"));
 assert(output.some(x=>x.textContent==="商材別（公開ON・当日）"));
 assert(rows.some(x=>x.name==="1位 甲"&&x.description==="2件"));
 assert(rows.some(x=>x.name==="1位 乙"&&x.description==="2件"),
  "equal personal count must share first rank");
 assert(!rows.some(x=>x.name==="2位 乙"||x.name==="2位 甲"));
 assert(rows.some(x=>x.name==="3位 丙"&&x.description==="0件"));
 assert(rows.some(x=>x.name==="3位 退職者"&&x.description==="0件"),
  "historical inactive staff entry must remain visible");
 assert(rows.some(x=>x.name==="未報告者"&&x.description==="未報告"));
 assert(rows.some(x=>x.name==="協力店A・3班"&&x.description==="未報告"));
 assert(rows.some(x=>x.name==="2位 協力店A・2班"&&x.description==="0件"));
 assert(rows.some(x=>x.name==="1位 NURO"&&x.description==="2件"));
 assert(rows.some(x=>x.name==="1位 SBMNP"&&x.description==="2件"));
 assert(!rows.some(x=>x.name.includes("SB光・AIR")||x.description.includes("7件")),
  "OFF history must not appear in partner leaderboard");
});

test("hub company team UI displays unverified and not-reported warnings instead of a fake 0 total",async()=>{
 const start=index.indexOf('button.textContent="班別件数を確認";');
 assert(start>=0,"existing company management team button must be present");
 const from=index.indexOf("button.onclick=async()=>{",start);
 const to=index.indexOf("card.append(button,details);",from);
 assert(from>start&&to>from,"reviewed Owner-only team detail handler exists");
 const handler=index.slice(from,to);
 for(const scenario of [
  {status:"submitted",unreconciled:true,expected:"照合できません",hasRows:false},
  {status:"not_reported",unreconciled:false,expected:"未報告です",hasRows:false},
  {status:"submitted",unreconciled:false,expected:"1班：報告済み 0件",hasRows:true}
 ]){
  const details={
   textContent:"",children:[],
   replaceChildren(){this.children=[];this.textContent="";},
   append(child){this.children.push(child);}
  };
  const button={disabled:false};
  const sandbox={button,details,company:{partnerCompanyId:"partner"},
   date:"2026-10-31",stillOwner:()=>true,
   document:{createElement:()=>({textContent:""})},
   readPartnerWorkDay:async()=>({data:{
    role:"hub",partnerTeamDetails:{
     partnerCompanyId:"partner",scope:"shared_counts_only",
     companyReportStatus:scenario.status,
     unreconciledWithCompanyReport:scenario.unreconciled,
     unverifiedTeamCount:0,teams:[{name:"1班",totalCount:0}]
    }}})
  };
  vm.runInNewContext(handler,sandbox,{timeout:1000});
  await button.onclick();
  const displayed=[details.textContent,
   ...details.children.map(x=>x.textContent)].join(" ");
  assert(displayed.includes(scenario.expected),scenario.expected);
  assert.equal(details.children.length,scenario.hasRows?1:0,
   "incomplete company count cannot be rendered as a ranked 0 row");
  assert.equal(button.disabled,false,"loading guard always resets");
  assert(!displayed.includes("売上")&&!displayed.includes("単価"));
 }
});


test("standalone partner month rankings reject a hub Owner response even after a valid partner sign-in",()=>{
 const standalone=extract(partner,
  "async function mountVerifiedJointMonthForPartner(){",
  "\nlet approvedRankGeneration=");
 assert.match(standalone,/data\?\.role!==["']owner["']/);
 assert.match(standalone,/expectedRole:["']partner_owner["']/,
  "server response role must be partner_owner, not a browser role claim");
 assert.doesNotMatch(standalone,/expectedRole:["']hub_owner["']/);
 const sameApp=extract(index,
  "async function mountSameAppJointMonth(audience){",
  "\nlet partnerInlineData=");
 assert.match(sameApp,/expectedRole:audience===["']hub["']\?["']hub_owner["']:["']partner_owner["']/);
 assert.match(partner,/const NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false/);
 assert.match(index,/const NICO_SAME_APP_JOINT_COUNT_MONTH_RELEASED=false/);
});
