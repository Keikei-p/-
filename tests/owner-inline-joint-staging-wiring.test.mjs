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
 assert.ok(staging.includes('period:"month",start:month+"-01",end'));
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
