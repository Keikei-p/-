"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createJointCountHttpAdapter}=require(
 "../functions-ranking-approvals/joint-count-http-adapter.cjs");

const URL_PATH="/v1/owner-visible-counts?month=2026-11";
const ORIGIN="https://nico-factory.web.app";
const TOKEN="Bearer "+"a".repeat(48);
function req(path=URL_PATH,opts={}){
 return {method:opts.method||"GET",originalUrl:path,
  headers:{authorization:TOKEN,origin:ORIGIN,...opts.headers}};
}
function response(){
 const result={statusCode:null,body:null,headers:{},
  setHeader(name,value){this.headers[name.toLowerCase()]=value;},
  status(n){this.statusCode=n;return this},
  send(data){this.body=data;return this}
 };
 return result;
}
const data=()=>({schema:"nico-verified-dual-count-v1",
 role:"partner_owner",unit:"件",period:"month",
 range:{start:"2026-11-01",end:"2026-11-09"},
 readTime:"2026-11-09T00:00:00.000Z",
 own:{count:5},
 publicRanking:{members:[{rank:1,name:"営業担当",count:5,company:"協力店"}],
  products:[{rank:1,name:"NURO光",count:8}]}});
const make=(status=200,body=data())=>async request=>
 new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
test("default OFF: never initializes backend nor touches any live data",async()=>{
 let loads=0;const adapter=createJointCountHttpAdapter({
  loadHandler:()=>{loads++;return make()}
 });
 const r=response();await adapter(req(),r);
 assert.equal(r.statusCode,503);
 assert.equal(loads,0);
 assert.deepEqual(JSON.parse(r.body),{error:"request_blocked"});
 assert.equal(r.headers["cache-control"],"no-store");
});
test("canonical GET forwards only a bearer token and verified origin; no host injection",async()=>{
 let loads=0,seen=null;
 const adapter=createJointCountHttpAdapter({
  enabled:()=>true,loadHandler:()=>{loads++;
   return async request=>{seen=request;
    return new Response(JSON.stringify(data()),{status:200})}}
 });
 const r=response();await adapter(req(URL_PATH,{headers:{
  host:"evil.example","x-forwarded-host":"evil.example",
  cookie:"token-dont-send","user-agent":"fake",
  "x-forwarded-proto":"http"}}),r);
 assert.equal(r.statusCode,200);
 assert.equal(loads,1);
 assert.equal(seen.url,ORIGIN+URL_PATH);
 assert.equal(seen.method,"GET");
 assert.equal(seen.headers.get("Authorization"),TOKEN);
 assert.equal(seen.headers.get("Origin"),ORIGIN);
 assert.equal(seen.headers.get("cookie"),null);
 assert.equal(seen.headers.get("x-forwarded-host"),null);
 assert.deepEqual(JSON.parse(r.body),data());
 assert.equal(r.headers["access-control-allow-origin"],ORIGIN);
 assert.equal(r.headers["cache-control"],"no-store");
 const r2=response();await adapter(req(),r2);
 assert.equal(r2.statusCode,200);
 assert.equal(loads,1,"backend factory is initialized only once");
});
test("CORS preflight only on same-origin GET Authorization; no auth/database lookup",async()=>{
 let loads=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>{loads++;return make()}});
 const safe=req(URL_PATH,{method:"OPTIONS",headers:{
  "access-control-request-method":"GET",
  "access-control-request-headers":"authorization, accept"}});
 const r=response();await adapter(safe,r);
 assert.equal(r.statusCode,204);
 assert.equal(r.body,"");
 assert.equal(r.headers["access-control-allow-headers"],"Authorization, Accept");
 assert.equal(r.headers["access-control-allow-methods"],"GET, OPTIONS");
 assert.equal(loads,0);
 for(const changed of [
  {origin:"https://evil.example"},
  {"access-control-request-method":"POST"},
  {"access-control-request-headers":"authorization, x-secret"},
  {"access-control-request-headers":"cookie"}
 ]){
  const out=response();
  await adapter(req(URL_PATH,{method:"OPTIONS",headers:{
   ...safe.headers,...changed
  }}),out);
  assert.equal(out.statusCode,403);
  assert.equal(loads,0);
 }
});
test("bad path, foreign Origin, POST, missing or short token never load handler",async()=>{
 let loads=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>{loads++;return make()}});
 const cases=[
  [req("/v1/owner-visible-counts-v2?month=2026-11"),404],
  [req("https://evil.example/v1/owner-visible-counts?month=2026-11"),404],
  [req("//evil.example/v1/owner-visible-counts?month=2026-11"),404],
  [req(URL_PATH,{headers:{origin:"https://evil.example"}}),403],
  [req(URL_PATH,{method:"POST"}),405],
  [req(URL_PATH,{headers:{authorization:"Bearer short"}}),401],
  [req(URL_PATH,{headers:{authorization:""}}),401],
  [req(URL_PATH,{headers:{"content-length":"10"}}),400]
 ];
 for(const [input,code] of cases){
  const out=response();await adapter(input,out);
  assert.equal(out.statusCode,code);
  assert.deepEqual(JSON.parse(out.body),{error:"request_blocked"});
 }
 assert.equal(loads,0);
});
test("monthly query errors are NOT widened, canonical backend rejects duplicate month",async()=>{
 let received=null;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>async request=>{
   received=request.url;
   return new Response(JSON.stringify({error:"request_blocked"}),{status:400});
  }});
 const r=response();
 await adapter(req("/v1/owner-visible-counts?month=2026-11&month=2026-10"),r);
 assert.equal(r.statusCode,400);
 assert.equal(received,ORIGIN+"/v1/owner-visible-counts?month=2026-11&month=2026-10");
 assert.equal(r.headers["cache-control"],"no-store");
});
test("finance payload, nested private records, malformed responses fail closed",async()=>{
 for(const body of [
  {...data(),revenue:99999},
  {...data(),publicRanking:{...data().publicRanking,
    members:[{name:"担当者",count:1,rank:1,price:10000}]}},
  {...data(),rawProducts:[]},
  {...data(),records:[{id:"private"}]},
  {...data(),cashback:{secret:1}},
  {"__proto__":null,profit:1000}
 ]){
  const adapter=createJointCountHttpAdapter({
   enabled:()=>true,loadHandler:()=>make(200,body)
  });
  const r=response();await adapter(req(),r);
  assert.equal(r.statusCode,503);
  assert.deepEqual(JSON.parse(r.body),{error:"request_blocked"});
  assert(!r.body.includes("99999"));
 }
});
test("upstream exceptions and unrecognized HTTP responses never leak tokens",async()=>{
 for(const loader of [
  ()=>{throw Error("secret:"+TOKEN)},
  ()=>async()=>{throw Error("secret:"+TOKEN)},
  ()=>async()=>({status:201,text:async()=>JSON.stringify(data())}),
  ()=>async()=>({status:200,text:async()=>"<html>PRIVATE</html>"})
 ]){
  const adapter=createJointCountHttpAdapter({enabled:()=>true,loadHandler:loader});
  const r=response();await adapter(req(),r);
  assert.equal(r.statusCode,503);
  assert.equal(r.body.includes(TOKEN),false);
  assert.equal(r.body.includes("PRIVATE"),false);
 }
});

