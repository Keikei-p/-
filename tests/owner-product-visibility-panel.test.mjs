import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerProductVisibilityPanel}
 from "../ranking/owner-product-visibility-panel.mjs";
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};
  this.textContent="";this.className="";this.checked=false;this.disabled=false;}
 appendChild(x){this.children.push(x);return x}
 replaceChildren(...xs){this.children=xs}
 setAttribute(k,v){this[k]=v}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 async fire(k){for(const fn of this.listeners[k]||[])await fn()}
}
const document={createElement:tag=>new Node(tag)};
const nodes=n=>[n,...n.children.flatMap(nodes)];
const text=n=>nodes(n).map(x=>x.textContent).join(" ");
const getCheckbox=n=>nodes(n).find(x=>x.tagName==="input");
const response=(enabled=false,version=1)=>({
 schema:"nico-hub-product-visibility-v1",role:"hub_owner",version,
 products:[{id:"nuro",name:"NURO光",active:true,enabled},
  {id:"air",name:"SoftBank Air",active:true,enabled:false}]
});
const user={uid:"owner",getIdToken:async()=>"signed-server-checked-token"};
test("owner-only mobile toggle displays count visibility without any finance field",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
  load:async()=>response(),save:async()=>{throw Error("unused")}});
 assert.equal(await ctrl.refresh(),true);
 assert.equal(ctrl.getVersion(),1);
 assert(text(root).includes("NURO光"));
 assert(text(root).includes("OFF"));
 assert(!text(root).includes("売上"));
 assert(!text(root).includes("単価"));
 assert(!text(root).includes("キャッシュバック"));
 ctrl.destroy();assert.equal(root.children.length,0);
});
test("toggle saves only id/boolean/expectedVersion, then reloads confirmed server state",async()=>{
 const root=new Node("main"),auth={currentUser:user},calls=[];
 let version=1,enabled=false;
 const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
  load:async()=>response(enabled,version),
  save:async input=>{
   calls.push(input);enabled=input.enabled;version++;
   return {saved:true,version,productId:input.productId,enabled:input.enabled};
  }});
 await ctrl.refresh();
 const box=getCheckbox(root);box.checked=true;
 await box.fire("change");
 assert.deepEqual(calls,[{token:"signed-server-checked-token",productId:"nuro",
  enabled:true,expectedVersion:1,partnerCompanyId:null}]);
 assert.equal(ctrl.getVersion(),2);
 assert.equal(getCheckbox(root).checked,true);
 assert(text(root).includes("ON"));
});
test("unverified roles and monetary fields never become owner toggles",async()=>{
 for(const edit of [
  x=>{x.role="partner_owner"},
  x=>{x.products[0].revenue=25000},
  x=>{x.products[0].name="NURO CB50000"},
  x=>{x.products[0].id="../sales"},
  x=>{x.products[1].id="nuro"},
  x=>{x.products[0].active=false;x.products[0].enabled=true}
 ]){
  const root=new Node("main"),auth={currentUser:user};
  const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
   load:async()=>{const x=response();edit(x);return x},save:async()=>{}});
  assert.equal(await ctrl.refresh(),false);
  assert.equal(nodes(root).filter(x=>x.tagName==="input").length,0);
  ctrl.destroy();
 }
});
test("logout during pending GET clears old identity; no former data is rendered",async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r});
 const root=new Node("main"),auth={currentUser:user};
 const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
  load:async()=>pending,save:async()=>{}});
 const request=ctrl.refresh();auth.currentUser=null;ctrl.onAuthChange();
 resolve(response(true));
 assert.equal(await request,false);
 assert.equal(root.children.length,0);
});
test("failed save refreshes server state; never confirms unsaved toggle",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
  load:async()=>response(false),save:async()=>{throw Error("failed")}});
 await ctrl.refresh();
 const check=getCheckbox(root);check.checked=true;
 await check.fire("change");
 assert.equal(getCheckbox(root).checked,false);
 assert.equal(ctrl.getVersion(),1);
});

test("company-specific ON/OFF uses server override, not global settings writes",async()=>{
 const root=new Node("main"),auth={currentUser:user},calls=[];
 let v=response(true,7);v.partnerOverrides={partner:[]};
 const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
  partnerCompanyId:"partner",load:async()=>v,
  save:async input=>{
   calls.push(input);
   v={...v,version:v.version+1,partnerOverrides:{partner:["nuro"]}};
   return {saved:true,version:v.version,productId:input.productId,
    enabled:input.enabled,partnerCompanyId:input.partnerCompanyId};
  }});
 assert.equal(await ctrl.refresh(),true);
 assert.equal(getCheckbox(root).checked,false,"partner OFF even while globally ON");
 const box=getCheckbox(root);box.checked=true;
 await box.fire("change");
 assert.equal(getCheckbox(root).checked,true);
 assert.deepEqual(calls,[{token:"signed-server-checked-token",
  productId:"nuro",enabled:true,expectedVersion:7,partnerCompanyId:"partner"}]);
 assert.equal(ctrl.getVersion(),8);
 ctrl.destroy();
});
test("company-specific control cannot switch globally OFF or malformed overrides",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const ctrl=createOwnerProductVisibilityPanel({document,root,auth,
  partnerCompanyId:"partner",load:async()=>({
   ...response(false,2),partnerOverrides:{partner:["nuro"]}
  }),save:async()=>{throw Error("should_not_save")}});
 assert.equal(await ctrl.refresh(),true);
 assert.equal(getCheckbox(root).checked,false);
 assert.equal(getCheckbox(root).disabled,true);
 ctrl.destroy();
 const invalid=new Node("main");
 const bad=createOwnerProductVisibilityPanel({document,root:invalid,auth,
  partnerCompanyId:"partner",load:async()=>({
   ...response(true,2),partnerOverrides:{partner:"nuro"}
  }),save:async()=>{}});
 assert.equal(await bad.refresh(),false);
 assert.equal(nodes(invalid).filter(x=>x.tagName==="input").length,0);
 bad.destroy();
 assert.throws(()=>createOwnerProductVisibilityPanel({document,
  root:new Node("main"),auth,partnerCompanyId:"__proto__",
  load:async()=>{},save:async()=>{}}));
});
