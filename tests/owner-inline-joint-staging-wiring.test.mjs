import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const archive=read("../sales-archive.js");
const index=read("../index.html");
const start=archive.indexOf("const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false;");
assert.ok(start>0,"Owner count integration must remain explicitly OFF");
const staging=archive.slice(start);

test("Owner existing ranking cards and original financial UI stay untouched",()=>{
 for(const id of ["individualRankingContent","productRankingContent","teamRankingContent","dashboardMonth"])
  assert.ok(index.includes('id="'+id+'"'),"Missing original dashboard target "+id);
 assert.ok(staging.includes('const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false'));
 assert.ok(staging.includes('slot.panel'));
 assert.ok(staging.includes('$(slot.panel).append(card)'));
 assert.ok(!staging.includes('getDocsFromServer('));
 assert.ok(!staging.includes('totalRevenue'));
 assert.ok(!staging.includes('recordCorrections'));
 assert.ok(!staging.includes('monthlyRevenue'));
 assert.ok(!staging.includes('individualRankingList.replaceChildren'));
 assert.ok(!staging.includes('teamRankingList.replaceChildren'));
});
test("Owner and partner use same verified count endpoint and strict role/range",()=>{
 const partner=read("../partner-workspace.html");
 assert.ok(staging.includes('expectedRole:"hub_owner"'));
 assert.ok(staging.includes('renderVerifiedInlineJointCards({'));
 assert.ok(staging.includes('period:kind,start:payload.range.start,end:payload.range.end'));
 assert.ok(staging.includes('getVerifiedJointCountRanking'));
 assert.ok(partner.includes("getVerifiedJointCountRanking"));
 assert.ok(staging.includes('monthInput.addEventListener("change"'));
 assert.ok(staging.includes('auth.currentUser!==user'));
 assert.ok(staging.includes("epoch!==generation"));
 assert.ok(staging.includes("companyForOwner(user)"));
 assert.ok(staging.includes('window.location.origin!=="https://nico-factory.web.app"'));
});
test("Owner verified rank never fetches on disabled feature and never removes original dashboard",()=>{
 assert.ok(staging.indexOf("if(NICO_OWNER_INLINE_JOINT_CARDS_RELEASED){")>=0);
 assert.ok(staging.includes("card.hidden=true"));
 assert.ok(staging.includes("roots[key].replaceChildren()"));
 assert.ok(staging.includes("if(epoch===generation)clear()"));
 const standalone=read("../ranking/verified-inline-joint-ranking-cards.mjs");
 assert.ok(standalone.includes("validateVerifiedDualCountDashboard"));
 assert.ok(standalone.includes("expectedRole"));
});

