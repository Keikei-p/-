import test from "node:test";
import assert from "node:assert/strict";
import {mountOwnerReviewedSkuMappingDashboard}
 from "../ranking/owner-reviewed-sku-mapping-dashboard-mount.mjs";

class Node{
 constructor(tag){
  this.tagName=tag;this.children=[];this.listeners={};
  this.textContent="";this.value="";this.disabled=false;this.className="";
 }
 appendChild(x){this.children.push(x);return x}
 replaceChildren(...xs){this.children=xs}
 setAttribute(k,v){this[k]=v}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 async fire(type){for(const fn of this.listeners[type]??[])await fn()}
}
const document={createElement:tag=>new Node(tag)};
const all=n=>[n,...n.children.flatMap(all)];
const visible=n=>all(n).map(x=>x.textContent).join(" ");
const owner={uid:"owner",emailVerified:true,getIdToken:async()=> "x".repeat(40)};
const products=()=>({schema:"nico-hub-product-visibility-v1",
 role:"hub_owner",hubCompanyId:"hub",version:1,partnerOverrides:{},
 products:[{id:"nuro",name:"NURO",active:true,enabled:true},
  {id:"legacy",name:"SB光・AIR（旧合算・未分類）",active:true,enabled:false}]});
function harness(){
 const auth={currentUser:owner},root=new Node("main"),calls=[];
 let callback=()=>{},unsubscribe=0,version=0,bindings=[];
 const httpsCallable=(_functions,name)=>async payload=>{
  calls.push({name,payload});
  if(name==="getOwnerReviewedSkuMapping"){
   assert.deepEqual(payload,{partnerCompanyId:"partner"});
   return {data:{schema:"nico-owner-reviewed-sku-map-v1",hubCompanyId:"hub",
    version,bindings,partnerProducts:[{id:"partnerPrivate:archived",
     name:"旧商材",active:false}]}};
  }
  if(name==="getOwnerProductVisibility")return {data:products()};
  assert.equal(name,"setOwnerReviewedSkuMapping");
  assert.equal(payload.partnerCompanyId,"partner");
  assert.equal(payload.expectedVersion,version);
  bindings=[{companyId:"partner",productId:payload.partnerProductId,
   hubProductId:payload.hubProductId}];version++;
  return {data:{saved:true,version,partnerCompanyId:"partner",
   partnerProductId:payload.partnerProductId,
   hubProductId:payload.hubProductId}};
 };
 const args={featureEnabled:true,document,root,auth,partnerCompanyId:"partner",
  functions:{},httpsCallable,onAuthStateChanged:(_auth,fn)=>{
   callback=fn;return ()=>{unsubscribe++}
  }};
 return {args,auth,root,calls,
  emit:user=>{auth.currentUser=user;return callback(user)},
  get unsubscribe(){return unsubscribe}};
}

test("OFF mount never registers a listener or creates a financial read",()=>{
 const h=harness();assert.throws(()=>mountOwnerReviewedSkuMappingDashboard({
  ...h.args,featureEnabled:false
 }),/MOUNT_NOT_READY/);
 assert.deepEqual(h.calls,[]);assert.equal(h.unsubscribe,0);
});
test("same Owner workspace mounts company-scoped historic SKU without finance or writes",async()=>{
 const h=harness(),mount=mountOwnerReviewedSkuMappingDashboard(h.args);
 assert.equal(await mount.refresh(),true);
 assert.equal(all(h.root).filter(x=>x.tagName==="select").length,10);
 assert.match(visible(h.root),/旧商材（過去の商材）/);
 assert.doesNotMatch(visible(h.root),/売上|単価|CB|価格/);
 assert.deepEqual(h.calls.map(x=>x.name),[
  "getOwnerReviewedSkuMapping","getOwnerProductVisibility"
 ]);
 assert.equal(mount.getVersion(),0);
 mount.destroy();assert.equal(h.unsubscribe,1);
 assert.equal(h.root.children.length,0);
 assert.equal(await mount.refresh(),false);
});
test("explicit Owner selection calls audited setter, then reloads confirmed server state",async()=>{
 const h=harness(),mount=mountOwnerReviewedSkuMappingDashboard(h.args);
 assert.equal(await mount.refresh(),true);
 const select=all(h.root).find(x=>x.tagName==="select");
 select.value="nuro";await select.fire("change");
 assert.equal(h.calls.filter(x=>x.name==="setOwnerReviewedSkuMapping").length,1);
 assert.equal(mount.getVersion(),1);
 assert.equal(all(h.root).find(x=>x.tagName==="select").value,"nuro");
 mount.destroy();
});
test("logout clears old company mapping; no stale Owner mapping after auth loss",async()=>{
 const h=harness(),mount=mountOwnerReviewedSkuMappingDashboard(h.args);
 assert.equal(await mount.refresh(),true);
 h.emit(null);
 assert.equal(h.root.children.length,0);
 assert.equal(await mount.refresh(),false);
 assert.equal(h.calls.filter(x=>x.name==="setOwnerReviewedSkuMapping").length,0);
 mount.destroy();
});
