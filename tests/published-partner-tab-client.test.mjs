import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createPublishedPartnerCountBridge,createPublishedPartnerCodeCountBridge,
 verifyPublishedPartnerCountResponse,renderPublishedPartnerCountTab} from "../ranking/published-partner-tab-client.mjs";

const day="2026-11-18";
const api="https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking";
const base=(tab="product",rows=[{rank:1,name:"NURO",count:5}])=>({
 schema:"nico-published-partner-count-tab-v1",role:"partner_owner",
 unit:"件",period:"day",range:{start:day,end:day},
 readTime:"2026-11-18T09:00:00.000Z",tab,rows
});
const f=({payload=base(),status=200,workspace="partner1",changeAt=""}={})=>{
 const user={uid:"partnerUid",emailVerified:true,getIdToken:async()=>("t".repeat(50))};
 const auth={currentUser:user},requests=[];
 const bridge=createPublishedPartnerCountBridge({
  featureEnabled:true,auth,endpoint:api,getWorkspaceCompanyId:()=>workspace,
  fetcher:async(url,options)=>{
   requests.push({url,options});
   if(changeAt==="fetch")auth.currentUser={uid:"other"};
   return {status,headers:{get:k=>k==="Content-Type"?"application/json":null},
    text:async()=>JSON.stringify(payload)};
  }
 });
 return {bridge,auth,user,requests};
};
const reject=fn=>assert.rejects(fn,/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
test("hard OFF rejects before reading Auth, token, network or any database",()=>{
 let network=0;
 assert.throws(()=>createPublishedPartnerCountBridge({
  featureEnabled:false,auth:{currentUser:null},
  getWorkspaceCompanyId:()=>"",fetcher:async()=>{network++;}
 }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
 assert.equal(network,0);
});
test("verified direct and secondary identity use one tab-scoped GET, no writes",async()=>{
 const direct=f({workspace:""}),secondary=f({workspace:"partner1"});
 for(const item of [direct,secondary]){
  const result=await item.bridge.load({tab:"product",day});
  assert.equal(result.rows[0].count,5);
  assert.deepEqual(Object.keys(result).sort(),["schema","tab","period","rows"].sort());
  assert.equal(item.requests.length,1);
  const req=item.requests[0];
  assert.equal(req.options.method,"GET");assert.equal(req.options.cache,"no-store");
  assert.equal(req.options.credentials,"omit");
  assert.equal(req.options.headers.Authorization,"Bearer "+"t".repeat(50));
  assert(req.url.startsWith(api+"?"));
  const url=new URL(req.url);
  assert.equal(url.searchParams.get("day"),day);
  assert.equal(url.searchParams.get("tab"),"product");
  assert.equal(url.searchParams.get("workspaceCompanyId"),
   item===direct?null:"partner1");
  assert.deepEqual([...url.searchParams.keys()].sort(),
   item===direct?["day","tab"]:["day","tab","workspaceCompanyId"]);
 }
});
test("only one ranked resource can pass; forged finance/other tab/old full schema denied",()=>{
 const valid=[
  base("product",[{rank:1,name:"NURO",count:5}]),
  base("team",[{rank:1,name:"1班",company:"協力店",count:5,own:true}]),
  base("individual",[{rank:1,name:"担当A",company:"協力店",count:5}]),
  base("detail",[{name:"1班",count:5,reportStatus:"報告済",
   members:[{name:"Aさん",count:5,reportStatus:"報告済"}],
   products:[{name:"NURO",count:5}]}])
 ];
 for(const input of valid){
  assert.equal(verifyPublishedPartnerCountResponse(input,{tab:input.tab,day}).rows.length,1);
  for(const mutate of [
   p=>{p.role="hub_owner";},p=>{p.revenue=999;},
   p=>{p.rows[0].unitPrice=30000;},
   p=>{p.rows[0].name="営業 売上300万円";},
   p=>{p.tab="history";},
   p=>{p.schema="nico-verified-dual-count-v1";}
  ]){
   const modified=structuredClone(input);mutate(modified);
   assert.throws(()=>verifyPublishedPartnerCountResponse(modified,{
    tab:input.tab,day
   }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
  }
 }
 assert.throws(()=>verifyPublishedPartnerCountResponse(base(),{
  tab:"team",day
 }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
});
test("reported zero remains ranked, unreported team is never a fake positive count",()=>{
 const zero=base("team",[{rank:1,name:"1班",company:"協力店",count:0,own:true}]);
 assert.equal(verifyPublishedPartnerCountResponse(zero,{tab:"team",day}).rows[0].count,0);
 const wrong=base("detail",[{name:"2班",count:1,reportStatus:"未報告",
  members:[{name:"B",count:1,reportStatus:"未報告"}],
  products:[{name:"NURO",count:1}]}]);
 assert.throws(()=>verifyPublishedPartnerCountResponse(wrong,{tab:"detail",day}));
 const inconsistent=base("detail",[{name:"1班",count:2,reportStatus:"報告済",
  members:[{name:"A",count:2,reportStatus:"報告済"}],
  products:[{name:"NURO",count:1}]}]);
 assert.throws(()=>verifyPublishedPartnerCountResponse(inconsistent,{tab:"detail",day}));
});
test("revoked Auth, network error or 403/503 cannot trigger legacy stale fallback",async()=>{
 for(const status of [401,403,404,503]){
  const item=f({status});
  await reject(()=>item.bridge.load({tab:"product",day}));
  assert.equal(item.requests.length,1);
 }
 const switched=f({changeAt:"fetch"});
 await reject(()=>switched.bridge.load({tab:"product",day}));
 const tokenSwitched=f();tokenSwitched.user.getIdToken=async()=>{
  tokenSwitched.auth.currentUser={uid:"other"};
  return "t".repeat(50);
 };
 await reject(()=>tokenSwitched.bridge.load({tab:"product",day}));
 assert.equal(tokenSwitched.requests.length,0);
 const invalid=f();await reject(()=>invalid.bridge.load({tab:"history",day}));
 assert.equal(invalid.requests.length,0);
});
test("rendered cards use textContent and retain original team/product count only",()=>{
 const nodes=[];
 const doc={
  createElement(tag){const n={tag,children:[],textContent:"",
   append(...items){this.children.push(...items);}};
   nodes.push(n);return n;},
  createDocumentFragment(){return {children:[],
   append(...items){this.children.push(...items);}};}
 };
 const root={children:null,replaceChildren(...v){this.children=v;}},status={textContent:""};
 const payload=verifyPublishedPartnerCountResponse(base("detail",[
  {name:"1班",count:5,reportStatus:"報告済",
   members:[{name:"Aさん",count:5,reportStatus:"報告済"}],
   products:[{name:"NURO",count:5}]}
 ]),{tab:"detail",day});
 renderPublishedPartnerCountTab({document:doc,root,status,payload});
 assert.equal(root.children.length,1);
 assert.equal(status.textContent,"協力店の班詳細（件数のみ）");
 assert.equal(nodes.some(n=>Object.hasOwn(n,"innerHTML")),false);
 assert.equal(nodes.some(n=>n.textContent==="NURO：5件"),true);
 assert.equal(nodes.some(n=>n.textContent==="Aさん：5件（報告済）"),true);
});
test("shared dashboard routes partner to published-only client, Owner retains original rank path; flags OFF",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const begin=html.indexOf("async function tryLoadVerifiedSameAppJointCount(");
 const end=html.indexOf("async function loadSharedDailyStandings(",begin);
 assert(begin>=0&&end>begin);
 const snippet=html.slice(begin,end);
 assert(snippet.indexOf('if(NICO_SAME_APP_JOINT_HTTP_ENABLED!==true)')>=0);
 assert(snippet.indexOf('if(partner){')>snippet.indexOf("SAME_APP_JOINT_NOT_RELEASED"));
 assert(snippet.includes('import("./ranking/published-partner-tab-client.mjs")'));
 assert(snippet.includes('getWorkspaceCompanyId:()=>partnerInlineWorkspaceCompany'));
 assert(snippet.includes('await bridge.load({tab,day:date})'));
 assert(snippet.includes('return true;'));
 assert(snippet.includes('expectedRole:partner?"partner_owner":"hub_owner"'));
 assert(html.includes("const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;"));
 assert(html.includes("const NICO_PARTNER_TAB_UI_ENABLED = false;"));
 assert(html.includes("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;"));
});

test("opaque company code session uses canonical server verified ranking bearer, never URL or company override",async()=>{
 let session="Z".repeat(43);
 const calls=[];
 const bridge=createPublishedPartnerCodeCountBridge({
  featureEnabled:true,serverGuardVerified:true,
  getCodeSessionToken:()=>session,
  fetcher:async(url,opts)=>{
   calls.push({url,opts});
   return {status:200,headers:{get:x=>x==="Content-Type"?"application/json":null},
    text:async()=>JSON.stringify(base())};
  }
 });
 const result=await bridge.load({tab:"product",day});
 assert.equal(result.rows[0].count,5);
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.method,"GET");
 assert.equal(calls[0].opts.cache,"no-store");
 assert.equal(calls[0].opts.credentials,"omit");
 assert.equal(calls[0].opts.redirect,"error");
 assert.equal(calls[0].opts.headers.Authorization,"Bearer "+session);
 assert.equal(new URL(calls[0].url).searchParams.get("workspaceCompanyId"),null);
 assert.deepEqual([...new URL(calls[0].url).searchParams.keys()].sort(),
  ["day","tab"]);
 assert(!calls[0].url.includes(session));
 assert(!JSON.stringify(result).includes(session));
});
test("rank code-session OFF gate stops before token lookup and before fetch",()=>{
 let calls=0;
 for(const [enabled,serverGuardVerified] of [
  [false,false],[true,false],[false,true]
 ]){
  assert.throws(()=>createPublishedPartnerCodeCountBridge({
   featureEnabled:enabled,serverGuardVerified,
   getCodeSessionToken:()=>{calls++;return "Z".repeat(43)},
   fetcher:async()=>{calls++}
  }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
 }
 assert.equal(calls,0);
});
test("code rank session revoked/change, unpublished tab and finance fail closed, no stale results",async()=>{
 for(const badStatus of [401,403,404,503]){
  const token="Z".repeat(43),requests=[];
  const bridge=createPublishedPartnerCodeCountBridge({
   featureEnabled:true,serverGuardVerified:true,
   getCodeSessionToken:()=>token,
   fetcher:async(url,opts)=>{
    requests.push({url,opts});
    return {status:badStatus,headers:{get:()=>"application/json"},
     text:async()=>JSON.stringify(base())};
   }
  });
  await reject(()=>bridge.load({tab:"product",day}));
  assert.equal(requests.length,1);
 }
 let session="Z".repeat(43);
 const bridge=createPublishedPartnerCodeCountBridge({
  featureEnabled:true,serverGuardVerified:true,
  getCodeSessionToken:()=>session,
  fetcher:async()=>{session="Y".repeat(43);return {
   status:200,headers:{get:()=>"application/json"},
   text:async()=>JSON.stringify(base())
  }}
 });
 await reject(()=>bridge.load({tab:"product",day}));
 let called=0;
 const invalid=createPublishedPartnerCodeCountBridge({
  featureEnabled:true,serverGuardVerified:true,
  getCodeSessionToken:()=>"bad",
  fetcher:async()=>{called++}
 });
 await reject(()=>invalid.load({tab:"product",day}));
 await reject(()=>invalid.load({tab:"revenue",day}));
 await reject(()=>invalid.load({tab:"history",day}));
 assert.equal(called,0);
 const finance=createPublishedPartnerCodeCountBridge({
  featureEnabled:true,serverGuardVerified:true,
  getCodeSessionToken:()=>"S".repeat(43),
  fetcher:async()=>({status:200,headers:{get:()=>"application/json"},
   text:async()=>JSON.stringify({...base(),unitPrice:20000})})
 });
 await reject(()=>finance.load({tab:"product",day}));
});
test("canonical ranking factory keeps original code bearer Auth path without changing existing Count API",()=>{
 const src=readFileSync(new URL(
  "../functions-ranking-approvals/functions-partner-workspace/workspace-identity.cjs",
  import.meta.url),"utf8");
 const factory=readFileSync(new URL(
  "../functions-ranking-approvals/ranking/canonical-owner-count-server-factory.mjs",
  import.meta.url),"utf8");
 const HTTP=readFileSync(new URL(
  "../functions-ranking-approvals/ranking/owner-visible-count-server-handler.mjs",
  import.meta.url),"utf8");
 assert(src.includes('const code=/^[A-Za-z0-9_-]{43}$/.test(token);'));
 assert(src.includes('data:code?{codeSessionToken:token}:{workspaceCompanyId}'));
 assert(src.includes("session.expiresAt.toMillis()<=now()"));
 assert(src.includes("getAuth().verifyIdToken(token,true)"));
 assert(src.includes('if(a.codeAuth&&(s.kind!=="partner"||s.cid!==a.companyId))fail()'));
 assert(factory.includes("readCountViewer({token,workspaceCompanyId,tx})"));
 assert(HTTP.includes('projectPublishedPartnerCountTab({'));
 assert(HTTP.includes('partnerTabPolicy.tabs.includes(tab)'));
});


test("published rank gap matches the server-approved global rank for every ranking tab",async()=>{
 const datasets=[
  ["product",[
   {rank:2,name:"NURO",count:5},
   {rank:4,name:"SB光・AIR",count:3}]],
  ["individual",[
   {rank:2,name:"担当A",company:"協力店A",count:5},
   {rank:4,name:"担当B",company:"協力店B",count:3}]],
  ["team",[
   {rank:2,name:"1班",company:"協力店A",count:5,own:true},
   {rank:4,name:"2班",company:"協力店B",count:3,own:false}]]
 ];
 for(const [tab,rows] of datasets){
  const response=base(tab,rows),before=structuredClone(response);
  const verified=verifyPublishedPartnerCountResponse(response,{tab,day});
  assert.deepEqual(verified.rows.map(x=>x.rank),[2,4],tab);
  assert.deepEqual(verified.rows.map(x=>x.count),[5,3],tab);
  assert.deepEqual(response,before,"no count or source mutation");
  const bridge=f({payload:response});
  const result=await bridge.bridge.load({tab,day});
  assert.deepEqual(result.rows.map(x=>x.rank),[2,4]);
  assert.equal(bridge.requests.length,1,"single authenticated GET");
  assert.equal(bridge.requests[0].options.method,"GET");
  assert.equal(JSON.stringify(result).includes("unitPrice"),false);
 }
});

test("published competition ties and redacted predecessors stay valid, but forged ranks fail closed",()=>{
 const good=[
  [{rank:1,name:"A",count:8},{rank:1,name:"B",count:8},
   {rank:3,name:"C",count:5}],
  [{rank:2,name:"A",count:8},{rank:2,name:"B",count:8},
   {rank:5,name:"C",count:5}],
  [{rank:1,name:"A",count:8},{rank:3,name:"C",count:5}]
 ];
 for(const rows of good)
  assert.deepEqual(verifyPublishedPartnerCountResponse(base("product",rows),{
   tab:"product",day
  }).rows.map(r=>r.rank),rows.map(r=>r.rank));
 const rejected=[
  [{rank:1,name:"A",count:8},{rank:2,name:"B",count:8}], // false tie
  [{rank:1,name:"A",count:8},{rank:1,name:"B",count:5}], // false order
  [{rank:4,name:"A",count:8},{rank:3,name:"B",count:5}], // rank reversal
  [{rank:1,name:"A",count:8},{rank:2,name:"B",count:8},
   {rank:3,name:"C",count:5}],
  [{rank:1,name:"A",count:8},{rank:2,name:"B",count:9}], // count reversal
  [{rank:1,name:"A",count:8},{rank:null,name:"B",count:5}],
  [{rank:1,name:"A",count:8},{rank:-1,name:"B",count:5}],
  [{rank:1,name:"A",count:8},{rank:2,name:"売上30000円",count:5}],
  [{rank:1,name:"A",count:8},{rank:2,name:"B",count:5,unitPrice:30000}]
 ];
 for(const rows of rejected)
  assert.throws(()=>verifyPublishedPartnerCountResponse(base("product",rows),{
   tab:"product",day
  }),/PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED/);
});

test("company-code sessions display the same verified gaps, never a synthetic dense rank",async()=>{
 const session="Z".repeat(43),requests=[];
 const data=base("individual",[
  {rank:2,name:"Aさん",company:"協力店A",count:5},
  {rank:4,name:"Bさん",company:"協力店B",count:3}]);
 const bridge=createPublishedPartnerCodeCountBridge({
  featureEnabled:true,serverGuardVerified:true,
  getCodeSessionToken:()=>session,
  fetcher:async(url,options)=>{
   requests.push({url,options});
   return {status:200,headers:{get:()=> "application/json"},
    text:async()=>JSON.stringify(data)};
  }
 });
 const res=await bridge.load({tab:"individual",day});
 assert.deepEqual(res.rows.map(x=>x.rank),[2,4]);
 assert.equal(requests.length,1);
 assert(!requests[0].url.includes(session));
 assert(!JSON.stringify(res).includes(session));
});
