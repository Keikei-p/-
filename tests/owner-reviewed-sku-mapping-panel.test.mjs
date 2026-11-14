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
const matchStatus=(root,index)=>all(root).filter(x=>x.className==="nico-sku-map-row")[index]
 .children.find(x=>x.className==="nico-sku-map-match-status")?.textContent;
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

test("complete normalized-name candidates are visible but never selected, saved or published automatically",async()=>{
 const names=["　ｎｕｒｏ　","ＳＢ　ＭＮＰ","ｙｍｍｎｐ","ＹＭ　純　新　規",
  "SB光・AIR","ｳｫｰﾀｰ","つばさ • ｈｔｂ","太陽光 - 蓄電池ＡＰ","Ｕ − ＮＥＸＴ"];
 for(const [index,label] of names.entries()){
  const root=new Node("main"),auth={currentUser:user};let writes=0;
  const source={...catalog(),products:[{id:"exact",name:label,active:true,enabled:index%2===0}]};
  const before=structuredClone(source);
  const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
   partnerCompanyId:"partner",readMappings:async()=>status(),readProducts:async()=>source,
   saveMapping:async()=>{writes++;throw Error("not permitted without Owner selection");}});
  assert.equal(await panel.refresh(),true,label);
  assert.equal(selects(root)[index].value,"",label+" is only a suggestion");
  assert(matchStatus(root,index).includes("完全一致候補（未保存）"),label);
  assert(selects(root)[index].children.some(x=>x.value==="exact"&&
   x.textContent.startsWith("完全一致候補: ")),label);
  assert(displayed(root).includes("公開設定上ON: 0 / 9商材"));
  await selects(root)[index].fire("change");
  assert.equal(writes,0);
  assert.deepEqual(source,before,"candidate discovery must be read-only");
  panel.destroy();
 }
});

test("unapproved abbreviations, extra words and missing Japanese vowel marks are never guessed",async()=>{
 const root=new Node("main"),auth={currentUser:user};let writes=0;
 const source={...catalog(),products:["NURO光","YMNP","U-NEXTプレミアム","ｳｫｰﾀ"]
  .map((name,i)=>({id:"different"+i,name,active:true,enabled:true}))};
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",readMappings:async()=>status(),readProducts:async()=>source,
  saveMapping:async()=>{writes++;return {};}});
 assert.equal(await panel.refresh(),true);
 for(const index of [0,2,5,8]){
  assert(matchStatus(root,index).includes("完全一致候補なし・未対応"));
  assert.equal(selects(root)[index].value,"");
  assert(!selects(root)[index].children.some(x=>x.textContent.startsWith("完全一致候補: ")));
 }
 assert.equal(writes,0);
 panel.destroy();
});

test("multiple exact normalized names remain a conflict until the Owner explicitly chooses an ID",async()=>{
 const root=new Node("main"),auth={currentUser:user},writes=[];
 const source={...catalog(),products:["NURO","ｎｕｒｏ","Nu ro"].map((name,i)=>({
  id:"duplicate"+i,name,active:true,enabled:true}))};
 let version=0,bindings=[];
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",readMappings:async()=>status(version,bindings),readProducts:async()=>source,
  saveMapping:async data=>{
   writes.push(data);version++;
   bindings=[{companyId:"partner",productId:data.partnerProductId,hubProductId:data.hubProductId}];
   return {saved:true,version,partnerCompanyId:"partner",partnerProductId:data.partnerProductId,
    hubProductId:data.hubProductId};
  }});
 await panel.refresh();
 assert(matchStatus(root,0).includes("3商材・競合／未保存"));
 const control=selects(root)[0];
 assert.equal(control.value,"");
 control.value="duplicate1";
 assert.equal(writes.length,0,"changing a DOM value alone is not approval");
 await control.fire("change");
 assert.deepEqual(writes,[{token:"a".repeat(40),partnerCompanyId:"partner",
  partnerProductId:"partnerSku01",hubProductId:"duplicate1",expectedVersion:0}]);
 assert.equal(selects(root)[0].value,"duplicate1");
 assert(matchStatus(root,0).includes("承認済みIDの対応を使用"));
 assert.equal(panel.getVersion(),1);
 panel.destroy();
});

