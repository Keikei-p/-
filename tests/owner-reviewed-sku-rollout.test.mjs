import test from "node:test";
import assert from "node:assert/strict";
import {planOwnerReviewedSkuRollout,applyOwnerReviewedSkuRollout}
 from "../ranking/owner-reviewed-sku-rollout.mjs";

const map=(version=3,bindings=[])=>({schema:"nico-owner-reviewed-sku-map-v1",
 hubCompanyId:"hub",version,bindings});
const bind=(companyId,productId,hubProductId)=>({companyId,productId,hubProductId});
const catalog=()=>({schema:"nico-hub-product-visibility-v1",role:"hub_owner",
 hubCompanyId:"hub",version:4,partnerOverrides:{},
 products:[
  {id:"nuro",name:"NURO光",active:true,enabled:true},
  {id:"combined",name:"SB光・AIR（旧合算）",active:true,enabled:true},
  {id:"water",name:"ウォーター",active:true,enabled:true},
  {id:"inactive",name:"旧商品",active:false,enabled:false}
 ]});
const owner={uid:"owner",emailVerified:true,getIdToken:async()=> "x".repeat(48)};
const source=[
 bind("partnerA","partnerSku01","nuro"),
 bind("partnerA","partnerSku05","combined"),
 bind("partnerA","partnerPrivate:oldid","water")
];

test("source Owner-reviewed legacy targets copy to two partners, private SKU stays company-specific",()=>{
 const plan=planOwnerReviewedSkuRollout({
  mapping:map(3,source),catalog:catalog(),
  sourceCompanyId:"partnerA",targetCompanyIds:["partnerB","partnerC"]
 });
 assert.equal(plan.totalApply,4);
 assert.equal(plan.plans.length,2);
 assert.deepEqual(plan.plans.map(x=>x.apply.map(b=>b.partnerProductId)),
  [["partnerSku01","partnerSku05"],["partnerSku01","partnerSku05"]]);
 assert.equal(plan.totalConflicts,0);
 assert.equal(plan.totalOff,0);
 assert(!JSON.stringify(plan).includes("oldid"));
});
test("existing mapping never overwritten; duplicate target remains conflict",()=>{
 // Both existing combined targets are genuinely combined products. The
 // historical partnerSku05 -> standalone product guard stays strict.
 const c=catalog();
 c.products.push({id:"combinedAlt",name:"SB光・AIR（旧合算・別管理）",
  active:true,enabled:true});
 const plan=planOwnerReviewedSkuRollout({
  mapping:map(3,[...source,
   bind("partnerB","partnerSku01","nuro"),
   bind("partnerB","partnerPrivate:oldCombined","combined"),
   bind("partnerC","partnerSku05","combinedAlt")]),
  catalog:c,sourceCompanyId:"partnerA",
  targetCompanyIds:["partnerB","partnerC"]
 });
 assert.equal(plan.totalApply,1); // partnerC's NURO is missing
 assert.equal(plan.totalExisting,1);
 assert.equal(plan.totalConflicts,2);
 assert.deepEqual(plan.plans[0].apply,[]);
 assert.deepEqual(plan.plans[1].apply,[{
  partnerProductId:"partnerSku01",hubProductId:"nuro"
 }]);
});
test("global OFF and company override OFF prevent new mapping without erasing the old mapping",()=>{
 const c=catalog();c.products[1].enabled=false;
 c.partnerOverrides.partnerC=["combined"];
 const p=planOwnerReviewedSkuRollout({
  mapping:map(3,source),catalog:c,sourceCompanyId:"partnerA",
  targetCompanyIds:["partnerB","partnerC"]
 });
 assert.equal(p.totalApply,1);
 assert.equal(p.totalOff,3);
 assert.equal(p.totalExisting,0);
});
test("no Owner-reviewed source binding never guesses a product from similar names",()=>{
 const p=planOwnerReviewedSkuRollout({
  mapping:map(),catalog:catalog(),sourceCompanyId:"partnerA",
  targetCompanyIds:["partnerB","partnerC"]
 });
 assert.equal(p.totalApply,0);
 assert.deepEqual(p.plans.map(x=>x.apply),[[],[]]);
});
test("duplicate existing mapping and forged company target fail closed",()=>{
 for(const bindings of [
  [bind("partnerA","partnerSku01","nuro"),bind("partnerA","partnerSku02","nuro")],
  [bind("partnerA","partnerSku01","nuro"),bind("partnerA","partnerSku01","combined")]
 ]){
  assert.throws(()=>planOwnerReviewedSkuRollout({
   mapping:map(3,bindings),catalog:catalog(),
   sourceCompanyId:"partnerA",targetCompanyIds:["partnerB"]
  }),/OWNER_SKU_ROLLOUT_UNVERIFIED/);
 }
 for(const targetCompanyIds of [["partnerB","partnerB"],["hub"],["partnerA"],["../other"]]){
  assert.throws(()=>planOwnerReviewedSkuRollout({
   mapping:map(3,source),catalog:catalog(),
   sourceCompanyId:"partnerA",targetCompanyIds
  }),/OWNER_SKU_ROLLOUT_UNVERIFIED/);
 }
});
function harness(){
 const auth={currentUser:owner},c=catalog();let version=3;
 let bindings=[...source],reads=0,writes=0;
 const readMappings=async()=>{reads++;return map(version,structuredClone(bindings));};
 const readProducts=async()=>structuredClone(c);
 const saveMapping=async request=>{
  assert.equal(request.expectedVersion,version);
  assert.equal(request.token,"x".repeat(48));
  assert(!bindings.some(b=>b.companyId===request.partnerCompanyId&&
   b.productId===request.partnerProductId),"never override an existing binding");
  writes++;version++;
  bindings.push(bind(request.partnerCompanyId,request.partnerProductId,
   request.hubProductId));
  return {saved:true,version,partnerCompanyId:request.partnerCompanyId,
   partnerProductId:request.partnerProductId,hubProductId:request.hubProductId};
 };
 const plan=()=>planOwnerReviewedSkuRollout({mapping:map(version,bindings),
  catalog:c,sourceCompanyId:"partnerA",targetCompanyIds:["partnerB","partnerC"]});
 return {auth,readMappings,readProducts,saveMapping,plan,
  get reads(){return reads},get writes(){return writes},
  get bindings(){return bindings}};
}
test("page load and unconfirmed preview perform zero calls/writes",async()=>{
 const h=harness(),p=h.plan();
 assert.equal(h.writes,0);assert.equal(h.reads,0);
 assert.deepEqual(await applyOwnerReviewedSkuRollout({
  confirmed:false,plan:p,...h
 }),{status:"not_confirmed",verified:0});
 assert.equal(h.writes,0);assert.equal(h.reads,0);
});
test("explicit Owner action saves only reviewed ID mappings with fresh versioned readback",async()=>{
 const h=harness(),p=h.plan(),before=structuredClone(source);
 const result=await applyOwnerReviewedSkuRollout({
  confirmed:true,plan:p,auth:h.auth,
  readMappings:h.readMappings,readProducts:h.readProducts,
  saveMapping:h.saveMapping
 });
 assert.deepEqual(result,{status:"verified",verified:4,planned:4});
 assert.equal(h.writes,4);
 assert.deepEqual(h.bindings.slice(0,3),before,"never rewrite historical source company");
 assert.equal(h.bindings.length,7);
});
test("concurrent version drift stops before any new mapping write",async()=>{
 const h=harness(),p=h.plan();
 const result=await applyOwnerReviewedSkuRollout({
  confirmed:true,plan:p,auth:h.auth,
  readMappings:async()=>map(99,source),
  readProducts:h.readProducts,saveMapping:h.saveMapping
 });
 assert.equal(result.status,"partial_or_blocked");
 assert.equal(result.verified,0);
 assert.equal(h.writes,0);
});
test("revoked identity stops further rollout, keeping confirmed steps auditable",async()=>{
 const h=harness(),p=h.plan();
 let writes=0;
 const reply=await applyOwnerReviewedSkuRollout({
  confirmed:true,plan:p,auth:h.auth,readMappings:h.readMappings,
  readProducts:h.readProducts,saveMapping:async args=>{
   const result=await h.saveMapping(args);
   if(++writes===1)h.auth.currentUser=null;
   return result;
  }
 });
 assert.equal(reply.status,"partial_or_blocked");
 assert.equal(reply.verified,0,"never claim readback proof after account change");
 assert.equal(h.writes,1,"one server-confirmed write may have happened before sign-out");
});

