import test from "node:test";
import assert from "node:assert/strict";
import {readVerifiedPartnerTabPolicy,PARTNER_OPTIONAL_TABS}
 from "../ranking/partner-tab-visibility-policy.mjs";
import {applyPartnerTabPublicationToNavigation}
 from "../ranking/partner-tab-navigation-gate.mjs";
import {readFileSync} from "node:fs";
const ids=["record","analysis","individual","product","team","chart","detail",
 "products","report","goal","daily","history"];
const admin=["invite","teams","members","catalog"];
const click=id=>({dataset:{partnerPanel:id},hidden:false,attributes:{},
 setAttribute(k,v){this.attributes[k]=v;}});
const section=id=>({dataset:{partnerView:id},hidden:false});
function fixture(){
 const main=ids.map(click),manage=admin.map(click);
 const sections=[...ids.filter(x=>x!=="record"),"teams","members"].map(section);
 const nav={querySelectorAll(sel){assert.equal(sel,"button[data-partner-panel]");return main;}};
 const management={querySelectorAll(sel){assert.equal(sel,"button[data-partner-panel]");return manage;}};
 const details={hidden:false,querySelectorAll(sel){
  assert.equal(sel,"[data-partner-view]");return sections;}};
 const apply=(policy,selectedPanel="record")=>
  applyPartnerTabPublicationToNavigation({
   navigation:nav,management,details,policy,selectedPanel});
 return {main,manage,sections,details,apply};
}
test("all eight choices are copied from reviewed PR #802 and never include finance",()=>{
 assert.deepEqual(PARTNER_OPTIONAL_TABS.map(x=>x.id),[
  "product","team","individual","detail","report","daily","history","goal"
 ]);
 assert(!PARTNER_OPTIONAL_TABS.some(x=>/revenue|cashback|price|salesAnalysis/i.test(x.id)));
});
test("missing Owner setting hides every optional tab while preserving count entry and management",()=>{
 const f=fixture();
 const view=f.apply(null,"individual");
 assert.deepEqual(view.visibleTabs,[]);
 assert.equal(view.published,false);
 assert.equal(view.selectedPanelAllowed,false);
 assert.equal(f.details.hidden,true);
 assert.equal(f.main.find(x=>x.dataset.partnerPanel==="record").hidden,false);
 assert(f.main.filter(x=>x.dataset.partnerPanel!=="record").every(x=>x.hidden));
 assert(f.manage.every(x=>!x.hidden));
});
test("Owner selected two tabs appear without exposing other optional tabs",()=>{
 const f=fixture(),input={
  schema:"nico-partner-tabs-v1",revision:4,published:true,tabs:["detail","individual"]
 };
 const snapshot=structuredClone(input);
 const view=f.apply(input,"detail");
 assert.deepEqual(view.visibleTabs,["individual","detail"]);
 assert.equal(view.selectedPanelAllowed,true);
 assert.equal(f.main.find(x=>x.dataset.partnerPanel==="detail").hidden,false);
 assert.equal(f.main.find(x=>x.dataset.partnerPanel==="individual").hidden,false);
 assert(f.main.filter(x=>!["record","individual","detail"].includes(x.dataset.partnerPanel))
  .every(x=>x.hidden));
 assert.equal(f.sections.find(x=>x.dataset.partnerView==="product").hidden,true);
 assert.equal(f.sections.find(x=>x.dataset.partnerView==="detail").hidden,false);
 assert.deepEqual(input,snapshot);
});
test("Owner revocation closes previously opened tab but never clears form or history",()=>{
 const f=fixture();
 f.apply({schema:"nico-partner-tabs-v1",revision:1,published:true,
  tabs:["history","daily"]},"history");
 const revoked=f.apply({schema:"nico-partner-tabs-v1",revision:2,published:true,
  tabs:[]},"history");
 assert.equal(revoked.selectedPanelAllowed,false);
 assert.equal(f.details.hidden,true);
 assert.equal(f.main.find(x=>x.dataset.partnerPanel==="record").hidden,false);
});
test("tampered policy or company-specific override fails closed before displaying anything",()=>{
 for(const input of [
  {schema:"nico-partner-tabs-v1",revision:1,published:true,tabs:["individual"],
   companyId:"forged"},
  {schema:"nico-partner-tabs-v1",revision:1,published:true,tabs:["individual","individual"]},
  {schema:"nico-partner-tabs-v1",revision:1,published:true,tabs:["salesAnalysis"]},
  {schema:"nico-partner-tabs-v1",revision:1,published:true,tabs:["individual"],
   revenue:100000},
  {schema:"nico-partner-tabs-v1",revision:1,published:true,tabs:"individual"}
 ])assert.throws(()=>fixture().apply(input),/PARTNER_TABS_UNVERIFIED_OR_FORBIDDEN/);
});
test("new callable and all optional UI are unreachable behind TWO disabled hard-coded switches",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert(html.includes("const NICO_PARTNER_TAB_UI_ENABLED = false;"));
 assert(html.includes("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;"));
 const begin=html.indexOf("async function refreshPartnerPublishedTabNavigation()");
 const end=html.indexOf("let partnerAuditNonce",begin);
 assert(begin>0&&end>begin);
 const functionCode=html.slice(begin,end).trim();
 const guard=functionCode.indexOf("if(NICO_PARTNER_TAB_UI_ENABLED!==true||");
 const call=functionCode.indexOf('httpsCallable(partnerCountFunctions,"getPartnerPublishedTabs")');
 assert(guard>=0&&call>guard);
 assert(html.includes("if(!partnerPublishedTabAllowed(name))return;"));
 assert(html.includes("void refreshPartnerPublishedTabNavigation();"));
 assert.equal(readVerifiedPartnerTabPolicy(null).published,false);
});