test("programmatic month hydration and save rerender trigger verified refresh, with stale display fallback",()=>{
 assert.ok(staging.includes('const monthlyCount=$("monthlyCount")'));
 assert.ok(staging.includes('new MutationObserver('));
 assert.ok(staging.includes('observer.observe(monthlyCount,{childList:true,characterData:true,subtree:true})'));
 assert.ok(staging.includes('queueMicrotask('));
 assert.ok(staging.includes('oldCardStyle.disabled=true'));
 assert.ok(staging.includes('oldCardStyle.disabled=false'));
 // Exercise the exact production OFF block under a trap for DOM and auth calls.
 // It may not touch any browser functionality, Firebase or HTTP while disabled.
 vm.runInNewContext(staging,{
  document:{getElementById(){throw Error("OFF_DOM_ACCESS")}},
  auth:{get currentUser(){throw Error("OFF_AUTH_ACCESS")}},
  onAuthStateChanged(){throw Error("OFF_AUTH_OBSERVER")},
  MutationObserver:class {constructor(){throw Error("OFF_MUTATION_OBSERVER")}},
  window:{get location(){throw Error("OFF_WINDOW_ACCESS")}}
 });
});
test("enabled staging wiring registers render observer and month/auth hooks without requesting finance",()=>{
 const elements=new Map(),registered=new Map(),observers=[];
 const mk=id=>({
  id,hidden:false,children:[],
  append(...children){this.children.push(...children);},
  replaceChildren(...children){this.children=[...children]},
  setAttribute(){},addEventListener(name,fn){registered.set(id+":"+name,fn)}
 });
 for(const id of ["dashboardMonth","monthlyCount",
   "individualRankingContent","productRankingContent","teamRankingContent"])
  elements.set(id,mk(id));
 const inputs=elements.get("dashboardMonth");
 inputs.value="";
 const fake={
  $:id=>elements.get(id)||null,
  document:{
   getElementById(id){return elements.get(id)||null},
   createElement(tag){return mk(tag)},
   head:mk("head")
  },
  auth:{currentUser:null},
  onAuthStateChanged(_auth,listener){registered.set("auth",listener);return ()=>{}},
  MutationObserver:class {
   constructor(callback){this.callback=callback;observers.push(this)}
   observe(target,options){
    assert.equal(target,elements.get("monthlyCount"));
    assert.equal(options.childList,true);
   }
  },
  queueMicrotask(callback){callback()},
  window:{location:{origin:"https://nico-factory.web.app"}},
  Date,Intl,Promise,console
 };
 // Enable only a sandbox copy; the checked-in flag remains hard-OFF.
 const enabled=staging.replace(
  "const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false;",
  "const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=true;");
 assert.notEqual(enabled,staging);
 vm.runInNewContext(enabled,fake);
 assert.equal(observers.length,1);
 assert.equal(typeof registered.get("auth"),"function");
 assert.equal(typeof registered.get("dashboardMonth:change"),"function");
 assert.equal(elements.get("individualRankingContent").children.length,1);
 assert.equal(elements.get("productRankingContent").children.length,1);
 assert.equal(elements.get("teamRankingContent").children.length,2);
 registered.get("auth")(null);
 inputs.value="2026-11";
 observers[0].callback();
 assert.equal(fake.document.head.children.length,0,
  "No style and no remote fetch before verified real owner auth");
});

test("Owner same-card day/week/month are verified server periods, not new financial computations",()=>{
 assert.ok(staging.includes('for(const [value,label] of [["month","月"],["week","週"],["day","日"]])'));
 assert.ok(staging.includes('period:{kind,day,asOf},filters:countScope==="joint"?{}:{scope:countScope}'));
 assert.ok(staging.includes('period:kind,start:payload.range.start,end:payload.range.end'));
 assert.ok(staging.includes('periodDay.slice(0,7)!==month'));
 assert.ok(staging.includes('periodKind!==kind'));
 assert.ok(staging.includes('monthInput.value!==month'));
 assert.ok(staging.includes('input.hidden=periodKind==="month"'));
 assert.ok(!staging.includes('recordsCollectionQuery('));
 assert.ok(!staging.includes('revenuePerUnit'));
});

