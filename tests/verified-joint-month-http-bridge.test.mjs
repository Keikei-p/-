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
  {period:{...period,kind:"quarter"},filters:{}},
  {period,filters:{companyId:"another"}},
  {period:{...period,day:"2026-11-32"},filters:{}},
  {period:{...period,day:"2026-12-01"},filters:{}},
  {period:{...period,asOf:"2026-11-00"},filters:{}},
  {period,filters:[]}
 ])await assert.rejects(bridge.load(args),/BRIDGE_BLOCKED/);
 assert.equal(fetches,0);
});
test("day/week/month use the same verified GET and exact server dates",async()=>{
 const scenarios=[
  {kind:"day",day:"2026-11-08",asOf:"2026-11-10",
   start:"2026-11-08",end:"2026-11-08",query:"day=2026-11-08"},
  {kind:"week",day:"2026-11-10",asOf:"2026-11-10",
   start:"2026-11-09",end:"2026-11-10",query:"week=2026-11-10"},
  {kind:"week",day:"2026-11-01",asOf:"2026-11-10",
   start:"2026-10-26",end:"2026-11-01",query:"week=2026-11-01"},
  {kind:"month",day:"2026-10-10",asOf:"2026-11-10",
   start:"2026-10-01",end:"2026-10-31",query:"month=2026-10"}
 ];
 for(const {kind,day,asOf,start,end,query} of scenarios){
  const calls=[];
  const bridge=createVerifiedJointMonthHttpBridge({
   featureEnabled:true,auth,expectedRole:"partner_owner",
   fetcher:async(...args)=>{
    calls.push(args);
    return makeResponse({period:kind,range:{start,end}});
   }
  });
  const got=await bridge.load({period:{kind,day,asOf},filters:{}});
  assert.equal(got.role,"partner_owner");
  assert.equal(got.range.start,start);
  assert.equal(got.range.end,end);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"https://nico-factory.web.app/v1/owner-visible-counts?"+query);
  assert.equal(calls[0][1].method,"GET");
 }
});
test("cross-month week must be server approved, never merged by client or truncated",async()=>{
 let count=0;
 const date={kind:"week",day:"2026-11-01",asOf:"2026-11-10"};
 for(const range of [
  {start:"2026-11-01",end:"2026-11-01"},
  {start:"2026-10-26",end:"2026-11-02"},
  {start:"2026-10-25",end:"2026-11-01"},
  {start:"2026-10-26",end:"2026-10-31"}
 ]){
  const bridge=createVerifiedJointMonthHttpBridge({
   featureEnabled:true,auth,fetcher:async()=>{
    count++;return makeResponse({period:"week",range});
   }
  });
  await assert.rejects(bridge.load({period:date,filters:{}}),/BRIDGE_BLOCKED/);
 }
 assert.equal(count,4,"only one complete server GET per request");
});
test("partner screen blocks a hub Owner response, and hub view blocks partner response",async()=>{
 for(const expectedRole of ["partner_owner","hub_owner"]){
  const wrong=expectedRole==="hub_owner"?"partner_owner":"hub_owner";
  const bridge=createVerifiedJointMonthHttpBridge({
   featureEnabled:true,auth,expectedRole,
   fetcher:async()=>makeResponse({role:wrong})
  });
  await assert.rejects(bridge.load({period,filters:{}}),/BRIDGE_BLOCKED/);
 }
 assert.throws(()=>createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:"owner",
  fetcher:async()=>makeResponse()
 }),/BRIDGE_BLOCKED/);
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
