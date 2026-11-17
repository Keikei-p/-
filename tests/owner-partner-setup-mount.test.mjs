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
function fixture(role="hub",multi="none"){
 const calls=[],root=new Node("main"),auth={currentUser:user};
 const status={role,registeredCompanies:[{
  partnerCompanyId:"partner",name:"協力店A",active:true
 }]};
 const products={schema:"nico-hub-product-visibility-v1",role:"hub_owner",
  version:1,hubCompanyId:"hub",products:[
   {id:"nuro",name:"NURO光",active:true,enabled:true},
   {id:"air",name:"SoftBank Air",active:true,enabled:false}
  ],partnerOverrides:multi==="none"?{partner:[]}:{}};
 const mapping={schema:"nico-owner-reviewed-sku-map-v1",hubCompanyId:"hub",
  version:0,bindings:[]};
 if(multi!=="none")status.registeredCompanies.push(
  {partnerCompanyId:"partner2",name:"協力店B",active:true},
  {partnerCompanyId:"partner3",name:"協力店C",active:true});
 let observer=()=>{};
 const httpsCallable=(_fn,name)=>async payload=>{
  calls.push({name,payload});
  if(name==="getPartnerWorkspace"){
   if(role==="partnerDenied")throw Object.assign(new Error("server denied"),
    {code:"functions/permission-denied"});
   return {data:status};
  }
  if(name==="getOwnerProductVisibility")return {data:products};
  if(name==="setOwnerProductVisibility"){
   assert.equal(payload.expectedVersion,products.version,
    "shared visibility revision must be refreshed before another switch");
   if(payload.partnerCompanyId===null){
    const row=products.products.find(p=>p.id===payload.productId);
    assert(row);row.enabled=payload.enabled;
   }else{
    assert.equal(payload.partnerCompanyId,"partner");
    const current=products.partnerOverrides.partner||[];
    products.partnerOverrides.partner=payload.enabled?
     [...new Set([...current,payload.productId])]:
     current.filter(id=>id!==payload.productId);
   }
   products.version++;
   return {data:{saved:true,version:products.version,
    productId:payload.productId,enabled:payload.enabled,
    partnerCompanyId:payload.partnerCompanyId}};
  }
  if(name==="getOwnerReviewedSkuMapping")return {data:mapping};
  if(name==="setOwnerReviewedSkuMapping"&&multi!=="none"){
   assert.equal(payload.expectedVersion,mapping.version);
   if(multi==="fail-third"&&payload.partnerCompanyId==="partner3")
    throw Error("permission-denied");
   assert(["partner","partner2","partner3"].includes(payload.partnerCompanyId));
   assert.equal(payload.partnerProductId,"partnerSku01");
   assert.equal(payload.hubProductId,"nuro");
   assert(!mapping.bindings.some(b=>b.companyId===payload.partnerCompanyId));
   mapping.version++;
   mapping.bindings.push({companyId:payload.partnerCompanyId,
    productId:payload.partnerProductId,hubProductId:payload.hubProductId});
   return {data:{saved:true,version:mapping.version,
    partnerCompanyId:payload.partnerCompanyId,
    partnerProductId:payload.partnerProductId,hubProductId:payload.hubProductId}};
  }
  throw Error("Unexpected callable: "+name);
 };
 const mount=()=>mountOwnerPartnerSetup({document,root,auth,functions:{},
  httpsCallable,onAuthStateChanged:(_auth,cb)=>{observer=cb;return()=>{observer=()=>{};}}});
 return {auth,root,calls,status,mapping,products,mount,onChange:()=>observer()};
}
test("hub owner sees existing active partner, global switches and nine mappings without extra consent",async()=>{
 const f=fixture(),controller=f.mount();
 assert.equal(await controller.refresh(),true);
 const label=content(f.root);
 assert.match(label,/協力店・ランキング一括管理/);
 assert.doesNotMatch(label,/合同ランキングの公開設定|両社未承認|相手の承認待ち/);
 assert.match(label,/選択した協力店の商材ON\/OFF/);
 assert.match(label,/商材対応/);
 const selections=walk(f.root).filter(x=>x.tagName==="select");
 assert(selections.length>=10);
 assert.equal(selections[0].value,"partner");
 assert(f.calls.some(x=>x.name==="getPartnerWorkspace"&&
  x.payload?.ownerSetupCompaniesOnly===true&&/^\d{4}-\d{2}-\d{2}$/.test(x.payload.date)));
 assert(f.calls.every(x=>x.name!=="getRankingOwnerConsentStatus"&&x.name!=="setRankingOwnerConsent"));
 assert(f.calls.some(x=>x.name==="getOwnerProductVisibility"));
 assert(f.calls.some(x=>x.name==="getOwnerReviewedSkuMapping"));
 assert(!f.calls.some(x=>/record|price|revenue|cashback|sales/i.test(x.name)));
 controller.destroy();assert.equal(f.root.children.length,0);
});
test("partner owner is informed hub Owner manages ON/OFF and cannot view hub SKU tools",async()=>{
 const f=fixture("owner"),controller=f.mount();
 assert.equal(await controller.refresh(),true);
 assert.match(content(f.root),/設定は自社Ownerが行います/);
 assert(f.calls.every(x=>x.name!=="setRankingOwnerConsent"));
 assert(!f.calls.some(x=>x.name==="getOwnerProductVisibility"||
  x.name==="getOwnerReviewedSkuMapping"));
 controller.destroy();
});
test("real server Owner-only denial gives partner guidance and never opens SKU controls",async()=>{
 const f=fixture("partnerDenied"),ctl=f.mount();
 assert.equal(await ctl.refresh(),false);
 assert.match(content(f.root),/自社Owner専用/);
 assert.match(content(f.root),/追加承認は不要/);
 assert.doesNotMatch(content(f.root),/連携状況を確認できません/);
 assert.deepEqual(f.calls.map(x=>x.name),["getPartnerWorkspace"]);
 assert.equal(f.calls[0].payload.ownerSetupCompaniesOnly,true);
 ctl.destroy();
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

test("inactive or malformed partner relation never grants Owner SKU settings",async()=>{
 const inactive=fixture();
 inactive.status.registeredCompanies.push({
  partnerCompanyId:"inactive_partner",name:"休止中の協力店",active:false
 });
 const first=inactive.mount();
 assert.equal(await first.refresh(),true);
 const selected=walk(inactive.root).find(x=>x.tagName==="select");
 assert.equal(selected?.children?.length,1,"inactive company is not offered for SKU changes");
 assert.doesNotMatch(content(inactive.root),/休止中の協力店/);
 first.destroy();
 for(const mutate of [
  x=>{x.name="機密売上100万円";},
  x=>{x.partnerCompanyId="../other";},
  x=>{x.active="yes";},
  x=>{x.name="";},
  x=>{x.partnerCompanyId="__proto__";x.active="yes";}
 ]){
  const bad=fixture();
  mutate(bad.status.registeredCompanies[0]);
  const ctl=bad.mount();
  assert.equal(await ctl.refresh(),false);
  assert(!bad.calls.some(x=>x.name==="getOwnerProductVisibility"||
   x.name==="getOwnerReviewedSkuMapping"),"never mount hub tools from invalid company data");
  assert.doesNotMatch(content(bad.root),/機密売上|協力店A|NURO光/);
  ctl.destroy();
 }
});
test("non-hub workspace roles never mount hub Owner product controls",async()=>{
 for(const role of ["member","leader","owner"]){
  const f=fixture(role),ctl=f.mount();
  assert.equal(await ctl.refresh(),true);
  assert(f.calls.every(x=>x.name!=="getOwnerProductVisibility"&&
   x.name!=="getOwnerReviewedSkuMapping"&&x.name!=="setRankingOwnerConsent"));
  assert.doesNotMatch(content(f.root),/自社の全体商材|選択した協力店の商材ON\/OFF/);
  ctl.destroy();
 }
});

test("global and partner ON/OFF keep the same fresh revision without reloading the whole page",async()=>{
 const f=fixture(),controller=f.mount();
 assert.equal(await controller.refresh(),true);
 const switches=label=>walk(f.root).filter(x=>x.tagName==="label"&&
  x.children.some(y=>y.tagName==="span"&&y.textContent===label))
  .map(x=>x.children.find(y=>y.tagName==="input"));
 let [globalAir,partnerAir]=switches("SoftBank Air");
 assert.equal(globalAir.checked,false);
 assert.equal(partnerAir.disabled,true,"globally OFF SKU stays disabled");
 globalAir.checked=true;
 await globalAir.fire("change");
 [globalAir,partnerAir]=switches("SoftBank Air");
 assert.equal(globalAir.checked,true);
 assert.equal(partnerAir.disabled,false,
  "newly ON SKU becomes selectable for partner without page reload");
 assert.equal(partnerAir.checked,false,"existing company override stays OFF");
 const [,partnerNuro]=switches("NURO光");
 partnerNuro.checked=true;
 await partnerNuro.fire("change");
 [globalAir]=switches("SoftBank Air");
 globalAir.checked=false;
 await globalAir.fire("change");
 const saves=f.calls.filter(x=>x.name==="setOwnerProductVisibility");
 assert.deepEqual(saves.map(x=>x.payload.expectedVersion),[1,2,3],
  "each write must use the revision returned after the previous save");
 assert.deepEqual(saves.map(x=>x.payload.partnerCompanyId),[null,"partner",null]);
 assert.equal(f.calls.some(x=>/RankingOwnerConsent/.test(x.name)),false);
 assert(f.calls.every(x=>!/records|unitPrice|revenue|cashback/i.test(x.name)));
 controller.destroy();
});

test("three registered partners preview three exact mappings but no write on initial load",async()=>{
 const f=fixture("hub","three"),ctl=f.mount();
 assert.equal(await ctl.refresh(),true);
 assert.match(content(f.root),/登録済み協力店の一致商材をまとめて連携/);
 const trigger=walk(f.root).find(x=>x.tagName==="button"&&
  x.textContent==="上記3件を全社まとめて保存");
 assert(trigger);
 assert.match(content(f.root),/協力店A：NURO → NURO光/);
 assert.match(content(f.root),/協力店B：NURO → NURO光/);
 assert.match(content(f.root),/協力店C：NURO → NURO光/);
 assert(!f.calls.some(x=>x.name==="setOwnerReviewedSkuMapping"),
  "no automatic Firestore mappings on page load");
 ctl.destroy();
});
test("all-company Owner click saves all three through existing API with version and real re-reads",async()=>{
 const f=fixture("hub","three"),ctl=f.mount();
 assert.equal(await ctl.refresh(),true);
 const trigger=walk(f.root).find(x=>x.tagName==="button"&&
  x.textContent==="上記3件を全社まとめて保存");
 assert(trigger);
 await trigger.fire("click");
 const saves=f.calls.filter(x=>x.name==="setOwnerReviewedSkuMapping");
 assert.deepEqual(saves.map(x=>[x.payload.partnerCompanyId,x.payload.expectedVersion]),[
  ["partner",0],["partner2",1],["partner3",2]
 ]);
 assert.equal(f.mapping.version,3);
 assert.deepEqual(f.mapping.bindings.map(x=>x.companyId),[
  "partner","partner2","partner3"
 ]);
 assert.match(content(f.root),/全社の商材対応3件を保存・再確認しました/);
 assert(!walk(f.root).some(x=>x.tagName==="button"&&
   x.textContent.includes("全社まとめて保存")));
 assert(f.calls.every(x=>!/record|revenue|unitPrice|cashback/i.test(x.name)));
 ctl.destroy();
});
test("third-company denial stops batch and keeps first two audited confirmed changes only",async()=>{
 const f=fixture("hub","fail-third"),ctl=f.mount();
 assert.equal(await ctl.refresh(),true);
 const trigger=walk(f.root).find(x=>x.tagName==="button"&&
  x.textContent==="上記3件を全社まとめて保存");
 assert(trigger);
 await trigger.fire("click");
 const saves=f.calls.filter(x=>x.name==="setOwnerReviewedSkuMapping");
 assert.equal(saves.length,3);
 assert.equal(f.mapping.version,2);
 assert.equal(f.mapping.bindings.length,2);
 assert.match(content(f.root),/全社一括連携を停止しました。保存確認済み2件/);
 assert.match(content(f.root),/協力店C：NURO → NURO光/);
 assert(!content(f.root).includes("協力店A：NURO → NURO光"),
  "no already-saved proposal left in the updated batch");
 ctl.destroy();
});
test("no active partner SKU offer with company-specific OFF never shows multi-company save",async()=>{
 const f=fixture("hub","three");
 f.products.partnerOverrides={partner:[],partner2:[],partner3:[]};
 const ctl=f.mount();assert.equal(await ctl.refresh(),true);
 assert.match(content(f.root),/全社一括連携の未設定候補はありません/);
 assert(!walk(f.root).some(x=>x.tagName==="button"&&
  x.textContent.includes("全社まとめて保存")));
 assert(!f.calls.some(x=>x.name==="setOwnerReviewedSkuMapping"));
 ctl.destroy();
});
