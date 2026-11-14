import test from "node:test";
import assert from "node:assert/strict";
import {createVerifiedJointMonthHttpBridge}
 from "../ranking/verified-joint-month-http-bridge.mjs";
const token="A".repeat(120),period={
 kind:"month",day:"2026-11-10",asOf:"2026-11-10"
};
const viewer={uid:"owner",emailVerified:true,getIdToken:async()=>token};
const auth={currentUser:viewer};
const makeResponse=(override={})=>({
 status:200,headers:{get:()=> "application/json; charset=utf-8"},
 text:async()=>JSON.stringify({
  schema:"nico-verified-dual-count-v1",role:"partner_owner",
  period:"month",unit:"件",range:{
   start:"2026-11-01",end:"2026-11-10"
  },...override
 })
});

test("public ranking scopes require exact server echo and reject unknown scopes before fetching",async()=>{
 for(const scope of ["joint","own","partner"]){
  const urls=[];
  const bridge=createVerifiedJointMonthHttpBridge({featureEnabled:true,auth,
   fetcher:async url=>{urls.push(url);return makeResponse({scope});}
  });
  assert.equal((await bridge.load({period,filters:{},scope})).scope,scope);
  assert.equal(new URL(urls[0]).searchParams.get("scope"),scope);
 }
 for(const returned of [undefined,"joint","partner"]){
  const bridge=createVerifiedJointMonthHttpBridge({featureEnabled:true,auth,
   fetcher:async()=>makeResponse(returned===undefined?{}:{scope:returned})});
  await assert.rejects(bridge.load({period,filters:{},scope:"own"}),/BRIDGE_BLOCKED/);
 }
 let calls=0;
 const bridge=createVerifiedJointMonthHttpBridge({featureEnabled:true,auth,
  fetcher:async()=>{calls++;return makeResponse();}});
 await assert.rejects(bridge.load({period,filters:{},scope:"all_private"}),/BRIDGE_BLOCKED/);
 assert.equal(calls,0);
});
test("disabled bridge refuses initialization, tokens, fetch, arbitrary redirect targets",async()=>{
 let invoked=0;
 const getter=()=>{invoked++;return token;};
 const user={uid:"owner",emailVerified:true,getIdToken:getter};
 const identity={currentUser:user};
 assert.throws(()=>createVerifiedJointMonthHttpBridge({
  auth:identity,fetcher:async()=>{invoked++;}
 }),/BRIDGE_BLOCKED/);
 assert.throws(()=>createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth:identity,fetcher:async()=>{invoked++;},
  endpoint:"https://evil.example/collect"
 }),/BRIDGE_BLOCKED/);
 assert.equal(invoked,0);
});
test("approved month is GET-only with current Firebase bearer and zero disk/cache writes",async()=>{
 const calls=[];
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,
  fetcher:async(...args)=>{calls.push(args);return makeResponse()}
 });
 const result=await bridge.load({period,filters:{}});
 assert.equal(result.period,"month");
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],"https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11");
 assert.equal(calls[0][1].method,"GET");
 assert.equal(calls[0][1].headers.Authorization,"Bearer "+token);
 assert.equal(calls[0][1].credentials,"omit");
 assert.equal(calls[0][1].cache,"no-store");
 assert.equal(calls[0][1].redirect,"error");
 assert.equal(calls[0][1].referrerPolicy,"no-referrer");
});
test("unknown periods, filters, future dates and invalid days are rejected before any fetch",async()=>{
 let fetches=0;
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,fetcher:async()=>{fetches++;return makeResponse()}
 });
 for(const args of [
  {period:{...period,kind:"year"},filters:{}},
  {period:{...period,kind:"week",day:"2026-11-30"},filters:{}},
  {period,filters:{companyId:"../records"}},
  {period:{...period,day:"2026-11-32"},filters:{}},
  {period:{...period,day:"2026-12-01"},filters:{}},
  {period:{...period,asOf:"2026-11-00"},filters:{}},
  {period,filters:[]}
 ])await assert.rejects(bridge.load(args),/BRIDGE_BLOCKED/);
 assert.equal(fetches,0);
});
test("verified hub owner GET supports company/team/member/product filters with server scope echo",async()=>{
 const urls=[];
 const owner=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:"hub_owner",
  fetcher:async url=>{
   urls.push(url);
   return makeResponse({role:"hub_owner",
    filters:{companyId:"partner",teamId:"team",uid:"staff",productId:"nuro"}});
  }
 });
 const filters={companyId:"partner",teamId:"team",uid:"staff",productId:"nuro"};
 const result=await owner.load({period,filters});
 assert.deepEqual(result.filters,filters);
 assert.deepEqual(urls,[
  "https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11&companyId=partner&teamId=team&uid=staff&productId=nuro"
 ]);
 for(const bad of [
  {companyId:"partner",teamId:"team/../../records"},
  {teamId:"team"},
  {uid:"staff"},
  {companyId:"partner",unknown:"private"},
  {companyId:""},
  {productId:"NURO光"}
 ]){
  const before=urls.length;
  await assert.rejects(owner.load({period,filters:bad}),/BRIDGE_BLOCKED/);
  assert.equal(urls.length,before,"invalid filter must not reach network");
 }
 const partner=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:"partner_owner",
  fetcher:async()=>{throw Error("partner filter must never touch network")}
 });
 await assert.rejects(partner.load({period,filters:{companyId:"hub"}}),
  /BRIDGE_BLOCKED/);
});
test("filtered responses with missing or contradictory server scope never render",async()=>{
 const filters={companyId:"partner",teamId:"team"};
 for(const value of [
  {},
  {companyId:"hub",teamId:"team"},
  {companyId:"partner"},
  {companyId:"partner",teamId:"other"},
  {companyId:"partner",teamId:"team",uid:"other"},
  {companyId:"partner",teamId:"team",salary:"10000"}
 ]){
  const owner=createVerifiedJointMonthHttpBridge({
   featureEnabled:true,auth,expectedRole:"hub_owner",
   fetcher:async()=>makeResponse({role:"hub_owner",filters:value})
  });
  await assert.rejects(owner.load({period,filters}),/BRIDGE_BLOCKED/);
 }
});
test("identity switch/revocation in flight never returns older company's names",async()=>{
 let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 const original={uid:"abc",emailVerified:true,getIdToken:async()=>token};
 const cur={currentUser:original};
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth:cur,fetcher:async()=>pending
 });
 const op=bridge.load({period,filters:{}});
 await Promise.resolve();await Promise.resolve();
 cur.currentUser={uid:"other",emailVerified:true,getIdToken:async()=>token};
 bridge.onAuthChange();
 finish(makeResponse());
 await assert.rejects(op,/BRIDGE_BLOCKED/);
});
test("bad status, MIME, oversized payload, wrong month and impersonated schema all fail closed",async()=>{
 const cases=[
  {...makeResponse(),status:503},
  {...makeResponse(),headers:{get:()=>"text/html"}},
  {...makeResponse(),text:async()=>"{"+" ".repeat(900001)+"}"},
  makeResponse({period:"day"}),
  makeResponse({role:"unknown"}),
  makeResponse({range:{start:"2026-10-01",end:"2026-10-31"}}),
  makeResponse({unit:"円"}),
  makeResponse({range:{start:"2026-11-01",end:"2026-11-11"}})
 ];
 for(const response of cases){
  const bridge=createVerifiedJointMonthHttpBridge({
   featureEnabled:true,auth,fetcher:async()=>response
  });
  await assert.rejects(bridge.load({period,filters:{}}),/BRIDGE_BLOCKED/);
 }
});

