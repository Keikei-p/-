import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerReviewedSkuMappingPanel,PARTNER_CATEGORIES}
 from "../ranking/owner-reviewed-sku-mapping-panel.mjs";
import {createOwnerSkuMappingFirebaseBridge}
 from "../ranking/owner-reviewed-sku-mapping-firebase-bridge.mjs";

class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};
  this.textContent="";this.value="";this.disabled=false;this.className="";}
 appendChild(n){this.children.push(n);return n;}
 replaceChildren(...n){this.children=n;}
 setAttribute(k,v){this[k]=v}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 async fire(k){for(const fn of this.listeners[k]??[])await fn()}
}
const document={createElement:tag=>new Node(tag)};
const all=n=>[n,...n.children.flatMap(all)];
const displayed=n=>all(n).map(x=>x.textContent).join(" ");
const selects=n=>all(n).filter(x=>x.tagName==="select");
const user={uid:"owner",emailVerified:true,getIdToken:async()=>"a".repeat(40)};
const status=(version=0,bindings=[])=>({
 schema:"nico-owner-reviewed-sku-map-v1",hubCompanyId:"hub",version,bindings
});
const catalog=()=>({
 schema:"nico-hub-product-visibility-v1",role:"hub_owner",
 version:3,hubCompanyId:"hub",partnerOverrides:{},
 products:[
  {id:"nuro",name:"NURO光",active:true,enabled:true},
  {id:"air",name:"SoftBank Air",active:true,enabled:false},
  {id:"combined",name:"SB光・AIR（旧合算・未分類）",active:true,enabled:false}
 ]
});
test("nine legacy categories are exact and mixed hikari/Air keeps its own slot",()=>{
 assert.equal(PARTNER_CATEGORIES.length,9);
 assert.equal(PARTNER_CATEGORIES[4][0],"partnerSku05");
 assert(PARTNER_CATEGORIES[4][1].includes("旧合算"));
 assert.equal(new Set(PARTNER_CATEGORIES.map(x=>x[0])).size,9);
});
test("default OFF has zero network reads and zero mapping writes",async()=>{
 const root=new Node("main"),auth={currentUser:user};let calls=0;
 const panel=createOwnerReviewedSkuMappingPanel({
  document,root,auth,partnerCompanyId:"partner",
  readMappings:()=>{calls++;return status()},
  readProducts:()=>{calls++;return catalog()},
  saveMapping:()=>{calls++;return {}}
 });
 assert.equal(await panel.refresh(),false);
 assert.equal(calls,0);assert.equal(root.children.length,0);
});
test("owner sees all nine categories, only count-only hub product labels",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(),
  readProducts:async()=>catalog(),saveMapping:async()=>{throw Error("unused")}
 });
 assert.equal(await panel.refresh(),true);
 assert.equal(selects(root).length,9);
 assert(displayed(root).includes("NURO"));
 assert(displayed(root).includes("SB光・AIR"));
 assert(!displayed(root).includes("単価"));
 assert(!displayed(root).includes("CB5000"));
 const legacy=selects(root)[4];
 assert.deepEqual(legacy.children.map(x=>x.value),["","combined"],
  "old mixed counts must NEVER be assigned to independent hikari or Air");
 panel.destroy();
 assert.equal(root.children.length,0);
});
test("Owner sees exact ON/OFF readiness without assuming a live server release",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const bindings=[
  {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
  {companyId:"partner",productId:"partnerSku02",hubProductId:"air"},
  {companyId:"partner",productId:"partnerSku05",hubProductId:"combined"}
 ];
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(3,bindings),
  readProducts:async()=>catalog(),saveMapping:async()=>{throw Error("unexpected write")}
 });
 assert.equal(await panel.refresh(),true);
 const labels=displayed(root);
 assert(labels.includes("公開設定上ON: 1 / 9商材"));
 assert(labels.includes("実際の入力開始にはサーバー公開承認が必要"));
 assert.equal(all(root).filter(x=>x.tagName==="small"&&
  x.textContent==="公開設定ON").length,1);
 assert.equal(all(root).filter(x=>x.tagName==="small"&&
  x.textContent==="商材公開OFF").length,2);
 assert.equal(selects(root)[0].value,"nuro");
 assert(!selects(root)[1].children.some(x=>x.value==="nuro"),
  "a hub SKU already used by another category must not be offered twice");
 assert.deepEqual(selects(root)[4].children.map(x=>x.value),["","combined"]);
 panel.destroy();
});

test("partner-specific OFF hides mapped ON SKU from readiness; mapping and counts remain intact",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const source=catalog();source.partnerOverrides={partner:[]};
 const binding={companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"};
 const before=structuredClone({source,binding}),panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(1,[binding]),
  readProducts:async()=>source,saveMapping:async()=>{throw Error("unexpected write")}
 });
 assert.equal(await panel.refresh(),true);
 assert(displayed(root).includes("公開設定上ON: 0 / 9商材"));
 assert.equal(selects(root)[0].value,"nuro");
 assert(all(root).some(x=>x.tagName==="small"&&x.textContent==="商材公開OFF"));
 assert.deepEqual({source,binding},before);
 panel.destroy();
});

