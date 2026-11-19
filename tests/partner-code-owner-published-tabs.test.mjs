import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const backend=readFileSync(new URL("../functions-partner-tabs/controller.cjs",import.meta.url),"utf8");
const start=html.indexOf("// The same eight Owner-published tabs must apply");
const end=html.indexOf("function openCountPanel(key){",start);
assert(start>0&&end>start,"Published tab gateway must be adjacent to existing panel navigation");
const raw=html.slice(start,end);
const htmlPanels=["analysis","individual","productRanking","teamRanking","trend",
 "teamDetail","productSummary","report","goal","daily","history"];
function subject({code=true,uid=true,enabled=true,answer=null,requestError=null,delay=false}={}){
 const token="T".repeat(43),calls=[],nodes=new Map();
 const names=htmlPanels.map(key=>({dataset:{countPanel:key},hidden:false,
  setAttribute(k,v){this[k]=v}}));
 for(const key of htmlPanels)nodes.set("partnerPanel-"+key,{hidden:false});
 nodes.set("partnerDashboardDetail",{hidden:false});
 const auth={currentUser:uid?{uid:"owner-staff",emailVerified:true}:null};
 if(code)auth.currentUser=null;
 const policy=answer??{schema:"nico-partner-tabs-v1",revision:1,
  published:true,tabs:["product","team","individual","detail","report","daily","history","goal"]};
 let finish=null;
 const call=async payload=>{
  calls.push(payload);
  if(requestError)throw Error(requestError);
  if(delay)return await new Promise(resolve=>{finish=()=>resolve({data:policy})});
  return {data:policy};
 };
 const sandbox=vm.createContext({
  data:{role:"owner"},activeCodeSession:code?token:"",
  auth,workspaceCompanyId:code?"":"partner-C",
  currentCountPanel:"analysis",
  countPanelNames:new Set(htmlPanels),$:(id)=>nodes.get(id),
  document:{querySelectorAll(selector){assert.equal(selector,"[data-count-panel]");return names}},
  httpsCallable:(_,name)=>{assert.equal(name,"getPartnerPublishedTabs");return call},
  functions:{}
 });
 const src=raw.replace("const NICO_PARTNER_SAME_SCREEN_TABS_ENABLED=false;",
 "const NICO_PARTNER_SAME_SCREEN_TABS_ENABLED="+String(enabled)+";")
 .replace("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED=false;",
 "const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED="+String(enabled)+";");
 vm.runInContext(src,sandbox);
 const expr=x=>vm.runInContext(x,sandbox);
 return {expr,sandbox,names,nodes,calls,finish:()=>finish,auth,token};
}
test("both release switches default OFF, keep core count inputs and untouched money sources",()=>{
 assert.match(raw,/NICO_PARTNER_SAME_SCREEN_TABS_ENABLED=false/);
 assert.match(raw,/NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED=false/);
 assert.match(html,/function openCountPanel\(key\)\{\s*if\(!partnerCountPanelAllowed\(key\)\)return;/);
 assert.match(html,/resetPartnerPublishedCountPanels\(\);\s*draw\(\);/);
 assert.match(html,/if\(usePartnerPublishedCountPanels\(\)\)void loadPartnerPublishedCountPanels\(\)/);
 assert.match(backend,/readPartnerCodeSession\(d\.codeSessionToken\)/);
 assert.doesNotMatch(raw,/\b(?:setDoc|updateDoc|deleteDoc|writeBatch|records|revenueGoals|totalRevenue|unitPrice|CB|firebase deploy)\b/);
 const x=subject({enabled:false});
 assert.equal(x.expr("partnerCountPanelAllowed('analysis')"),true);
 assert.equal(x.expr("partnerCountPanelAllowed('productRanking')"),true);
 assert.equal(x.expr("partnerCountPanelAllowed('invalid')"),false);
 x.expr("resetPartnerPublishedCountPanels()");
 assert.equal(x.names.every(n=>!n.hidden),true);
 assert.equal(x.calls.length,0);
});
test("valid code session uses only opaque token; published eight tabs are visible, extras hidden",async()=>{
 const x=subject({uid:false});
 x.expr("resetPartnerPublishedCountPanels()");
 assert(x.names.every(n=>n.hidden));
 const result=await x.expr("loadPartnerPublishedCountPanels()");
 assert.equal(result,true);
 assert.deepEqual(x.calls,[{codeSessionToken:x.token}]);
 for(const n of x.names)assert.equal(n.hidden,["analysis","trend","productSummary"].includes(n.dataset.countPanel));
 assert.equal(x.expr("partnerCountPanelAllowed('analysis')"),false);
 assert.equal(x.expr("partnerCountPanelAllowed('teamDetail')"),true);
 assert.equal(x.expr("currentCountPanel"),null);
 assert.equal(x.nodes.get("partnerDashboardDetail").hidden,true);
});
test("verified secondary email passes only workspaceCompanyId, no code impersonation",async()=>{
 const x=subject({code:false});
 x.expr("resetPartnerPublishedCountPanels()");
 assert.equal(await x.expr("loadPartnerPublishedCountPanels()"),true);
 assert.deepEqual(x.calls,[{workspaceCompanyId:"partner-C"}]);
});
test("unpublished, invalid, or unavailable policy is fail closed for all optional tabs",async()=>{
 const variants=[
  {answer:{schema:"nico-partner-tabs-v1",revision:2,published:false,tabs:[]}},
  {answer:{schema:"nico-partner-tabs-v1",revision:2,published:false,tabs:["product"]}},
  {answer:{schema:"invalid",revision:2,published:true,tabs:["product"]}},
  {answer:{schema:"nico-partner-tabs-v1",revision:2,published:true,tabs:["product","product"]}},
  {requestError:"permission-denied"}
 ];
 for(const v of variants){
  const x=subject({uid:false,...v});x.expr("resetPartnerPublishedCountPanels()");
  await x.expr("loadPartnerPublishedCountPanels()");
  assert(x.names.every(n=>n.hidden));
  assert.equal(x.expr("partnerCountPanelAllowed('report')"),false);
 }
});
test("revocation on subsequent refresh hides old optional panels without deleting counts",async()=>{
 const x=subject({uid:false});
 x.expr("resetPartnerPublishedCountPanels()");
 await x.expr("loadPartnerPublishedCountPanels()");
 assert.equal(x.expr("partnerCountPanelAllowed('productRanking')"),true);
 x.expr("resetPartnerPublishedCountPanels()");
 assert(x.names.every(n=>n.hidden));
 assert.equal(x.expr("partnerCountPanelAllowed('productRanking')"),false);
});
test("new code session cannot combine with an old Firebase Auth identity",async()=>{
 const x=subject({uid:false});x.auth.currentUser={uid:"old-internal"};
 x.expr("resetPartnerPublishedCountPanels()");
 assert.equal(await x.expr("loadPartnerPublishedCountPanels()"),false);
 assert.deepEqual(x.calls,[]);
 assert(x.names.every(n=>n.hidden));
});
test("in-flight response after code-session replacement cannot reveal old published tabs",async()=>{
 const x=subject({uid:false,delay:true});x.expr("resetPartnerPublishedCountPanels()");
 const inflight=x.expr("loadPartnerPublishedCountPanels()");
 x.expr("resetPartnerPublishedCountPanels()");
 x.expr("activeCodeSession='replacement'");
 x.finish()();
 await inflight;
 assert(x.names.every(n=>n.hidden));
});
