import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerReviewedSkuMappingStore}
 from "../ranking/owner-reviewed-sku-mapping-store.mjs";

const owner={uid:"owner",emailVerified:true};
function fake({includeHistoricalGroups=false}={}){
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
  collection(name){return ref(path+"/"+name)},limit(n){return {path,max:n}}});
 const snap=(path,value)=>({id:path.split("/").at(-1),
  exists:value!==undefined,data(){return structuredClone(value)}});
 const tx={
  async get(r){
   if(r.max)return {docs:[...state].filter(([path])=>path.startsWith(r.path+"/"))
    .slice(0,r.max).map(([path,value])=>snap(path,value))};
   return snap(r.path,state.get(r.path));
  },
  create(r,value){if(state.has(r.path))throw Error("ALREADY_EXISTS");
   writes++;state.set(r.path,structuredClone(value))},
  update(r,value){if(!state.has(r.path))throw Error("NO_DOC");
   writes++;state.set(r.path,{...state.get(r.path),...structuredClone(value)})}
 };
 const db={collection:ref,async runTransaction(fn){return fn(tx)}};
 const FieldValue={serverTimestamp:()=>"SERVER_TIMESTAMP"};
 const store=createOwnerReviewedSkuMappingStore({db,FieldValue,includeHistoricalGroups});
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
test("owner can list and review a retired private SKU in the selected company's catalog",async()=>{
 const f=fake(),path="companies/partner/partnerPrivateProducts/retired";
 const product={companyId:"partner",origin:"partner_custom",visibility:"private",
  name:"受付終了プラン",active:false,unitPrice:10300};
 f.state.set(path,product);
 const initial=await f.store.status(owner,"partner");
 assert.deepEqual(initial.partnerProducts,[{id:"partnerPrivate:retired",
  name:"受付終了プラン",active:false}]);
 assert.doesNotMatch(JSON.stringify(initial),/unitPrice|10300/);
 const result=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerPrivate:retired",hubProductId:"nuro",expectedVersion:0});
 assert.equal(result.saved,true);
 const reviewed=await f.store.status(owner);
 assert.deepEqual(reviewed.bindings,[{companyId:"partner",
  productId:"partnerPrivate:retired",hubProductId:"nuro"}]);
 assert.deepEqual(f.state.get(path),product);
 assert.equal(f.writes,2);
});
test("unknown or foreign private IDs and a private combined label going to solo Air cannot be mapped",async()=>{
 const f=fake();
 const binding={principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerPrivate:legacy",hubProductId:"air",expectedVersion:0};
 await assert.rejects(f.store.change(binding),/UNVERIFIED/);
 const path="companies/partner/partnerPrivateProducts/legacy";
 const row={companyId:"foreign",origin:"partner_custom",visibility:"private",
  name:"SB光・AIR（旧合算）",active:false};
 f.state.set(path,row);
 await assert.rejects(f.store.status(owner,"partner"),/UNVERIFIED/);
 await assert.rejects(f.store.change({...binding,hubProductId:"legacy"}),/UNVERIFIED/);
 f.state.set(path,{...row,companyId:"partner"});
 await assert.rejects(f.store.change(binding),/UNVERIFIED/);
 assert.equal(f.writes,0);
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

test("same partner cannot reuse a hub SKU across categories; audit removal remains possible",async()=>{
 const f=fake();
 await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0});
 const before=f.writes;
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku02",hubProductId:"nuro",expectedVersion:1}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 assert.equal(f.writes,before,"no writes when a hub SKU mapping collides");
 assert.equal(f.state.get("companies/hub/rankingSkuMappings/shared").version,1);
 const removed=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:null,expectedVersion:1});
 assert.equal(removed.version,2);
 const assigned=await f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku02",hubProductId:"nuro",expectedVersion:2});
 assert.equal(assigned.version,3);
 assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared").bindings,
  [{companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"}]);
 assert.equal(f.writes,6,"only successful mapping revisions create audits");
});

test("Owner can explicitly review exact 光/AIR variants, never independent 光 or Air",async()=>{
 for(const label of ["光/AIR","光・Air","SB光/AIR","ソフトバンク光/Air"]){
  const f=fake(),previous=structuredClone(f.state.get("products/legacy"));
  f.state.set("products/legacy",{...previous,name:label});
  const saved=await f.store.change({
   principal:owner,partnerCompanyId:"partner",
   partnerProductId:"partnerSku05",hubProductId:"legacy",expectedVersion:0
  });
  assert.equal(saved.saved,true,label);
  assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared").bindings,[
   {companyId:"partner",productId:"partnerSku05",hubProductId:"legacy"}
  ]);
  assert.equal(f.state.get("products/legacy").name,label);
  assert.equal(f.writes,2);
 }
 for(const label of ["光","Air"]){
  const f=fake(),previous=f.state.get("products/legacy");
  f.state.set("products/legacy",{...previous,name:label});
  await assert.rejects(f.store.change({
   principal:owner,partnerCompanyId:"partner",
   partnerProductId:"partnerSku05",hubProductId:"legacy",expectedVersion:0
  }),/OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
  assert.equal(f.writes,0);
 }
});