test("invalid duplicate mapping returned by server is not shown or modified",async()=>{
 const root=new Node("main"),auth={currentUser:user};let writes=0;
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(2,[
   {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"}
  ]),
  readProducts:async()=>catalog(),saveMapping:async()=>{writes++;return {}}
 });
 assert.equal(await panel.refresh(),false);
 assert.equal(selects(root).length,0);
 assert(displayed(root).includes("読み込めません"));
 assert.equal(writes,0);
 panel.destroy();
});

test("fullwidth amount-bearing catalog names are blocked before mapping controls",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const catalogWithFinance=catalog();
 catalogWithFinance.products[0].name="ＮＵＲＯ ＣＢ２００００";
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(),
  readProducts:async()=>catalogWithFinance,
  saveMapping:async()=>{throw Error("must not save")}
 });
 assert.equal(await panel.refresh(),false);
 assert.equal(selects(root).length,0);
 assert(displayed(root).includes("読み込めません"));
 panel.destroy();
});

test("changing category calls exact scoped owner mapping API and reloads confirmed state",async()=>{
 const root=new Node("main"),auth={currentUser:user},calls=[];
 let version=0,bindings=[];
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(version,bindings),
  readProducts:async()=>catalog(),
  saveMapping:async data=>{
   calls.push(data);
   version++;bindings=[{companyId:"partner",
    productId:data.partnerProductId,hubProductId:data.hubProductId}];
   return {saved:true,version,partnerCompanyId:"partner",
    partnerProductId:data.partnerProductId,hubProductId:data.hubProductId};
  }
 });
 await panel.refresh();
 const control=selects(root)[0];control.value="nuro";
 await control.fire("change");
 assert.deepEqual(calls,[{token:"a".repeat(40),partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"nuro",expectedVersion:0}]);
 assert.equal(panel.getVersion(),1);
 assert.equal(selects(root)[0].value,"nuro");
});
test("server rejects mapping write: no fake success or kept optimistic selection",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(),
  readProducts:async()=>catalog(),
  saveMapping:async()=>{throw Error("permission-denied")}
 });
 await panel.refresh();
 const control=selects(root)[0];control.value="nuro";
 await control.fire("change");
 assert.equal(selects(root)[0].value,"");
 assert.equal(panel.getVersion(),0);
});
test("unapproved legacy-to-Air mapping from API is never shown",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(1,[{companyId:"partner",
   productId:"partnerSku05",hubProductId:"air"}]),
  readProducts:async()=>catalog(),saveMapping:async()=>{}
 });
 assert.equal(await panel.refresh(),false);
 assert.equal(selects(root).length,0);
 assert(displayed(root).includes("読み込めません"));
});
test("logout during pending mapping query cancels old company results",async()=>{
 let release;const pending=new Promise(r=>{release=r});
 const root=new Node("main"),auth={currentUser:user};
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>pending,readProducts:async()=>catalog(),
  saveMapping:async()=>{}
 });
 const action=panel.refresh();
 for(let i=0;i<30;i++)await Promise.resolve();
 auth.currentUser=null;panel.onAuthChange();
 release(status());
 assert.equal(await action,false);
 assert.equal(root.children.length,0);
});
test("Firebase bridge uses only verified owner callable names and never sends price",async()=>{
 const auth={currentUser:user},calls=[];
 const httpsCallable=(_functions,name)=>async data=>{
  calls.push({name,data});
  return {data:name==="getOwnerReviewedSkuMapping"?status():
   name==="getOwnerProductVisibility"?catalog():{
    saved:true,version:1,partnerCompanyId:"partner",
    partnerProductId:"partnerSku01",hubProductId:"nuro"
   }};
 };
 const bridge=createOwnerSkuMappingFirebaseBridge({
  auth,functions:{region:"asia-northeast1"},httpsCallable
 });
 assert.deepEqual(await bridge.readMappings({token:"a".repeat(40)}),status());
 assert.deepEqual(await bridge.readProducts({token:"a".repeat(40)}),catalog());
 const saved=await bridge.saveMapping({token:"a".repeat(40),
  partnerCompanyId:"partner",partnerProductId:"partnerSku01",
  hubProductId:"nuro",expectedVersion:0});
 assert.equal(saved.saved,true);
 assert.deepEqual(calls.map(x=>x.name),[
  "getOwnerReviewedSkuMapping","getOwnerProductVisibility",
  "setOwnerReviewedSkuMapping"]);
 assert.deepEqual(calls[2].data,{
  partnerCompanyId:"partner",partnerProductId:"partnerSku01",
  hubProductId:"nuro",expectedVersion:0
 });
 assert(!JSON.stringify(calls).includes("revenue"));
});
test("bridge rejects spoofed token and changed user before rendering",async()=>{
 const auth={currentUser:user};
 const bridge=createOwnerSkuMappingFirebaseBridge({
  auth,functions:{},httpsCallable:()=>async()=>({data:status()})
 });
 await assert.rejects(bridge.readMappings({token:"fake"}),/UNVERIFIED/);
 assert.throws(()=>bridge.saveMapping({token:"a".repeat(40),
  partnerCompanyId:"../records",partnerProductId:"partnerSku01",
  hubProductId:"nuro",expectedVersion:0}),/UNVERIFIED/);
 auth.currentUser=null;bridge.onAuthChange();
 await assert.rejects(bridge.readMappings({token:"a".repeat(40)}),/UNVERIFIED/);
});