test("allowlisted hub-owner ranking shape remains readable without private source records",async()=>{
 const hub={schema:"nico-verified-dual-count-v1",role:"hub_owner",unit:"件",
  period:"month",range:{start:"2026-11-01",end:"2026-11-09",
   previousStart:"2026-10-01",previousEnd:"2026-10-09",days:9},
  readTime:"2026-11-09T00:00:00.000Z",
  summary:{own:3,partner:2,total:5,unidentified:0},
  memberRanking:[{id:"company:uid",name:"営業担当",companyId:"company",
   companyName:"自社",teamId:"team",teamName:"営業班",count:3,
   reportStatus:"報告済",reportedDays:1,previousCount:0,change:3,
   growth:"増加",topProduct:"NURO光",remainingToGoal:2,
   personalBestStatus:"比較不可",rank:1}],
  productRanking:[{id:"sku",name:"NURO光",count:5,ownCount:3,
   partnerCount:2,companies:[{companyId:"company",companyName:"自社",count:3}]}],
  companyBreakdown:[{id:"company",name:"自社",kind:"自社",
   count:3,unidentifiedCount:0}],
  teamBreakdown:[{id:"company:team",companyId:"company",
   companyName:"自社",name:"営業班",count:3}],
  filters:{companyId:"",teamId:"",uid:"",productId:""}};
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>make(200,hub)});
 const out=response();await adapter(req(),out);
 assert.equal(out.statusCode,200);
 assert.deepEqual(JSON.parse(out.body),hub);
});
test("unexpected financial aliases, arbitrary fields and monetary text fail closed",async()=>{
 const cases=[
  {...data(),salary:50000},
  {...data(),publicRanking:{members:[{rank:1,name:"営業担当",
   count:2,company:"協力店",internalBillingRate:10000}],products:[]}},
  {...data(),publicRanking:{members:[],products:[
   {rank:1,name:"NURO光 10000円",count:2}]}},
  {...data(),summary:{own:1,partner:1,total:2,
   unidentified:0,bonusYen:20000}},
  {...data(),unknownDebugPayload:"secret"}
 ];
 for(const item of cases){
  const adapter=createJointCountHttpAdapter({enabled:()=>true,
   loadHandler:()=>make(200,item)});
  const out=response();await adapter(req(),out);
  assert.equal(out.statusCode,503);
  assert.deepEqual(JSON.parse(out.body),{error:"request_blocked"});
 }
});
test("transient backend loader failure does not permanently poison future GET",async()=>{
 let attempts=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>{
   attempts++;
   if(attempts===1)throw Error("temporary initialization failure");
   return make();
  }});
 const first=response();await adapter(req(),first);
 assert.equal(first.statusCode,503);
 const second=response();await adapter(req(),second);
 assert.equal(second.statusCode,200);
 assert.equal(attempts,2);
});
test("invalid Content-Length never reaches the backend",async()=>{
 let loads=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>{loads++;return make();}});
 for(const length of ["invalid","-1","1","NaN"]){
  const out=response();await adapter(req(URL_PATH,{
   headers:{"content-length":length}}),out);
  assert.equal(out.statusCode,400);
 }
 assert.equal(loads,0);
});


