import test from "node:test";
import assert from "node:assert/strict";
import {mountOwnerSkuRolloutPanel}
 from "../ranking/owner-reviewed-sku-rollout-panel.mjs";

class Node{
 constructor(tag){
  this.tagName=tag;this.children=[];this.listeners={};
  this.textContent="";this.disabled=false;this.className="";
 }
 appendChild(x){this.children.push(x);return x}
 replaceChildren(...xs){this.children=xs}
 setAttribute(k,v){this[k]=v}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 async fire(t){for(const fn of this.listeners[t]??[])await fn()}
}
const document={createElement:tag=>new Node(tag)};
const all=n=>[n,...n.children.flatMap(all)];
const text=n=>all(n).map(x=>x.textContent).join(" ");
const user={uid:"owner",emailVerified:true,getIdToken:async()=> "a".repeat(48)};
function harness({approve=true}={}){
 let count=0,version=2,list=[
  {companyId:"partnerA",productId:"partnerSku01",hubProductId:"nuro"}
 ];
 const calls=[],auth={currentUser:user},root=new Node("div");
 let event=()=>{},unsubs=0;
 const httpsCallable=(_f,name)=>{
  assert(["getOwnerReviewedSkuMapping","getOwnerProductVisibility",
   "setOwnerReviewedSkuMapping"].includes(name));
  return async data=>{
   calls.push({name,data});
   if(name==="getOwnerReviewedSkuMapping"){
    assert.deepEqual(data,{});
    return {data:{schema:"nico-owner-reviewed-sku-map-v1",
     hubCompanyId:"hub",version,bindings:structuredClone(list)}};
   }
   if(name==="getOwnerProductVisibility"){
    assert.deepEqual(data,{});
    return {data:{schema:"nico-hub-product-visibility-v1",
     hubCompanyId:"hub",role:"hub_owner",version:3,
     partnerOverrides:{},products:[
      {id:"nuro",name:"NURO光",active:true,enabled:true}
     ]}};
   }
   assert.equal(name,"setOwnerReviewedSkuMapping");
   assert.equal(data.expectedVersion,version);
   assert(["partnerB","partnerC"].includes(data.partnerCompanyId));
   assert(!list.some(x=>x.companyId===data.partnerCompanyId&&
    x.productId===data.partnerProductId));
   version++;count++;
   list.push({companyId:data.partnerCompanyId,
    productId:data.partnerProductId,hubProductId:data.hubProductId});
   return {data:{saved:true,version,partnerCompanyId:data.partnerCompanyId,
    partnerProductId:data.partnerProductId,hubProductId:data.hubProductId}};
  };
 };
 const args={enabled:true,document,root,auth,functions:{},
  httpsCallable,onAuthStateChanged:(_auth,fn)=>{
   event=fn;return()=>unsubs++;
  },sourceCompanyId:"partnerA",targetCompanyIds:["partnerB","partnerC"],
  confirmRollout:()=>approve
 };
 return {args,root,auth,calls,get count(){return count},
  emit:u=>{auth.currentUser=u;event(u)},
  get unsubs(){return unsubs}};
}
test("rollout UI is guarded and OFF cannot read or save",()=>{
 const h=harness();
 assert.throws(()=>mountOwnerSkuRolloutPanel({
  ...h.args,enabled:false
 }),/OWNER_SKU_ROLLOUT_PANEL_UNVERIFIED/);
 assert.deepEqual(h.calls,[]);
});
test("Owner preview is count/ID only and performs no writes on load",async()=>{
 const h=harness(),panel=mountOwnerSkuRolloutPanel(h.args);
 assert.equal(await panel.refresh(),true);
 assert.match(text(h.root),/対象：2社／新規対応：2件/);
 assert.doesNotMatch(text(h.root),/売上額|単価|CB|[0-9]+円/);
 assert.equal(h.count,0);
 assert.equal(h.calls.filter(x=>x.name==="setOwnerReviewedSkuMapping").length,0);
 assert.equal(all(h.root).filter(x=>x.tagName==="button").length,1);
 panel.destroy();assert.equal(h.unsubs,1);
 assert.equal(h.root.children.length,0);
});
test("confirmed click copies two existing approved mappings, with server readback after each",async()=>{
 const h=harness(),panel=mountOwnerSkuRolloutPanel(h.args);
 await panel.refresh();
 const button=all(h.root).find(x=>x.tagName==="button");
 await button.fire("click");
 assert.equal(h.count,2);
 assert.equal(h.calls.filter(x=>x.name==="setOwnerReviewedSkuMapping").length,2);
 assert.match(text(h.root),/再確認が完了しました（2件）/);
 assert.match(text(h.root),/新規対応：0件/);
 assert.equal(all(h.root).filter(x=>x.tagName==="button").length,0);
 panel.destroy();
});
test("Owner cancellation is non-destructive even after full preview",async()=>{
 const h=harness({approve:false}),panel=mountOwnerSkuRolloutPanel(h.args);
 await panel.refresh();
 await all(h.root).find(x=>x.tagName==="button").fire("click");
 assert.equal(h.count,0);
 assert.match(text(h.root),/新規対応：2件/);
 panel.destroy();
});
test("logout clears preview and leaves original source data unchanged",async()=>{
 const h=harness(),panel=mountOwnerSkuRolloutPanel(h.args);
 await panel.refresh();h.emit(null);
 assert.equal(h.root.children.length,0);
 assert.equal(h.count,0);
 assert.equal(await panel.refresh(),false);
 panel.destroy();
});
test("index rollout entry is hidden behind unchanged OFF gate",async()=>{
 const {readFileSync}=await import("node:fs");
 const {fileURLToPath}=await import("node:url");
 const {dirname,join}=await import("node:path");
 const html=readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  "..","index.html"),"utf8");
 assert.match(html,/const NICO_OWNER_SKU_MAPPING_UI_ENABLED = false;/);
 assert.match(html,/id="ownerPartnerSkuRolloutRoot"/);
 assert.match(html,/id="ownerPartnerSkuRolloutRefresh"/);
 assert.match(html,/mountOwnerSkuRolloutPanel/);
 assert.match(html,/targetCompanyIds:\[\.\.\.active\]\.filter\(id=>id!==selected\)/);
});