test("an exact-name SKU approved for another category stays unavailable and is marked as a conflict",async()=>{
 const root=new Node("main"),auth={currentUser:user};let writes=0;
 const source={...catalog(),products:[{id:"reserved",name:"NURO",active:true,enabled:true}]};
 const bindings=[{companyId:"partner",productId:"partnerSku02",hubProductId:"reserved"}];
 const before=structuredClone({source,bindings});
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",readMappings:async()=>status(2,bindings),readProducts:async()=>source,
  saveMapping:async()=>{writes++;return {};}});
 await panel.refresh();
 assert(matchStatus(root,0).includes("別の分類で承認済み"));
 assert(matchStatus(root,0).includes("競合／未保存"));
 assert(!selects(root)[0].children.some(x=>x.value==="reserved"));
 assert.equal(selects(root)[1].value,"reserved");
 assert.equal(writes,0);assert.deepEqual({source,bindings},before);
 panel.destroy();
});

test("approved IDs remain authoritative after a name change or retirement despite a new exact-name SKU",async()=>{
 for(const active of [true,false]){
  const root=new Node("main"),auth={currentUser:user};let writes=0;
  const source={...catalog(),products:[
   {id:"approved",name:"名称変更後の商材",active,enabled:true},
   {id:"newCandidate",name:"NURO",active:true,enabled:true}]};
  const bindings=[{companyId:"partner",productId:"partnerSku01",hubProductId:"approved"}];
  const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
   partnerCompanyId:"partner",readMappings:async()=>status(4,bindings),readProducts:async()=>source,
   saveMapping:async()=>{writes++;return {};}});
  await panel.refresh();
  assert.equal(selects(root)[0].value,"approved");
  assert(matchStatus(root,0).includes("承認済みIDの対応を使用"));
  assert(!selects(root)[0].children.some(x=>x.textContent.startsWith("完全一致候補: ")));
  assert.equal(selects(root)[0].children.find(x=>x.value==="approved").disabled,!active);
  assert.equal(writes,0);
  panel.destroy();
 }
});

test("legacy combined candidates keep the existing combined-only rule and never split Hikari or Air",async()=>{
 const root=new Node("main"),auth={currentUser:user};let writes=0;
 const source={...catalog(),products:[
  {id:"mixed",name:"SB光・AIR",active:true,enabled:false},
  {id:"plainMixed",name:"SB光AIR",active:true,enabled:true},
  {id:"hikari",name:"SB光",active:true,enabled:true},
  {id:"air",name:"SoftBank Air",active:true,enabled:true}]};
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",readMappings:async()=>status(),readProducts:async()=>source,
  saveMapping:async()=>{writes++;return {};}});
 await panel.refresh();
 assert.deepEqual(selects(root)[4].children.map(x=>x.value),["","mixed"]);
 assert(matchStatus(root,4).includes("完全一致候補（未保存）: SB光・AIR"));
 assert.equal(selects(root)[4].value,"");
 assert.equal(writes,0);
 panel.destroy();
});

test("account switching while an Owner confirms a candidate cannot save through the old identity",async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});let tokens=0,writes=0;
 const identity={...user,getIdToken:async()=>++tokens===1?"a".repeat(40):pending};
 const root=new Node("main"),auth={currentUser:identity};
 const source={...catalog(),products:[{id:"candidate",name:"NURO",active:true,enabled:true}]};
 const panel=createOwnerReviewedSkuMappingPanel({enabled:true,document,root,auth,
  partnerCompanyId:"partner",readMappings:async()=>status(),readProducts:async()=>source,
  saveMapping:async()=>{writes++;return {};}});
 await panel.refresh();
 const control=selects(root)[0];control.value="candidate";
 const action=control.fire("change");
 auth.currentUser={...user,uid:"anotherOwner"};panel.onAuthChange();
 release("a".repeat(40));await action;
 assert.equal(writes,0);assert.equal(root.children.length,0);
 panel.destroy();
});
