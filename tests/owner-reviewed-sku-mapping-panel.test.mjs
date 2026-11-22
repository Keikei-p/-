import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerReviewedSkuMappingPanel,PARTNER_CATEGORIES,suggestUnambiguousOwnerSkuMappings}
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
  {id:"nuro",name:"NURO",active:true,enabled:true},
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
test("Owner UI offers the existing combined 光/AIR ranking product but never individual 光, Air or solar",async()=>{
 const root=new Node("main"),auth={currentUser:user},queries=[];
 const combinedCatalog=catalog();
 combinedCatalog.products[2].name="光/AIR";
 combinedCatalog.products.push(
  {id:"light",name:"SB光",active:true,enabled:true},
  {id:"solar",name:"太陽光/AIR",active:true,enabled:true});
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(),readProducts:async()=>combinedCatalog,
  saveMapping:async x=>{queries.push(x);throw Error("should not save")}
 });
 assert.equal(await panel.refresh(),true);
 const legacy=selects(root)[4];
 assert.deepEqual(legacy.children.map(x=>x.value),["","combined"]);
 assert.equal(queries.length,0,"no automatic mapping or count rewrite");
 assert(displayed(root).includes("光/AIR"));
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
 assert.match(displayed(root),/対応設定の保存を確認できません/,
  "failed-save message must remain visible after canonical reload");
 assert.equal(selects(root).length,9,
  "mapping controls remain usable after a rejected save");
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


test("Owner preview matches only exact published names and NEVER silently saves on refresh",async()=>{
 const products=catalog(),map=status(),proposals=suggestUnambiguousOwnerSkuMappings({
  mapping:map,catalog:products,partnerCompanyId:"partner"
 });
 assert.deepEqual(proposals.map(p=>[p.partnerProductId,p.hubProductId]),
  [["partnerSku01","nuro"]]);
 assert(!proposals.some(p=>p.partnerProductId==="partnerSku05"),
  "combined legacy is not proposed while globally OFF");
 const root=new Node("main"),auth={currentUser:user},calls=[];
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",readMappings:async()=>map,
  readProducts:async()=>products,saveMapping:async x=>{calls.push(x);throw Error("not expected");}
 });
 await panel.refresh();
 assert.equal(calls.length,0);
 assert.match(displayed(root),/上記1件を確認して連携する/);
 assert.equal(all(root).filter(x=>x.tagName==="button").length,1);
 panel.destroy();
});

test("Owner batch performs versioned sequential exact mappings only after click, rechecks server",async()=>{
 const root=new Node("main"),auth={currentUser:user},calls=[];
 const products=catalog();
 products.products.push({id:"water",name:"ウォーター",enabled:true,active:true});
 let version=0,bindings=[];
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",
  readProducts:async()=>products,
  readMappings:async()=>status(version,bindings),
  saveMapping:async input=>{
   calls.push(input);
   assert.equal(input.expectedVersion,version);
   assert(!bindings.some(b=>b.productId===input.partnerProductId));
   version++;
   bindings.push({companyId:input.partnerCompanyId,
    productId:input.partnerProductId,hubProductId:input.hubProductId});
   return {saved:true,version,partnerCompanyId:input.partnerCompanyId,
    partnerProductId:input.partnerProductId,hubProductId:input.hubProductId};
  }
 });
 await panel.refresh();
 assert.equal(calls.length,0,"never write on load");
 const action=all(root).find(x=>x.tagName==="button");
 assert(action);
 assert.match(displayed(root),/上記2件を確認して連携する/);
 await action.fire("click");
 assert.deepEqual(calls.map(x=>[x.partnerProductId,x.hubProductId,x.expectedVersion]),[
  ["partnerSku01","nuro",0],["partnerSku06","water",1]
 ]);
 assert.equal(panel.getVersion(),2);
 assert.equal(selects(root)[0].value,"nuro");
 assert.equal(selects(root)[5].value,"water");
 assert.match(displayed(root),/一括連携を保存・再確認しました（2件）/);
 assert.equal(all(root).filter(x=>x.tagName==="button").length,0);
 panel.destroy();
});

test("ambiguous matching, already mapped SKU, and legacy split never get a batch proposal",()=>{
 const c=catalog();
 c.products[2].enabled=true;
 c.products.push({id:"nuro2",name:"NURO",active:false,enabled:false});
 let proposals=suggestUnambiguousOwnerSkuMappings({
  mapping:status(),catalog:c,partnerCompanyId:"partner"
 });
 assert(!proposals.some(x=>x.partnerProductId==="partnerSku01"),
  "two NURO candidate IDs are ambiguous");
 assert(proposals.some(x=>x.partnerProductId==="partnerSku05"&&x.hubProductId==="combined"),
  "only explicit and currently published combined 光/AIR may be proposed");
 c.products[2].name="SoftBank Air";
 assert(!suggestUnambiguousOwnerSkuMappings({
  mapping:status(),catalog:c,partnerCompanyId:"partner"
 }).some(x=>x.partnerProductId==="partnerSku05"));
 c.products[2].name="SB光・AIR（旧合算・未分類）";
 c.partnerOverrides.partner=[];
 assert.equal(suggestUnambiguousOwnerSkuMappings({
  mapping:status(),catalog:c,partnerCompanyId:"partner"
 }).length,0,"company-specific OFF is respected");
});

