"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createOwnerSkuMappingCallables}=require(
 "../functions-ranking-approvals/owner-sku-mapping-controller.cjs");
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code}
}
const TOKEN="a".repeat(48);
const actor={uid:"owner",email:"owner@example.test",emailVerified:true};
function request(data={},overrides={}){
 return {auth:{uid:"owner",token:{email:actor.email,email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+TOKEN}},data,...overrides};
}
function setup({enabled=true,view,saveResult}={}){
 let authCalls=0,reads=0,writes=0,loaded=0;
 const services={
  createOwnerReviewedSkuMappingStore:()=>({
   async status(principal){
    reads++;assert.deepEqual(principal,actor);
    return view??{schema:"nico-owner-reviewed-sku-map-v1",
     hubCompanyId:"hub",version:0,bindings:[]};
   },
   async change(data){
    writes++;assert.deepEqual(data.principal,actor);
    return saveResult??{saved:true,version:1,
     partnerCompanyId:data.partnerCompanyId,
     partnerProductId:data.partnerProductId,
     hubProductId:data.hubProductId};
   }
  })
 };
 const verified={createVerifiedRankTokenReader:({auth})=>async token=>{
  authCalls++;
  assert.equal(token,TOKEN);
  return actor;
 }};
 const api=createOwnerSkuMappingCallables({
  db:{},FieldValue:{},getAuth:()=>({}),HttpsError,
  enabled:()=>enabled,
  modules:async()=>{loaded++;return [verified,services]}
 });
 return {api,get authCalls(){return authCalls},get reads(){return reads},
  get writes(){return writes},get loaded(){return loaded}};
}
const valid={partnerCompanyId:"partner",partnerProductId:"partnerSku01",
 hubProductId:"nuro",expectedVersion:0};
test("default OFF rejects with zero login, DB, module initialization or writes",async()=>{
 const x=setup({enabled:false});
 await assert.rejects(x.api.get(request()),e=>e.code==="failed-precondition");
 await assert.rejects(x.api.save(request(valid)),e=>e.code==="failed-precondition");
 assert.equal(x.loaded,0);assert.equal(x.reads,0);assert.equal(x.writes,0);
});
test("verified owner GET provides versioned ID-only mapping without finance",async()=>{
 const x=setup({view:{schema:"nico-owner-reviewed-sku-map-v1",
  hubCompanyId:"hub",version:3,
  bindings:[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"}]
 }});
 const data=await x.api.get(request());
 assert.deepEqual(data.bindings,[{companyId:"partner",
  productId:"partnerSku01",hubProductId:"nuro"}]);
 assert.equal(x.reads,1);assert.equal(x.writes,0);assert.equal(x.authCalls,1);
 assert(!/revenue|cashback|unitPrice/.test(JSON.stringify(data)));
});
test("verified owner writes only ID pairing/version, no products or count originals",async()=>{
 const x=setup();
 const saved=await x.api.save(request(valid));
 assert.deepEqual(saved,{saved:true,version:1,
  partnerCompanyId:"partner",partnerProductId:"partnerSku01",
  hubProductId:"nuro"});
 assert.equal(x.writes,1);assert.equal(x.reads,0);
});
test("revocation/UID/email mismatch and forged company identity never reach persistence",async()=>{
 for(const r of [
  request({}, {auth:null}),
  request({}, {auth:{uid:"different",token:{email:actor.email,email_verified:true}}}),
  request({}, {auth:{uid:"owner",token:{email:"other@example.test",email_verified:true}}}),
  request({}, {rawRequest:{headers:{authorization:"Bearer short"}}}),
  request({companyId:"hub"}),
  request({ownerUid:"owner"}),
  request({role:"hub_owner"})
 ]){
  const x=setup();
  await assert.rejects(x.api.get(r),e=>
   ["invalid-argument","unauthenticated"].includes(e.code));
  assert.equal(x.reads,0);assert.equal(x.writes,0);
 }
});
test("invalid product IDs, current month price and duplicate hidden fields reject before write",async()=>{
 for(const bad of [
  {...valid,productId:"nuro"},
  {...valid,partnerProductId:"old_legacy"},
  {...valid,hubProductId:"../records"},
  {...valid,hubProductId:"__proto__"},
  {...valid,hubProductId:1000},
  {...valid,expectedVersion:-1},
  {...valid,expectedVersion:"0"},
  {...valid,sales:10000},
  {...valid,hubCompanyId:"hub"},
  {...valid,partnerCompanyId:"hub",ownerRole:"owner"}
 ]){
  const x=setup();
  await assert.rejects(x.api.save(request(bad)),
   e=>e.code==="invalid-argument");
  assert.equal(x.writes,0);
 }
});
test("legacy mixed SKU can be requested but never inferred: store alone authorizes approved target",async()=>{
 const x=setup();
 const payload={...valid,partnerProductId:"partnerSku05",hubProductId:"legacy"};
 const saved=await x.api.save(request(payload));
 assert.equal(saved.partnerProductId,"partnerSku05");
 assert.equal(saved.hubProductId,"legacy");
 // The canonical Firestore store independently refuses a partnerSku05 to Air.
});
test("an unexpected financial field in store status is not returned",async()=>{
 const x=setup({view:{schema:"nico-owner-reviewed-sku-map-v1",
  hubCompanyId:"hub",version:1,bindings:[],revenue:20000}});
 await assert.rejects(x.api.get(request()),e=>e.code==="permission-denied");
});
