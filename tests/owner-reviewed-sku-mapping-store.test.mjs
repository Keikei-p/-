import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerReviewedSkuMappingStore}
 from "../ranking/owner-reviewed-sku-mapping-store.mjs";

const owner={uid:"owner",emailVerified:true};
function fake(){
 const state=new Map([
  ["users/owner",{uid:"owner",companyId:"hub",companyRole:"owner",
    active:true,accessKind:"internal"}],
  ["companies/hub",{ownerUid:"owner",companyKind:"internal",active:true}],
  ["companies/hub/members/owner",{uid:"owner",companyId:"hub",active:true,
    companyRole:"owner",accessKind:"internal"}],
  ["companies/partner",{companyKind:"partner",active:true,hubCompanyId:"hub"}],
  ["partnerRelations/partner",{hubCompanyId:"hub",partnerCompanyId:"partner",
    active:true,countSharingApproved:true}],
  ["products/nuro",{companyId:"hub",name:"NURO光",active:true,
    revenue:50000,unitPrice:25000,cashback:2000}],
  ["products/air",{companyId:"hub",name:"SoftBank Air",active:true,
    revenue:10000}],
  ["products/legacy",{companyId:"hub",name:"SB光・AIR（旧合算・未分類）",active:true}]
 ]);
 let writes=0,serial=0;
 const ref=path=>({path,doc(id){return ref(path+"/"+(id??("audit"+(++serial))))},
  collection(name){return ref(path+"/"+name)}});
 const tx={
  async get(r){const value=state.get(r.path);
   return {exists:value!==undefined,data(){return structuredClone(value)}}},
  create(r,value){if(state.has(r.path))throw Error("ALREADY_EXISTS");
   writes++;state.set(r.path,structuredClone(value))},
  update(r,value){if(!state.has(r.path))throw Error("NO_DOC");
   writes++;state.set(r.path,{...state.get(r.path),...structuredClone(value)})}
 };
 const db={collection:ref,async runTransaction(fn){return fn(tx)}};
 const FieldValue={serverTimestamp:()=>"SERVER_TIMESTAMP"};
 const store=createOwnerReviewedSkuMappingStore({db,FieldValue});
 return {store,state,get writes(){return writes}};
}
test("missing owner-reviewed mapping starts at empty version 0, never auto-joins labels",async()=>{
 const f=fake(),s=await f.store.status(owner);
 assert.deepEqual(s,{schema:"nico-owner-reviewed-sku-map-v1",
  hubCompanyId:"hub",version:0,bindings:[]});
 assert.equal(f.writes,0);
 assert(!JSON.stringify(s).includes("revenue"));
});
test("owner writes exact approved NURO mapping, version + append-only audit, no sales edit",async()=>{
 const f=fake(),original=structuredClone(f.state.get("products/nuro"));
 const saved=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0});
 assert.equal(saved.saved,true);
 assert.equal(saved.version,1);
 assert.deepEqual(f.state.get("products/nuro"),original);
 const map=f.state.get("companies/hub/rankingSkuMappings/shared");
 assert.deepEqual(map.bindings,[{companyId:"partner",
   productId:"partnerSku01",hubProductId:"nuro"}]);
 assert.equal(map.reviewedByUid,"owner");
 assert.equal(f.writes,2,"one mapping doc plus audit, no source edits");
 const duplicate=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:1});
 assert.equal(duplicate.saved,false);
 assert.equal(f.writes,2);
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku02",hubProductId:"air",expectedVersion:0}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 assert.equal(f.writes,2);
});
test("old combined 光・AIR cannot map to independent Air, stays intact; explicit combined SKU allowed",async()=>{
 const f=fake();
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku05",hubProductId:"air",expectedVersion:0}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 assert.equal(f.writes,0);
 const correct=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku05",hubProductId:"legacy",expectedVersion:0});
 assert.equal(correct.saved,true);
 assert.equal(f.state.get("products/legacy").name,"SB光・AIR（旧合算・未分類）");
 assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared").bindings,
  [{companyId:"partner",productId:"partnerSku05",hubProductId:"legacy"}]);
});
test("removal is an audited mapping change, never deletes any count or product master",async()=>{
 const f=fake(),orig=structuredClone([...f.state.entries()].filter(([p])=>
  p.startsWith("products/")));
 await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0});
 const remove=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:null,expectedVersion:1});
 assert.deepEqual(remove,{saved:true,version:2,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:null});
 assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared").bindings,[]);
 assert.deepEqual([...f.state.entries()].filter(([p])=>p.startsWith("products/")),orig);
 assert.equal(f.writes,4);
});
test("partner user, double membership, revoked relation, unknown SKU and finance target deny before writes",async()=>{
 const variants=[
  f=>f.state.set("users/owner",{...f.state.get("users/owner"),companyRole:"member"}),
  f=>f.state.set("partnerWorkspaceContexts/owner",{active:true}),
  f=>f.state.set("partnerRelations/partner",{...f.state.get("partnerRelations/partner"),active:false}),
  f=>f.state.set("companies/partner",{...f.state.get("companies/partner"),hubCompanyId:"foreign"}),
  f=>f.state.set("products/nuro",{...f.state.get("products/nuro"),name:"NURO単価25,000円"}),
  f=>f.state.set("products/nuro",{...f.state.get("products/nuro"),active:false})
 ];
 for(const mutate of variants){
  const f=fake();mutate(f);
  await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
   partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0}),
   /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
  assert.equal(f.writes,0);
 }
 const f=fake();
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"privatePartnerSku",hubProductId:"nuro",expectedVersion:0}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"other",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 assert.equal(f.writes,0);
});

test("a hub SKU cannot be mapped to two categories in the same partner; removal remains auditable",async()=>{
 const f=fake();
 await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0});
 const before=f.writes;
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku02",hubProductId:"nuro",expectedVersion:1}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 assert.equal(f.writes,before,"no mapping, audit or financial writes on duplicate");
 assert.equal(f.state.get("companies/hub/rankingSkuMappings/shared").version,1);
 const remove=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:null,expectedVersion:1});
 assert.equal(remove.version,2);
 const assign=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku02",hubProductId:"nuro",expectedVersion:2});
 assert.equal(assign.version,3);
 assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared").bindings,
  [{companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"}]);
 assert.equal(f.writes,6,"only successful mapping revisions create audits");
});
