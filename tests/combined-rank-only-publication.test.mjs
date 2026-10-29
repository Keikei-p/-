import test from "node:test";
import assert from "node:assert/strict";
import {createRankOnlyPublication} from "../ranking/rank-only-publication.mjs";
import {createStagedCombinedRankReadHandler} from "../ranking/combined-rank-only-handler.mjs";
import {renderCombinedRankOnlyScreen,validateRankOnlyPublication}
 from "../ranking/rank-only-view.mjs";

const TIME="2026-10-29T01:00:00Z",MONTH="2026-10";
function sample(){
 const record=(companyId,id,uid,teamId,totalCount)=>({
  companyId,sourceId:id,uid,date:"2026-10-29",teamId,totalCount,
  reportStatus:"submitted",memberNameSnapshot:"担当"+uid,teamNameSnapshot:"班"+teamId,
  workLocation:"会場"
 });
 const a=record("own","r1","u1","team1",3),b=record("partner","r2","u2","team2",5);
 const line=(r,productId)=>({companyId:r.companyId,sourceId:r.sourceId+"__line",
  recordId:r.sourceId,date:r.date,uid:r.uid,teamId:r.teamId,
  productId,count:r.totalCount});
 const source=(companyId,label,kind,teamId,recordRow,productId)=>({
  companyId,companyLabel:label,kind,consentVerified:true,isComplete:true,readTime:TIME,
  teams:[{id:teamId,name:label+"班",goalCount:10}],
  records:[recordRow],lines:[line(recordRow,productId)],
  products:[{companyId,sourceId:productId,name:"共有光",active:true,sortOrder:1}]
 });
 return {hubCompanyId:"own",approvedCompanyIds:["own","partner"],period:MONTH,
  productGroups:[{companyId:"own",productId:"p1",groupId:"g1",groupName:"光"},
   {companyId:"partner",productId:"p2",groupId:"g1",groupName:"光"}],
  sources:[source("own","自社","own","team1",a,"p1"),
   source("partner","協力店A","partner","team2",b,"p2")]}
}
function server(){
 const calls={token:0,permission:0,source:0};
 const context={
  serverVerified:true,userActive:true,memberActive:true,companyActive:true,
  reciprocalOwnersApproved:true,individualNamesApproved:true,
  completeSnapshotBudgetApproved:true,
  viewerUid:"member",hubCompanyId:"own",viewerCompanyId:"partner",
  approvedCompanyIds:["own","partner"]
 };
 const deps={
  enabled:true,
  verifyFirebaseToken:async token=>{
   calls.token++;
   if(token!=="a".repeat(40))throw Error("bad token");
   return {uid:"member",emailVerified:true};
  },
  loadFreshApprovedContext:async()=>{calls.permission++;return structuredClone(context);},
  loadCompletePublicCountSources:async ({month})=>{
   calls.source++;
   const data=sample();data.period=month;return data;
  }
 };
 return {calls,context,deps};
}
function req(opts={}){
 const params=opts.params??"month="+MONTH;
 const url="https://nico-factory.web.app/v1/combined-ranks?"+params;
 return new Request(url,{method:opts.method??"GET",
  headers:{"Authorization":"Bearer "+(opts.token??"a".repeat(40)),
   "Origin":opts.origin??"https://nico-factory.web.app"}});
}
test("a reconciled company+partner report exposes ONLY ranks and names",()=>{
 const before=sample(),json=JSON.stringify(before);
 const pub=createRankOnlyPublication(before);
 assert.equal(pub.schema,"nico-combined-rank-only-v1");
 assert.equal(pub.period,MONTH);
 assert.deepEqual(pub.teamRanks.map(r=>r.rank),[1,2]);
 assert.deepEqual(pub.memberRanks.map(r=>r.rank),[1,2]);
 assert.equal(pub.productRanks[0].rank,1);
 assert.equal(pub.productRanks[0].members.length,2);
 assert(!/":(?:\s*)\d+(?:,|})/.test(JSON.stringify(pub).split('"period"')[0]));
 for(const key of ["count","totalCount","unitPrice","revenue","cashback","goalCount",
  "progressPercent","combinedGoalCount","score","unmappedProducts"]){
  assert(!new RegExp('"'+key+'"\\s*:','i').test(JSON.stringify(pub)),"private key "+key);
 }
 assert.equal(JSON.stringify(before),json,"no historical data mutation");
 assert.equal(validateRankOnlyPublication(pub),pub);
});
test("incomplete approval or snapshots never produce leaderboard",()=>{
 for(const mutate of [
  d=>{d.sources.pop();},
  d=>{d.sources[1].isComplete=false;},
  d=>{d.sources[1].consentVerified=false;},
  d=>{d.sources[1].readTime="2026-10-29T01:00:01Z";},
  d=>{d.sources[1].records[0].totalRevenue=99999;},
  d=>{d.sources[1].lines[0].count=4;},
  d=>{d.sources[1].teams[0].name="協力店5件";}
 ]){
  const d=sample();mutate(d);
  assert.throws(()=>createRankOnlyPublication(d));
 }
});
test("rank-only HTTP endpoint disabled unless explicitly wired server-side",async()=>{
 const h=createStagedCombinedRankReadHandler();
 const res=await h(req());
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{error:"service_disabled"});
});
test("authenticated, reciprocally approved rank service returns rank-only and no-store",async()=>{
 const s=server(),h=createStagedCombinedRankReadHandler(s.deps);
 const res=await h(req());
 assert.equal(res.status,200);
 assert.equal(res.headers.get("Cache-Control"),"no-store");
 assert.equal(res.headers.get("Access-Control-Allow-Origin"),"https://nico-factory.web.app");
 const pub=await res.json();
 assert.equal(pub.teamRanks.length,2);
 assert.equal(pub.memberRanks.length,2);
 assert.equal(pub.teamRanks[0].rank,1);
 assert(!("count" in pub.teamRanks[0]));
 assert(!("revenue" in pub.memberRanks[0]));
 assert.deepEqual(s.calls,{token:1,permission:1,source:1});
});
test("forged company, period, query, token, origin and method never read rank data",async()=>{
 const s=server(),h=createStagedCombinedRankReadHandler(s.deps);
 for(const opts of [
  {params:"month=2026-10&companyId=own"},
  {params:"month=2026-10&month=2026-10"},
  {params:"month=2026-13"},
  {params:"month=2026-10&amount=1"},
  {method:"POST"},
  {origin:"https://keikei-p.github.io"},
  {token:"b".repeat(40)}
 ]){
  const r=await h(req(opts));
  assert.notEqual(r.status,200);
  assert.equal((await r.json()).error,"request_blocked");
 }
 assert.equal(s.calls.source,0);
});
test("revoked company, no cross-company owner approval and invalid snapshots fail closed",async()=>{
 const s=server();
 for(const bad of [
  {memberActive:false},{companyActive:false},
  {reciprocalOwnersApproved:false},{individualNamesApproved:false},
  {completeSnapshotBudgetApproved:false},
  {viewerCompanyId:"unknown"},{viewerUid:"unknown"},
  {approvedCompanyIds:["own"]},{approvedCompanyIds:["own","partner","partner"]}
 ]){
  const h=createStagedCombinedRankReadHandler({
   ...s.deps,loadFreshApprovedContext:async()=>({...s.context,...bad})
  });
  const r=await h(req());
  assert.notEqual(r.status,200);
  assert.equal((await r.json()).error,"request_blocked");
 }
});
class FakeElement{
 constructor(tag){this.tagName=tag;this.children=[];this.textContent="";this.className="";}
 appendChild(x){this.children.push(x);return x;}
 replaceChildren(...x){this.children=[...x];}
}
const document={createElement:tag=>new FakeElement(tag)};
function words(node){return [node.textContent,...node.children.flatMap(words)].filter(Boolean).join(" ");}
test("responsive screen shows rank + company label only; never private count or revenue",()=>{
 const root=new FakeElement("main");
 const output=renderCombinedRankOnlyScreen({document,root,data:createRankOnlyPublication(sample())});
 assert.equal(root.children.length,1);
 assert.equal(output.tagName,"section");
 const text=words(root);
 for(const x of ["合同ランキング","個人ランキング","👑 1位","協力店A班"]){
  assert(text.includes(x),"missing "+x);
 }
 for(const x of ["99999円","売上","単価","件数","3件","5件"])
  assert(!text.includes(x),"private rank detail leaked: "+x);
 assert.throws(()=>renderCombinedRankOnlyScreen({document,root,data:{
  ...createRankOnlyPublication(sample()), memberRanks:[{name:"bad",rank:1,
    champion:true,company:"own",count:99999}]
 }}),/順位/);
 assert.equal(root.children.length,0,"stale ranks must be cleared on authorization failure");
});
test("untrusted HTML is always textContent and never injected as markup",()=>{
 const root=new FakeElement("main");
 const d=createRankOnlyPublication(sample());
 const overridden={...d,memberRanks:[{rank:1,name:"<img src=x onerror=alert(1)>",company:"自社",champion:true}]};
 renderCombinedRankOnlyScreen({document,root,data:overridden});
 assert(words(root).includes("<img src=x onerror=alert(1)>"));
 assert.equal(typeof root.innerHTML,"undefined");
});
