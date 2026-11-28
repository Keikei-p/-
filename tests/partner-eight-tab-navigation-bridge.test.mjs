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

// Exercise the MAIN index routing, not merely the standalone legacy page
// or the helper contract. Replace dynamic module loading with the actual
// imported exports in a VM; no network, real token or Firebase credentials.
import vm from "node:vm";
import {createPartnerPublishedOptionalTabClient,createPartnerCodeSessionOptionalTabClient}
 from "../ranking/published-partner-optional-client.mjs";
const mainHtml=readFileSync(new URL("../index.html",import.meta.url),"utf8");
function mainFixture({code=true,enabled=true,mixed=false,delay=false}={}){
 const f=fixture(),calls=[],nodes=new Map();
 const token="T".repeat(43),day="2026-11-24";
 const node=(value="")=>({value,textContent:"",hidden:false,replaceChildren(){this.textContent="";}});
 for(const key of ["pPartnerReportText","pInlineDailySummary","pInlineHistory","pPartnerGoalResult","pPartnerGoalTarget","pPartnerGoalDays","pInlineDate"])
  nodes.set(key,node());
 nodes.get("pInlineDate").value=day;
 nodes.get("pPartnerGoalTarget").value="20";
 nodes.get("pPartnerGoalDays").value="3";
 nodes.set("partnerSameAppNavigation",{querySelectorAll:()=>f.main});
 nodes.set("partnerManagementTabs",{querySelectorAll:()=>f.manage});
 nodes.set("partnerSameAppDashboardDetails",f.details);
 const policy={schema:"nico-partner-tabs-v1",revision:1,published:true,tabs:["individual","product","team","detail","report","daily","history","goal"]};
 const auth={currentUser:code&&!mixed?null:{uid:"staff",emailVerified:true}};
 let release;
 const box=vm.createContext({
  auth,partnerMainCodeToken:code?token:"",partnerMainCodeEpoch:1,
  partnerInlineWorkspaceCompany:code?"":"partner1",
  partnerInlineData:{date:day,companyName:"協力店A",staff:[],records:[],categories:[]},
  partnerPublishedTabGeneration:0,partnerPublishedTabIds:null,
  partnerOptionalTabGeneration:0,partnerOptionalVerifiedGoal:null,
  partnerSameAppSelectedPanel:"record",
  NICO_PARTNER_TAB_UI_ENABLED:enabled,NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED:enabled,
  partnerOptionalPublicationProtectionActive:()=>enabled,
  partnerMainValidId:id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id),
  partnerAnonymousCodeFunctions:"anonymous",partnerCountFunctions:"email",
  pInline:id=>nodes.get(id),
  document:{querySelectorAll:()=>[],createDocumentFragment:()=>({append(){}})},
  partnerMainAppendRow:(el,a,b)=>{el.textContent+=a+b},
  applyPartnerTabPublicationToNavigation,createPartnerPublishedOptionalTabClient,createPartnerCodeSessionOptionalTabClient,
  httpsCallable:(functions,name)=>async payload=>{
   calls.push({functions,name,payload});
   if(name==="getPartnerPublishedTabs"){
    if(delay)await new Promise(resolve=>{release=resolve;});
    return {data:policy};
   }
   assert.equal(name,"getPartnerPublishedOptionalTab");
   return {data:{schema:"nico-published-partner-optional-v1",tab:payload.tab,date:day,
    companyName:"協力店A",reportStatus:"報告済",totalCount:5,reportedStaffCount:1,
    ...(payload.tab==="goal"?{actualCount:5}:{lines:["総件数：5件"]})}};
  }
 });
 const cut=(start,end)=>{
  const a=mainHtml.indexOf(start),b=mainHtml.indexOf(end,a);
  assert(a>=0&&b>a,start);return mainHtml.slice(a,b);
 };
 const nav=cut("async function refreshPartnerPublishedTabNavigation(){","let partnerAuditNonce")
  .replace(/const \{applyPartnerTabPublicationToNavigation\}=await import\(\s*"[^"]+"\);/,"");
 const optional=cut("async function loadPartnerPublishedOptionalPanel(tab){","// Open a saved person's latest counts")
  .replace(/const \{createPartnerPublishedOptionalTabClient,createPartnerCodeSessionOptionalTabClient\}=await import\(\s*"[^"]+"\);/,"");
 const goal=cut("function renderPartnerGoalEstimate(){",'pInline("pPartnerGoalTarget").addEventListener');
 vm.runInContext('const partnerMainCodeActive=()=>!!partnerMainCodeToken&&!auth.currentUser;\n'+
  cut("function partnerInlineIdentity(){","function partnerMainCountCall(")+nav+optional+goal,box);
 return {f,calls,nodes,box,policy,token,run:expr=>vm.runInContext(expr,box),release:()=>release};
}
test("main index code login reaches all eight published tabs without Firebase Auth or a company hint",async()=>{
 const x=mainFixture();
 assert.equal(await x.run("refreshPartnerPublishedTabNavigation()"),true);
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].functions,"anonymous");
 assert.deepEqual(Object.keys(x.calls[0].payload),["codeSessionToken"]);
 assert.equal(x.calls[0].payload.codeSessionToken,x.token);
 assert.equal(x.run("partnerPublishedTabIds.size"),8);
 assert.equal(x.f.main.find(n=>n.dataset.partnerPanel==="individual").hidden,false);
 x.run('partnerSameAppSelectedPanel="report"');x.f.details.hidden=false;
 assert.equal(await x.run('loadPartnerPublishedOptionalPanel("report")'),true);
 assert.equal(x.nodes.get("pPartnerReportText").value,"総件数：5件");
 x.run('partnerSameAppSelectedPanel="goal"');
 assert.equal(await x.run('loadPartnerPublishedOptionalPanel("goal")'),true);
 assert.match(x.nodes.get("pPartnerGoalResult").textContent,/選択日の件数：5件/);
 assert(x.calls.every(c=>c.functions==="anonymous"&&c.payload.codeSessionToken===x.token&&!Object.hasOwn(c.payload,"workspaceCompanyId")));
 assert(!JSON.stringify(x.box.partnerOptionalVerifiedGoal).includes(x.token));
 x.policy.tabs=[];x.policy.published=false;
 await x.run("refreshPartnerPublishedTabNavigation()");
 assert.equal(x.box.partnerOptionalVerifiedGoal,null);
 assert.equal(x.nodes.get("pPartnerReportText").value,"");
 assert.equal(x.f.details.hidden,true);
});
test("main index verified email uses the original Functions instance with no opaque code",async()=>{
 const x=mainFixture({code:false});
 assert.equal(await x.run("refreshPartnerPublishedTabNavigation()"),true);
 x.run('partnerSameAppSelectedPanel="report"');x.f.details.hidden=false;
 assert.equal(await x.run('loadPartnerPublishedOptionalPanel("report")'),true);
 assert(x.calls.every(c=>c.functions==="email"&&c.payload.workspaceCompanyId==="partner1"&&!Object.hasOwn(c.payload,"codeSessionToken")));
});
test("main index OFF and mixed identities never call the new protected endpoints",async()=>{
 for(const opts of [{enabled:false},{mixed:true}]){
  const x=mainFixture(opts);
  await x.run("refreshPartnerPublishedTabNavigation()");
  assert.equal(await x.run('loadPartnerPublishedOptionalPanel("report")'),false);
  assert.deepEqual(x.calls,[]);
 }
});
test("main index rejects a stale publication response from a replaced code session",async()=>{
 const x=mainFixture({delay:true});
 const pending=x.run("refreshPartnerPublishedTabNavigation()");
 x.run('partnerMainCodeEpoch++;partnerMainCodeToken="U".repeat(43)');
 x.release()();
 assert.equal(await pending,false);
 assert.equal(x.box.partnerPublishedTabIds,null);
});
