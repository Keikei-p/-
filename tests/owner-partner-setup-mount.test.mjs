import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mountOwnerPartnerSetup} from "../ranking/owner-partner-setup-mount.mjs";
class Node {
 constructor(tag){
  this.tagName=tag;this.children=[];this.listeners={};this.textContent="";
  this.className="";this.checked=false;this.disabled=false;this.value="";
 }
 appendChild(node){this.children.push(node);return node;}
 replaceChildren(...items){this.children=items;}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
 async fire(k){for(const fn of this.listeners[k]||[])await fn();}
}
const document={createElement:t=>new Node(t)};
const walk=n=>[n,...n.children.flatMap(walk)];
const content=n=>walk(n).map(x=>x.textContent).join(" ");
const user={uid:"owner",emailVerified:true,getIdToken:async()=>"signed-server-checked-token-abc"};
function fixture(role="hub_owner"){
 const calls=[],root=new Node("main"),auth={currentUser:user};
 const status={schema:"nico-ranking-owner-consent-v1",role,partners:[{
  partnerCompanyId:"partner",companyName:"協力店A",ownApproved:false,
  otherApproved:false,version:0,canEdit:true
 }]};
 const products={schema:"nico-hub-product-visibility-v1",role:"hub_owner",
  version:1,hubCompanyId:"hub",products:[
   {id:"nuro",name:"NURO光",active:true,enabled:true},
   {id:"air",name:"SoftBank Air",active:true,enabled:false}
  ],partnerOverrides:{partner:[]}};
 const mapping={schema:"nico-owner-reviewed-sku-map-v1",hubCompanyId:"hub",
  version:0,bindings:[]};
 let observer=()=>{};
 const httpsCallable=(_fn,name)=>async payload=>{
  calls.push({name,payload});
  if(name==="getRankingOwnerConsentStatus")return {data:status};
  if(name==="getOwnerProductVisibility")return {data:products};
  if(name==="getOwnerReviewedSkuMapping")return {data:mapping};
  throw Error("Unexpected callable: "+name);
 };
 const mount=()=>mountOwnerPartnerSetup({document,root,auth,functions:{},
  httpsCallable,onAuthStateChanged:(_auth,cb)=>{observer=cb;return()=>{observer=()=>{};}}});
 return {auth,root,calls,mount,onChange:()=>observer()};
}
test("hub owner sees verified consent, global switches, company overrides and nine mappings",async()=>{
 const f=fixture(),controller=f.mount();
 assert.equal(await controller.refresh(),true);
 const label=content(f.root);
 assert.match(label,/協力店・ランキング一括管理/);
 assert.match(label,/合同ランキングの公開設定/);
 assert.match(label,/選択した協力店の商材ON\/OFF/);
 assert.match(label,/商材対応/);
 const selections=walk(f.root).filter(x=>x.tagName==="select");
 assert(selections.length>=10);
 assert.equal(selections[0].value,"partner");
 assert(f.calls.some(x=>x.name==="getOwnerProductVisibility"));
 assert(f.calls.some(x=>x.name==="getOwnerReviewedSkuMapping"));
 assert(!f.calls.some(x=>/record|price|revenue|cashback|sales/i.test(x.name)));
 controller.destroy();assert.equal(f.root.children.length,0);
});
test("partner owner can consent but cannot mount hub product or SKU-mapping controls",async()=>{
 const f=fixture("partner_owner"),controller=f.mount();
 assert.equal(await controller.refresh(),true);
 assert.match(content(f.root),/合同ランキングの公開設定/);
 assert(!f.calls.some(x=>x.name==="getOwnerProductVisibility"||
  x.name==="getOwnerReviewedSkuMapping"));
 controller.destroy();
});
test("signed-out user has no server reads, no cached owner details and auth is reversible",async()=>{
 const f=fixture(),controller=f.mount();f.auth.currentUser=null;
 assert.equal(await controller.refresh(),false);
 assert.match(content(f.root),/ログインしてください/);
 assert.equal(f.calls.length,0);
 f.auth.currentUser=user;
 assert.equal(await controller.refresh(),true);
 f.auth.currentUser=null;
 assert.equal(await controller.refresh(),false);
 assert(!content(f.root).includes("協力店A"));
 controller.destroy();
});
test("hosting page uses only Firebase Auth and Owner Functions, no raw finance datastore",()=>{
 const html=readFileSync(new URL("../owner-partner-setup.html",import.meta.url),"utf8");
 const source=readFileSync(new URL("../ranking/owner-partner-setup-mount.mjs",import.meta.url),"utf8");
 assert.match(html,/getFunctions\(app,"asia-northeast1"\)/);
 assert.match(html,/mountOwnerPartnerSetup/);
 assert.match(html,/noindex,nofollow/);
 assert.doesNotMatch(html+source,/firebase-firestore|(?:getFirestore|getDocs|setDoc|localStorage|sessionStorage)\s*\(/);
 assert.doesNotMatch(source,/runTransaction|firebase deploy|document\.cookie/);
});