test("only exact archived private SKU names can be proposed in the company-scoped Owner panel",async()=>{
 const c=catalog();
 c.products[0].name="NURO光";
 c.products.push({id:"extra",name:"共通商材",active:true,enabled:true});
 c.products.push({id:"ambiguous1",name:"重複商材",active:true,enabled:true});
 c.products.push({id:"ambiguous2",name:"重複商材",active:false,enabled:false});
 const mapping={...status(),partnerProducts:[
  {id:"partnerPrivate:historic",name:"共通商材",active:false},
  {id:"partnerPrivate:ambiguous",name:"重複商材",active:true}
 ]};
 assert.deepEqual(suggestUnambiguousOwnerSkuMappings({mapping,catalog:c,partnerCompanyId:"partner"}),[{
  partnerProductId:"partnerPrivate:historic",partnerLabel:"共通商材",
  hubProductId:"extra",hubProductLabel:"共通商材"
 }]);
 const root=new Node("main"),calls=[];
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,
  auth:{currentUser:user},partnerCompanyId:"partner",
  readMappings:async args=>{calls.push(args);return mapping;},
  readProducts:async()=>c,saveMapping:async()=>assert.fail("preview wrote to server")});
 assert.equal(await panel.refresh(),true);
 assert.equal(calls[0].partnerCompanyId,"partner");
 assert.match(displayed(root),/共通商材（過去の商材）/);
 assert.match(displayed(root),/上記1件を確認して連携する/);
 panel.destroy();
});

test("batch failure stops at first error and reloads server-confirmed partial state",async()=>{
 const root=new Node("main"),auth={currentUser:user},calls=[];
 const c=catalog();c.products.push({id:"water",name:"ウォーター",enabled:true,active:true});
 let version=0,bindings=[];
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",
  readMappings:async()=>status(version,bindings),readProducts:async()=>c,
  saveMapping:async data=>{
   calls.push(data);
   if(data.partnerProductId==="partnerSku06")throw Error("permission-denied");
   version=1;bindings=[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"}];
   return {saved:true,version,partnerCompanyId:"partner",
    partnerProductId:"partnerSku01",hubProductId:"nuro"};
  }
 });
 await panel.refresh();
 const action=all(root).find(x=>x.tagName==="button");
 await action.fire("click");
 assert.equal(calls.length,2);
 assert.equal(panel.getVersion(),1);
 assert.equal(selects(root)[0].value,"nuro");
 assert.equal(selects(root)[5].value,"");
 assert.match(displayed(root),/途中で停止しました。保存確認済み1件/);
 panel.destroy();
});

test("Owner preview refuses a duplicated persisted target without modifying any saved counts",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 let writes=0;
 const map=status(3,[
  {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
  {companyId:"partner",productId:"partnerSku06",hubProductId:"nuro"}
 ]);
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>map,readProducts:async()=>catalog(),
  saveMapping:async()=>{writes++;return {};}
 });
 assert.equal(await panel.refresh(),false);
 assert.equal(selects(root).length,0);
 assert.match(displayed(root),/読み込めません/);
 assert.equal(writes,0);
 assert.throws(()=>suggestUnambiguousOwnerSkuMappings({
  mapping:map,catalog:catalog(),partnerCompanyId:"partner"
 }),/UNVERIFIED/);
 panel.destroy();
});
test("separate partner companies can correctly reuse the same hub ranking SKU",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const mapping=status(2,[
  {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
  {companyId:"otherPartner",productId:"partnerSku01",hubProductId:"nuro"}
 ]);
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>mapping,readProducts:async()=>catalog(),
  saveMapping:async()=>assert.fail("read-only preview must not save")
 });
 assert.equal(await panel.refresh(),true);
 assert.equal(selects(root)[0].value,"nuro");
 panel.destroy();
});


test("Owner count-only picker never offers unrelated NURO旧合算 or 未分類 products for 光/AIR",async()=>{
 const c=catalog();
 c.products.push({id:"notLightAir",name:"NURO旧合算",active:true,enabled:true},
  {id:"unknown",name:"U-NEXT（未分類）",active:true,enabled:true},
  {id:"solar",name:"太陽光/AIR（旧合算）",active:true,enabled:true});
 const root=new Node("main"),auth={currentUser:user};
 const p=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId:"partner",
  readMappings:async()=>status(),readProducts:async()=>c,
  saveMapping:async()=>assert.fail("Owner has not confirmed any mapping")
 });
 assert.equal(await p.refresh(),true);
 assert.deepEqual(selects(root)[4].children.map(x=>x.value),["","combined"]);
 p.destroy();
});