test("rollout rejects string-shaped target roster before any action",()=>{
 assert.throws(()=>planOwnerReviewedSkuRollout({
  mapping:map(3,source),catalog:catalog(),sourceCompanyId:"partnerA",
  targetCompanyIds:"partnerB"
 }),/OWNER_SKU_ROLLOUT_UNVERIFIED/);
});
test("changing company during rollout cancels all subsequent writes",async()=>{
 const h=harness(),p=h.plan();
 let cancelled=false;
 const result=await applyOwnerReviewedSkuRollout({
  confirmed:true,plan:p,auth:h.auth,
  readMappings:h.readMappings,readProducts:h.readProducts,
  saveMapping:async data=>{
   const saved=await h.saveMapping(data);
   cancelled=true;
   return saved;
  },canContinue:()=>!cancelled
 });
 assert.equal(result.status,"partial_or_blocked");
 assert.equal(result.verified,0);
 assert.equal(h.writes,1,
  "in-flight save may commit, but no following partner writes occur");
});

test("historical combined 光/AIR cannot fan out into an individual 光 or AIR SKU",()=>{
 const c=catalog();
 c.products.push({id:"airOnly",name:"SoftBank Air",active:true,enabled:true});
 c.products.push({id:"lightOnly",name:"SoftBank光",active:true,enabled:true});
 for(const targetId of ["airOnly","lightOnly","water","missingId"]){
  assert.throws(()=>planOwnerReviewedSkuRollout({
   mapping:map(3,[
    bind("partnerA","partnerSku01","nuro"),
    bind("partnerA","partnerSku05",targetId)
   ]),
   catalog:c,sourceCompanyId:"partnerA",
   targetCompanyIds:["partnerB","partnerC"]
  }),/OWNER_SKU_ROLLOUT_UNVERIFIED/);
 }
 // The original combined SKU remains legitimate when its target is combined.
 const okay=planOwnerReviewedSkuRollout({
  mapping:map(3,source),catalog:c,sourceCompanyId:"partnerA",
  targetCompanyIds:["partnerB","partnerC"]
 });
 assert.equal(okay.totalApply,4);
 assert.equal(okay.plans[0].apply.find(p=>p.partnerProductId==="partnerSku05").hubProductId,"combined");
});


test("rollout rejects unrelated generic 旧合算 and 未分類 names as combined product targets",()=>{
 for(const name of ["NURO旧合算","U-NEXT（未分類）","太陽光/AIR（旧合算）"]){
  const c=catalog();
  c.products.find(p=>p.id==="combined").name=name;
  assert.throws(()=>planOwnerReviewedSkuRollout({
   mapping:map(3,source),catalog:c,
   sourceCompanyId:"partnerA",targetCompanyIds:["partnerB","partnerC"]
  }),/OWNER_SKU_ROLLOUT_UNVERIFIED/);
 }
});
