import test from "node:test";
import assert from "node:assert/strict";
import {createInternalCountPage} from "../cloudflare-finance/src/internal-count-page.mjs";
const p={
 uid:"u",companyId:"direct",firebaseIdTokenVerified:true,emailVerified:true,
 serverMembershipVerified:true,serverVerifiedInternalCompany:true,
 company:{active:true,companyKind:"internal",ownerUid:"owner"},
 user:{uid:"u",companyId:"direct",companyRole:"member",active:true},
 member:{uid:"u",companyId:"direct",companyRole:"member",active:true}
};
const rows=Array.from({length:123},(_,i)=>({
 id:"record_"+String(i).padStart(4,"0"),companyId:"direct",uid:"u",date:"2026-10-31",
 teamId:"team1",memberNameSnapshot:"担当",teamNameSnapshot:"第一班",
 results:{"nuro__cb_1":{productId:"nuro",count:1,revenuePerUnit:100000,cashback:99999}},
 totalCount:1,totalRevenue:100000
}));
const product={id:"nuro",companyId:"direct",name:"NURO",active:true,
 revenue:100000,pricingOptions:[{cashback:99999,revenuePerUnit:100000}]};
const snapshot="2026-10-31T06:14:00Z";
function setup({who={uid:"u",emailVerified:true},member=p,source=rows,enabled=true}={}){
 const traces=[],api=createInternalCountPage({
  enabled,
  authenticate:async bearer=>{traces.push(["auth",bearer.length]);return who;},
  loadMembership:async uid=>{traces.push(["member",uid]);return member;},
  queryDailyRecords:async ({companyId,date,cursor,readTime,pageSize})=>{
   traces.push(["page",companyId,date,cursor,readTime,pageSize]);
   assert.equal(companyId,"direct");
   assert.equal(date,"2026-10-31");
   assert.equal(pageSize,50);
   const after=cursor?source.findIndex(r=>r.id===cursor)+1:0;
   const out=source.slice(after,after+pageSize);
   return {records:out,readTime:snapshot,hasMore:after+pageSize<source.length,
    nextCursor:after+pageSize<source.length?out.at(-1).id:null};
  },
  queryProducts:async ({companyId})=>{assert.equal(companyId,"direct");return [product];}
 });
 return {api,traces};
}
test("paginates >50 and >100 records without losing any day count, never returns money",async()=>{
 const {api,traces}=setup(),all=[];
 let cursor="",readTime="";
 for(let page=0;page<4;page++){
  const r=await api({bearer:"a".repeat(30),day:"2026-10-31",cursor,readTime});
  assert.equal(r.companyId,"direct");
  assert.equal(r.products[0].name,"NURO");
  for(const x of r.records)all.push(x);
  const content=JSON.stringify(r);
  for(const forbidden of ["100000","99999","revenuePerUnit","pricingOptions",
    "totalRevenue","cashback","__cb_"]){
   assert.equal(content.includes(forbidden),false,forbidden+" leaked");
  }
  if(!r.hasMore)break;
  cursor=r.nextCursor;readTime=r.readTime;
 }
 assert.equal(all.length,123);
 assert.equal(new Set(all.map(r=>r.sourceId)).size,123);
 assert.equal(all.reduce((sum,r)=>sum+r.totalCount,0),123);
 assert.equal(traces.filter(x=>x[0]==="page").length,3);
});
test("disabled by default, no calls to any authentication or backing Firestore adapter",async()=>{
 const {api,traces}=setup({enabled:false});
 await assert.rejects(api({bearer:"a".repeat(30),day:"2026-10-31"}),/unavailable/);
 assert.deepEqual(traces,[]);
});
test("never allow forged scope, partner credentials, changed snapshot or cross-company raw records",async()=>{
 const {api}=setup({member:{...p,company:{active:true,companyKind:"partner"}}});
 await assert.rejects(api({bearer:"a".repeat(30),day:"2026-10-31"}),/internal_count_bridge_denied/);
 const foreign={...rows[0],companyId:"foreign"};
 const {api:cross}=setup({source:[foreign]});
 await assert.rejects(cross({bearer:"a".repeat(30),day:"2026-10-31"}),/internal_count_bridge_denied/);
 const {api:auth}=setup({who:{uid:"x",emailVerified:true}});
 await assert.rejects(auth({bearer:"a".repeat(30),day:"2026-10-31"}),/forbidden/);
 const {api:clock}=setup();
 await assert.rejects(clock({bearer:"a".repeat(30),day:"2026-10-31",cursor:"id",readTime:"2001-01-01T00:00:00Z"}),/snapshot/);
});
test("rejects dates, missing signed token and pagination cursor tampering",async()=>{
 const {api,traces}=setup();
 for(const q of [
  {bearer:"short",day:"2026-10-31"},
  {bearer:"a".repeat(30),day:"2026-02-30"},
  {bearer:"a".repeat(30),day:"2026-10-31",cursor:"a"},
  {bearer:"a".repeat(30),day:"2026-10-31",readTime:snapshot}
 ])await assert.rejects(api(q));
 assert.deepEqual(traces,[]);
});
