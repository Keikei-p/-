import test from "node:test";
import assert from "node:assert/strict";
import {mountOwnerProductVisibilityDashboard}
 from "../ranking/owner-product-visibility-dashboard-mount.mjs";

class Node{
 constructor(tag){
  this.tagName=tag;this.children=[];this.listeners={};
  this.textContent="";this.className="";this.checked=false;this.disabled=false;
 }
 appendChild(x){this.children.push(x);return x;}
 replaceChildren(...xs){this.children=xs;}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
 async fire(k){for(const fn of this.listeners[k]||[])await fn();}
}
const document={createElement:tag=>new Node(tag)};
const nodes=n=>[n,...n.children.flatMap(nodes)];
const visibleText=n=>nodes(n).map(x=>x.textContent).join(" ");
const owner={uid:"owner",emailVerified:true,getIdToken:async()=>"verified-token"};
const product=()=>({id:"nuro",name:"NURO光",active:true,enabled:false});
function harness({getOverride}={}){
 const root=new Node("div"),auth={currentUser:null},calls=[];
 let listener,unsubscribed=0,version=0,enabled=false;
 const httpsCallable=(_functions,name,options)=>{
  assert.equal(options.timeout,20000);
  return async body=>{
   calls.push({name,body});
   if(name==="getOwnerProductVisibility"){
    if(getOverride)return {data:await getOverride()};
    return {data:{schema:"nico-hub-product-visibility-v1",
     role:"hub_owner",version,hubCompanyId:"hub",
     products:[{...product(),enabled}],partnerOverrides:{}}};
   }
   assert.equal(name,"setOwnerProductVisibility");
   assert.deepEqual(Object.keys(body).sort(),
    ["enabled","expectedVersion","partnerCompanyId","productId"]);
   assert.equal(body.expectedVersion,version);
   assert.equal(body.productId,"nuro");
   assert.equal(body.partnerCompanyId,null);
   enabled=body.enabled;version++;
   return {data:{saved:true,version,productId:"nuro",
    enabled,partnerCompanyId:null}};
  };
 };
 const onAuthStateChanged=(a,fn)=>{
  assert.equal(a,auth);listener=fn;return ()=>{unsubscribed++;};
 };
 const args={featureEnabled:true,document,root,auth,functions:{region:"asia-northeast1"},
  httpsCallable,onAuthStateChanged};
 return {root,auth,calls,args,
  emit:async user=>{auth.currentUser=user;return listener(user);},
  get unsubscribed(){return unsubscribed;}
 };
}

test("feature disabled never registers a listener or calls a backend",()=>{
 const h=harness();
 assert.throws(()=>mountOwnerProductVisibilityDashboard({
  ...h.args,featureEnabled:false}),/MOUNT_NOT_READY/);
 assert.equal(h.calls.length,0);
});

test("existing owner dashboard uses actual named Firebase callables; OFF/ON reload is server-confirmed",async()=>{
 const h=harness(),mount=mountOwnerProductVisibilityDashboard(h.args);
 assert.equal(await h.emit(owner),true);
 assert.equal(mount.getVersion(),0);
 assert(visibleText(h.root).includes("NURO光"));
 assert.equal(h.calls[0].name,"getOwnerProductVisibility");
 const input=nodes(h.root).find(n=>n.tagName==="input");
 input.checked=true;
 await input.fire("change");
 assert.equal(h.calls[1].name,"setOwnerProductVisibility");
 assert.deepEqual(h.calls[1].body,{productId:"nuro",enabled:true,
  expectedVersion:0,partnerCompanyId:null});
 assert.equal(h.calls[2].name,"getOwnerProductVisibility");
 assert.equal(mount.getVersion(),1);
 assert.equal(nodes(h.root).find(n=>n.tagName==="input").checked,true);
 assert(!/売上|単価|キャッシュバック|cashback|revenue/.test(visibleText(h.root)));
 mount.destroy();
 assert.equal(h.unsubscribed,1);
 assert.equal(h.root.children.length,0);
 assert.equal(await mount.refresh(),false);
});

test("logout and unverified users clear prior owner publication without a stale read",async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const h=harness({getOverride:()=>pending});
 const mount=mountOwnerProductVisibilityDashboard(h.args);
 const inflight=h.emit(owner);
 for(let i=0;i<30&&h.calls.length===0;i++)await Promise.resolve();
 assert.equal(h.calls.length,1);
 await h.emit(null);
 finish({schema:"nico-hub-product-visibility-v1",role:"hub_owner",
  version:3,hubCompanyId:"hub",
  products:[{...product(),enabled:true}],partnerOverrides:{}});
 assert.equal(await inflight,false);
 assert.equal(h.root.children.length,0);
 assert.equal(await h.emit({uid:"guest",emailVerified:false}),false);
 assert.equal(h.calls.length,1);
 mount.destroy();
});

test("partner role cannot render owner settings even if callable returns a forged payload",async()=>{
 const h=harness({getOverride:async()=>({
  schema:"nico-hub-product-visibility-v1",role:"partner_owner",
  version:1,hubCompanyId:"hub",products:[product()],partnerOverrides:{}
 })});
 const mount=mountOwnerProductVisibilityDashboard(h.args);
 assert.equal(await h.emit(owner),false);
 assert.equal(nodes(h.root).filter(x=>x.tagName==="input").length,0);
 assert(visibleText(h.root).includes("管理者"));
 mount.destroy();
});
