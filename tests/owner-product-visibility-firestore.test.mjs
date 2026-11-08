import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerProductVisibilityStore}
 from "../ranking/owner-product-visibility-firestore.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";

const principal={uid:"owner",email:"owner@example.test",emailVerified:true};
const product=(id,name,active=true)=>({companyId:"hub",name,active,
 revenue:25000,unitPrice:10000,cashbackOptions:[5000]});
function fake(){
 const state=new Map([
  ["users/owner",{uid:"owner",email:"owner@example.test",
   companyId:"hub",companyRole:"owner",active:true,accessKind:"internal"}],
  ["companies/hub",{name:"本社",ownerUid:"owner",companyKind:"internal",active:true}],
  ["companies/hub/members/owner",{uid:"owner",companyId:"hub",
   companyRole:"owner",active:true,accessKind:"internal"}],
  ["companies/partner",{name:"協力店",companyKind:"partner",
   hubCompanyId:"hub",active:true}],
  ["partnerRelations/partner",{partnerCompanyId:"partner",
   hubCompanyId:"hub",active:true,countSharingApproved:true}],
  ["products/nuro",product("nuro","NURO光")],
  ["products/air",product("air","SoftBank Air")]
 ]);
 let serial=0,writes=0;
 const ref=path=>({
  path,doc(id){return ref(path+"/"+(id??("audit_"+(++serial))))},
  collection(name){return ref(path+"/"+name)},
  where(field,operator,value){
   return {type:"query",path,field,operator,value,
    limit(max){return {...this,max}}}
  },
  limit(max){return {type:"query",path,max}}
 });
 const snapshot=(path,value)=>{
  const id=path.split("/").at(-1);
  return {id,exists:value!==undefined,
   data(){return structuredClone(value)}};
 };
 const tx={
  async get(q){
   if(q.type==="query"){
    const docs=[...state.entries()].filter(([p,value])=>
     p.startsWith(q.path+"/")&&
     p.split("/").length===q.path.split("/").length+1&&
     (q.field==null||value[q.field]===q.value))
     .map(([p,value])=>snapshot(p,value));
    return {docs:docs.slice(0,q.max||9999)};
   }
   return snapshot(q.path,state.get(q.path));
  },
  create(r,value){if(state.has(r.path))throw Error("ALREADY_EXISTS");
   writes++;state.set(r.path,structuredClone(value));},
  update(r,value){if(!state.has(r.path))throw Error("NOT_FOUND");
   writes++;state.set(r.path,{...state.get(r.path),...structuredClone(value)});}
 };
 const db={collection:ref,async runTransaction(fn){return fn(tx)}};
 const store=createOwnerProductVisibilityStore({
  db,FieldValue:{serverTimestamp:()=> "SERVER_TIMESTAMP"}
 });
 return {store,state,get writes(){return writes}};
}
test("owner starts with every shared product OFF, raw prices are NEVER sent",async()=>{
 const f=fake(),status=await f.store.readStatus(principal);
 assert.equal(status.version,0);
 assert.equal(status.products.length,2);
 assert(status.products.every(p=>p.enabled===false));
 assert(!/revenue|unitPrice|cashback|25000|10000/.test(JSON.stringify(status)));
 assert.equal(f.writes,0);
});
test("one owner toggle is atomic, version checked, audited, and changes no sales/product rows",async()=>{
 const f=fake(),before=structuredClone(f.state.get("products/nuro"));
 const saved=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 assert.deepEqual(saved,{saved:true,version:1,productId:"nuro",
  enabled:true,partnerCompanyId:null});
 assert.deepEqual(f.state.get("products/nuro"),before);
 assert.equal(f.state.get("companies/hub/rankingProductVisibility/shared")
  .enabledHubProductIds.join(","),"nuro");
 assert.equal(f.writes,2,"only setting + append-only audit");
 assert.equal((await f.store.readStatus(principal)).products
  .find(p=>p.id==="nuro").enabled,true);
 const repeat=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:1});
 assert.equal(repeat.saved,false);
 assert.equal(f.writes,2,"idempotent no-op must not duplicate audit");
 await assert.rejects(f.store.saveSwitch({principal,productId:"air",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,2);
});
test("partner-specific OFF cannot turn on globally OFF product; OFF never deletes counts",async()=>{
 const f=fake(),saved=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 const restricted=await f.store.saveSwitch({principal,productId:"nuro",
  partnerCompanyId:"partner",enabled:false,expectedVersion:saved.version});
 assert.equal(restricted.version,2);
 const state=await f.store.readForRanking({context:{
  serverVerified:true,viewerUid:"owner",hubCompanyId:"hub",role:"hub_owner",
  approvedCompanyIds:["hub","partner"]},mappingsReviewed:true});
 assert.deepEqual(state.enabledHubProductIds,["nuro"]);
 assert.deepEqual(state.partnerOverrides,[{companyId:"partner",
  enabledHubProductIds:[]}]);
 assert.equal(state.ownerSettingsRead,true);
 assert.equal(state.productMappingsReviewed,true);
 await assert.rejects(f.store.saveSwitch({principal,productId:"air",
  partnerCompanyId:"partner",enabled:true,expectedVersion:2}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 const off=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:false,expectedVersion:2});
 assert.equal(off.saved,true);
 assert.deepEqual(f.state.get("companies/hub/rankingProductVisibility/shared")
  .enabledHubProductIds,[]);
 assert.equal(f.state.get("products/nuro").revenue,25000);
});
test("secondary user, wrong owner and unrelated partner are rejected before any write",async()=>{
 const f=fake(),badPrincipal={...principal,uid:"other"};
 await assert.rejects(f.store.readStatus(badPrincipal),/UNAUTHORIZED_OR_INCOMPLETE/);
 await assert.rejects(f.store.saveSwitch({principal:badPrincipal,
  productId:"nuro",enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("partnerWorkspaceContexts/owner",{active:true,kind:"partner_secondary"});
 await assert.rejects(f.store.readStatus(principal),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.delete("partnerWorkspaceContexts/owner");
 await assert.rejects(f.store.saveSwitch({principal,productId:"nuro",
  partnerCompanyId:"foreign",enabled:true,expectedVersion:0}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,0);
});
test("unknown, disabled and money-labelled products fail closed, never write",async()=>{
 const f=fake();
 await assert.rejects(f.store.saveSwitch({principal,productId:"fake",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("products/nuro",{...f.state.get("products/nuro"),active:false});
 await assert.rejects(f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("products/nuro",product("nuro","NURO_CB50000"));
 await assert.rejects(f.store.readStatus(principal),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,0);
});