test("direct Cloud Function ingress is accepted and normalized to the same authenticated canonical path",async()=>{
 const direct="/getVerifiedJointCountRanking?month=2026-11";
 let seen=null,called=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>async request=>{
   called++;seen=request;
   return new Response(JSON.stringify(data()),{status:200});
  }});
 const res=response();
 await adapter(req(direct),res);
 assert.equal(res.statusCode,200);
 assert.equal(called,1);
 assert.equal(seen.url,ORIGIN+URL_PATH);
 assert.equal(seen.headers.get("Authorization"),TOKEN);
 assert.equal(seen.headers.get("Origin"),ORIGIN);
 assert.deepEqual(JSON.parse(res.body),data());
});
test("only exact Hosting and direct Function paths are allowed, no prefix or path impersonation",async()=>{
 let called=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>{called++;return make();}});
 for(const badPath of [
  "/getVerifiedJointCountRankingExtra?month=2026-11",
  "/getVerifiedJointCountRanking/v2?month=2026-11",
  "/getVerifiedJointCountRanking/../admin?month=2026-11",
  "/v1/owner-visible-counts-extra?month=2026-11",
  "//evil.example/getVerifiedJointCountRanking?month=2026-11"
 ]){
  const out=response();
  await adapter(req(badPath),out);
  assert.equal(out.statusCode,404,badPath);
 }
 assert.equal(called,0);
});

test("approved company and team count-only rankings can cross authenticated Function boundary",async()=>{
 const payload=data();
 payload.publicRanking.companies=[
  {rank:1,name:"協力店",count:5},{rank:2,name:"自社",count:3}];
 payload.publicRanking.teams=[
  {rank:1,name:"営業班",company:"協力店",count:5},
  {rank:2,name:"営業班",company:"自社",count:3}];
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>make(200,payload)});
 const out=response();await adapter(req(),out);
 assert.equal(out.statusCode,200);
 assert.deepEqual(JSON.parse(out.body).publicRanking.companies,
  payload.publicRanking.companies);
 assert.deepEqual(JSON.parse(out.body).publicRanking.teams,
  payload.publicRanking.teams);
 const bad=structuredClone(payload);
 bad.publicRanking.teams[0].salary=20000;
 const rejected=response();
 const guarded=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>make(200,bad)});
 await guarded(req(),rejected);
 assert.equal(rejected.statusCode,503);
 assert.deepEqual(JSON.parse(rejected.body),{error:"request_blocked"});
});