test("dashboard audience must equal signed server response role",async()=>{
 const hub=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:"hub_owner",
  fetcher:async()=>makeResponse({role:"hub_owner",filters:{}})
 });
 assert.equal((await hub.load({period,filters:{}})).role,"hub_owner");
 const partner=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:"partner_owner",
  fetcher:async()=>makeResponse({role:"hub_owner"})
 });
 await assert.rejects(partner.load({period,filters:{}}),/BRIDGE_BLOCKED/);
 for(const invalid of ["owner","member","HUB_OWNER","",true]){
  assert.throws(()=>createVerifiedJointMonthHttpBridge({
   featureEnabled:true,auth,expectedRole:invalid,
   fetcher:async()=>makeResponse()
  }),/BRIDGE_BLOCKED/);
 }
});


test("day and week perform authenticated GETs with exact calendar boundaries",async()=>{
 const calls=[];
 const responses={
  day:makeResponse({period:"day",range:{
   start:"2026-11-08",end:"2026-11-08"}}),
  week:makeResponse({period:"week",range:{
   start:"2026-11-02",end:"2026-11-08"}})
 };
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,
  fetcher:async(url,options)=>{
   calls.push([url,options]);
   return url.includes("?day=")?responses.day:responses.week;
  }
 });
 const day=await bridge.load({period:{...period,kind:"day",day:"2026-11-08"},filters:{}});
 const week=await bridge.load({period:{...period,kind:"week",day:"2026-11-08"},filters:{}});
 assert.equal(day.period,"day");
 assert.equal(week.period,"week");
 assert.deepEqual(calls.map(x=>x[0]),[
  "https://nico-factory.web.app/v1/owner-visible-counts?day=2026-11-08",
  "https://nico-factory.web.app/v1/owner-visible-counts?week=2026-11-08"
 ]);
 assert(calls.every(x=>x[1].headers.Authorization==="Bearer "+token));
 assert(calls.every(x=>x[1].cache==="no-store"));
});

test("cross-month week and mismatched day/week range fail without showing another month",async()=>{
 let fetches=0;
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,fetcher:async()=>{
   fetches++;
   return makeResponse({period:"day",range:{
    start:"2026-11-07",end:"2026-11-07"}});
  }
 });
 for(const p of [
  {...period,kind:"week",day:"2026-11-30"},
  {...period,kind:"day",day:"2026-11-12"}
 ])await assert.rejects(bridge.load({period:p,filters:{}}),/BRIDGE_BLOCKED/);
 assert.equal(fetches,0,"invalid calendar selections must be blocked before Auth and fetch");
 await assert.rejects(bridge.load({period:{
  ...period,kind:"day",day:"2026-11-08"
 },filters:{}}),/BRIDGE_BLOCKED/,"wrong dated response must not render");
 assert.equal(fetches,1);
});


test("cross-month weeks are permitted only with server-verified exact seven-day range",async()=>{
 const calls=[];
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:"partner_owner",
  fetcher:async(url)=>{
   calls.push(url);
   return makeResponse({period:"week",range:{
    start:"2026-10-26",end:"2026-11-01"}});
  }
 });
 const result=await bridge.load({period:{
  ...period,kind:"week",day:"2026-11-01"
 },filters:{}});
 assert.equal(result.range.start,"2026-10-26");
 assert.equal(result.range.end,"2026-11-01");
 assert.deepEqual(calls,[
  "https://nico-factory.web.app/v1/owner-visible-counts?week=2026-11-01"
 ]);
 const wrong=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,fetcher:async()=>makeResponse({period:"week",
   range:{start:"2026-11-01",end:"2026-11-01"}})
 });
 await assert.rejects(wrong.load({period:{
  ...period,kind:"week",day:"2026-11-01"
 },filters:{}}),/BRIDGE_BLOCKED/);
});