test("Owner period selectors change server GET kind, logout and errors clear old rankings",async()=>{
 const nodes=new Map(),actions=new Map(),requests=[],rendered=[],observerCallbacks=[];
 const make=id=>({
  id,hidden:false,children:[],value:"",handlers:{},
  append(...children){this.children.push(...children)},
  replaceChildren(...children){this.children=[...children]},
  setAttribute(){},
  addEventListener(kind,fn){this.handlers[kind]=fn;actions.set(id+":"+kind,fn)}
 });
 for(const id of ["dashboardMonth","monthlyCount",
   "individualRankingContent","productRankingContent","teamRankingContent"])
  nodes.set(id,make(id));
 const nowParts=new Intl.DateTimeFormat("en-US",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(new Date());
 const dt=Object.fromEntries(nowParts.map(x=>[x.type,x.value]));
 const today=dt.year+"-"+dt.month+"-"+dt.day,month=today.slice(0,7);
 nodes.get("dashboardMonth").value=month;
 const principal={uid:"owner-1",emailVerified:true},auth={currentUser:principal};
 let broken=false;
 const modules={
  "./ranking/verified-joint-month-http-bridge.mjs":{
   createVerifiedJointMonthHttpBridge({featureEnabled,expectedRole}){
    assert.equal(featureEnabled,true);assert.equal(expectedRole,"hub_owner");
    return {async load({period,filters}){
     assert.deepEqual(Object.keys(filters),[]);
     requests.push(period);
     if(broken)throw Error("SERVER_RESPONSE_REJECTED");
     return {role:"hub_owner",period:period.kind,
      range:{start:period.kind==="month"?period.day.slice(0,7)+"-01":period.day,end:period.asOf}};
    }};
   }
  },
  "./ranking/verified-inline-joint-ranking-cards.mjs":{
   renderVerifiedInlineJointCards(o){
    assert.equal(o.expectedRole,"hub_owner");
    assert.equal(o.period,o.payload.period);
    assert.equal(o.start,o.payload.range.start);
    assert.equal(o.end,o.payload.range.end);
    rendered.push(o.period);
    for(const node of Object.values(o.roots))node.replaceChildren(make("verified-rank"));
   }
  }
 };
 const env={
  $:id=>nodes.get(id)||null,
  document:{
   getElementById:id=>nodes.get(id)||null,
   createElement:tag=>make(tag),
   head:make("head")
  },
  auth,companyForOwner:async()=>({id:"hub"}),
  onAuthStateChanged(_auth,fn){actions.set("auth",fn);return ()=>{}},
  MutationObserver:class{constructor(fn){observerCallbacks.push(fn)}observe(){}},
  queueMicrotask:callback=>queueMicrotask(callback),
  window:{
   location:{origin:"https://nico-factory.web.app"},
   fetch(){throw Error("UNEXPECTED_DIRECT_FETCH")}
  },
  __load:async path=>{assert.ok(modules[path]);return modules[path]},
  Date,Intl,Promise,console
 };
 const enabled=staging.replace(
  "const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false;",
  "const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=true;")
  .replace('import("./ranking/verified-joint-month-http-bridge.mjs")',
   '__load("./ranking/verified-joint-month-http-bridge.mjs")')
  .replace('import("./ranking/verified-inline-joint-ranking-cards.mjs")',
   '__load("./ranking/verified-inline-joint-ranking-cards.mjs")');
 vm.runInNewContext(enabled,env);
 const settle=async()=>{
  for(let i=0;i<5;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
 };
 actions.get("auth")(principal);await settle();
 assert.equal(requests.at(-1).kind,"month");
 assert.equal(requests.at(-1).day,month+"-01");
 assert.equal(rendered.at(-1),"month");
 const card=nodes.get("individualRankingContent").children[0];
 const controls=card.children[1],periodSelect=controls.children[0],dateInput=controls.children[1];
 assert.equal(dateInput.hidden,true);
 periodSelect.value="week";periodSelect.handlers.change();await settle();
 assert.equal(requests.at(-1).kind,"week");assert.equal(dateInput.hidden,false);
 assert.equal(requests.at(-1).day,today);
 periodSelect.value="day";periodSelect.handlers.change();await settle();
 assert.equal(requests.at(-1).kind,"day");assert.equal(rendered.at(-1),"day");
 // A programmatic dashboard rerender must refresh from verified server.
 const previous=requests.length;
 observerCallbacks[0]();await settle();
 assert.equal(requests.length,previous+1);
 assert.equal(requests.at(-1).kind,"day");
 // A failed response must never leave stale joint count cards.
 broken=true;periodSelect.value="month";periodSelect.handlers.change();await settle();
 assert.equal(card.hidden,true);
 assert.equal(nodes.get("teamRankingContent").children[0].hidden,true);
 assert.equal(nodes.get("teamRankingContent").children[1].hidden,true);
 assert.equal(env.document.head.children[0].disabled,true);
 broken=false;auth.currentUser=null;actions.get("auth")(null);await settle();
 assert.equal(card.hidden,true);
 assert.equal(card.children[2].children.length,0);
});