test("raw ingress path rejects URL-normalized traversal and percent-encoded aliases before backend loading",async()=>{
 let loads=0;
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>{loads++;return make();}});
 for(const bad of [
  "/v1/anything/../owner-visible-counts?month=2026-11",
  "/v1/%2e/owner-visible-counts?month=2026-11",
  "/v1/other/%2e%2e/owner-visible-counts?month=2026-11",
  "/getVerifiedJointCountRanking/../getVerifiedJointCountRanking?month=2026-11",
  "/%67etVerifiedJointCountRanking?month=2026-11",
  "/v1//owner-visible-counts?month=2026-11"
 ]){
  const out=response();
  await adapter(req(bad),out);
  assert.equal(out.statusCode,404,bad);
  assert.deepEqual(JSON.parse(out.body),{error:"request_blocked"});
 }
 assert.equal(loads,0,"invalid paths never initialize Auth/Firestore handler");
});

test("partner public ranking never accepts hub-only IDs, finance fields or internal leaderboard blocks",async()=>{
 const mutations=[
  p=>{p.publicRanking.members[0].uid="internalUid";},
  p=>{p.publicRanking.members[0].teamId="privateTeam";},
  p=>{p.publicRanking.products[0].companyId="internal";},
  p=>{p.publicRanking.teams=[{rank:1,name:"営業班",company:"協力店",
   count:5,companyId:"internal"}];},
  p=>{p.memberRanking=[{id:"private",name:"担当者",count:5}];},
  p=>{p.summary={own:5,partner:1,total:6,unidentified:0};},
  p=>{p.publicRanking.companies=[{rank:1,name:"協力店",count:5,
   sourceId:"privateSource"}];},
  p=>{p.publicRanking.members[0].rank=0;},
  p=>{p.publicRanking.products[0].count=-1;}
 ];
 for(const mutate of mutations){
  const p=data();mutate(p);
  const adapter=createJointCountHttpAdapter({enabled:()=>true,
   loadHandler:()=>make(200,p)});
  const out=response();await adapter(req(),out);
  assert.equal(out.statusCode,503,mutate.toString());
  assert.deepEqual(JSON.parse(out.body),{error:"request_blocked"});
 }
});

test("role envelopes reject allowlisted but unauthorized partner aggregates and nested data",async()=>{
 const mutations=[
  p=>{p.partner=99;},
  p=>{p.total=99;},
  p=>{p.people=[{name:"other company",count:5}];},
  p=>{p.own.partner=99;},
  p=>{p.own.products=[{id:"sku",name:"NURO",count:5,partnerCount:99}];},
  p=>{p.own.people=[{id:"other:uid",name:"他社",count:5}];},
  p=>{p.own.count=-1;},
  p=>{p.own.unidentifiedCount=6;}
 ];
 for(const mutate of mutations){
  const p=data();mutate(p);
  const adapter=createJointCountHttpAdapter({enabled:()=>true,
   loadHandler:()=>make(200,p)});
  const out=response();await adapter(req(),out);
  assert.equal(out.statusCode,503,mutate.toString());
  assert.deepEqual(JSON.parse(out.body),{error:"request_blocked"});
 }
});
test("exact partner own product and person projections remain accepted",async()=>{
 const p=data();p.own={company:"協力店",count:5,unidentifiedCount:0,
  products:[{id:"sku",name:"NURO光",count:5}],
  people:[{id:"company:uid",name:"営業担当",companyId:"company",
   companyName:"協力店",teamId:null,teamName:null,count:5,
   reportStatus:"報告済",reportedDays:1,previousCount:0,change:5,
   growth:"増加",topProduct:"NURO光",remainingToGoal:0,
   personalBestStatus:"比較不可",rank:1}]};
 const adapter=createJointCountHttpAdapter({enabled:()=>true,
  loadHandler:()=>make(200,p)});
 const out=response();await adapter(req(),out);
 assert.equal(out.statusCode,200);
 assert.deepEqual(JSON.parse(out.body),p);
});
test("NFKC-normalized money labels cannot cross the partner ranking HTTP boundary",async()=>{
 for(const name of ["担当者 ＣＢ５０００","商品 cash back 3000",
  "担当者 unit price 2500","担当者 ＲＥＶＥＮＵＥ９０００"]){
  const p=data();p.publicRanking.members[0].name=name;
  const adapter=createJointCountHttpAdapter({enabled:()=>true,
   loadHandler:()=>make(200,p)});
  const out=response();await adapter(req(),out);
  assert.equal(out.statusCode,503,name);
  assert(!out.body.includes(name));
 }
});