test("stored duplicate hub targets fail closed before owner reads or edits, without ledger writes",async()=>{
 const f=fake(),path="companies/hub/rankingSkuMappings/shared";
 const original={hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
  active:true,version:7,bindings:[
   {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"}
  ]};
 f.state.set(path,structuredClone(original));
 await assert.rejects(f.store.status(owner,"partner"),/OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",
  partnerProductId:"partnerSku03",hubProductId:"air",expectedVersion:7}),
  /OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
 assert.equal(f.writes,0);
 assert.deepEqual(f.state.get(path),original);
});
test("stored target identity uses unambiguous company and hub ID tuple",async()=>{
 const f=fake();
 f.state.set("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
  active:true,version:2,bindings:[
   {companyId:"partner:a",productId:"partnerSku01",hubProductId:"b"},
   {companyId:"partner",productId:"partnerSku02",hubProductId:"a:b"}
  ]
 });
 const result=await f.store.status(owner);
 assert.equal(result.bindings.length,2);
 assert.equal(f.writes,0);
});


test("historic 光/AIR never maps to an unrelated product labeled only 旧合算 or 未分類",async()=>{
 for(const name of ["NURO旧合算","U-NEXT（未分類）","太陽光/AIR（旧合算）"]){
  const f=fake();
  f.state.set("products/nuro",{...f.state.get("products/nuro"),name});
  await assert.rejects(f.store.change({principal:owner,
   partnerCompanyId:"partner",partnerProductId:"partnerSku05",
   hubProductId:"nuro",expectedVersion:0}),/OWNER_SKU_MAPPING_REVIEW_UNVERIFIED/);
  assert.equal(f.writes,0,name+" must never modify a saved mapping or count");
 }
 for(const name of ["SB光・AIR（旧合算）","光/AIR","ソフトバンク光/Air"]){
  const f=fake();
  f.state.set("products/legacy",{...f.state.get("products/legacy"),name});
  const applied=await f.store.change({principal:owner,
   partnerCompanyId:"partner",partnerProductId:"partnerSku05",
   hubProductId:"legacy",expectedVersion:0});
  assert.equal(applied.saved,true,name+" is a genuine combined product");
 }
});


test("old legacy and archived private つばさ/HTB cannot become either standalone product or 光/AIR",async()=>{
 for(const source of ["partnerSku07","partnerPrivate:energy"]){
  const f=fake();
  f.state.set("companies/partner/partnerPrivateProducts/energy",{companyId:"partner",name:"つばさ・HTB（旧合算）",active:false,origin:"partner_custom",visibility:"private"});
  for(const [id,name] of [["htb","HTB"],["tsubasa","つばさ電気"],["generic","旧合算"],["combined","SB光・AIR"]]){
   f.state.set("products/"+id,{companyId:"hub",name,active:true});
   await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",partnerProductId:source,hubProductId:id,expectedVersion:0}),/UNVERIFIED/);
  }
  assert.equal(f.writes,0);
  f.state.set("products/energy",{companyId:"hub",name:"つばさ・HTB（旧合算）",active:true});
  assert.equal((await f.store.change({principal:owner,partnerCompanyId:"partner",partnerProductId:source,hubProductId:"energy",expectedVersion:0})).saved,true);
  assert.equal(f.state.get("companies/partner/partnerPrivateProducts/energy").active,false);
 }
});


test("explicit Owner historical mapping uses the same source identity without registering a sales product",async()=>{
 const f=fake({includeHistoricalGroups:true}),before=[...f.state].filter(([p])=>p.startsWith("products/"));
 const target="legacyPartnerSku:partnerSku07";
 for(const source of ["partnerSku01","partnerSku05","partnerPrivate:energy"])
  await assert.rejects(f.store.change({principal:owner,partnerCompanyId:"partner",partnerProductId:source,hubProductId:target,expectedVersion:0}),/UNVERIFIED/);
 assert.equal(f.writes,0);
 const saved=await f.store.change({principal:owner,partnerCompanyId:"partner",partnerProductId:"partnerSku07",hubProductId:target,expectedVersion:0});
 assert(saved.saved);assert.equal(saved.version,1);
 assert.deepEqual([...f.state].filter(([p])=>p.startsWith("products/")),before);
 const old=fake();
 await assert.rejects(old.store.change({principal:owner,partnerCompanyId:"partner",partnerProductId:"partnerSku07",hubProductId:target,expectedVersion:0}),/UNVERIFIED/);
});
