import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerProductVisibilityFirebaseBridge}
 from "../ranking/owner-product-visibility-firebase-bridge.mjs";
const owner={uid:"owner",emailVerified:true,getIdToken:async()=> "id-token"};
const status={schema:"nico-hub-product-visibility-v1",role:"hub_owner",
 version:1,hubCompanyId:"hub",products:[],partnerOverrides:{}};
function harness(){
 const auth={currentUser:owner},calls=[];
 const httpsCallable=(_fn,name,opts)=>async body=>{
  calls.push({name,body,opts});
  if(name==="getOwnerProductVisibility")return {data:status};
  return {data:{saved:true,version:2,productId:body.productId,
   enabled:body.enabled,partnerCompanyId:body.partnerCompanyId}};
 };
 const bridge=createOwnerProductVisibilityFirebaseBridge({
  auth,functions:{region:"asia-northeast1"},httpsCallable
 });
 return {auth,calls,bridge};
}
test("owner dashboard reads only authenticated callable, never Firestore or money",async()=>{
 const a=harness(),v=await a.bridge.load({token:"id-token"});
 assert.deepEqual(v,status);
 assert.deepEqual(a.calls.map(c=>c.name),["getOwnerProductVisibility"]);
 assert.deepEqual(a.calls[0].body,{});
 assert(!JSON.stringify(a.calls).includes("cashback"));
 assert(!JSON.stringify(a.calls).includes("revenue"));
});
test("switch calls only scoped backend with exact ID, flag, version and partner",async()=>{
 const a=harness(),result=await a.bridge.save({
  token:"id-token",productId:"nuro",enabled:true,expectedVersion:1,
  partnerCompanyId:null
 });
 assert.equal(result.saved,true);
 assert.deepEqual(a.calls[0].body,{
  productId:"nuro",enabled:true,expectedVersion:1,partnerCompanyId:null
 });
});
test("spoofed token and malformed product IDs are blocked before any request",async()=>{
 const a=harness();
 await assert.rejects(a.bridge.load({token:"fake"}),/IDENTITY_CHANGED/);
 await assert.rejects(a.bridge.save({token:"id-token",
  productId:"../../records",enabled:true,expectedVersion:1}),/IDENTITY_CHANGED/);
 assert.equal(a.calls.length,0);
});
test("login change while request pending refuses stale company response",async()=>{
 const auth={currentUser:owner},calls=[];
 let finish;const pending=new Promise(resolve=>{finish=resolve});
 const bridge=createOwnerProductVisibilityFirebaseBridge({auth,functions:{},
  httpsCallable:(_fn,name)=>async body=>{calls.push({name,body});
   return pending;}});
 const load=bridge.load({token:"id-token"});
 for(let k=0;k<20&&calls.length===0;k++)await Promise.resolve();
 auth.currentUser={uid:"other",emailVerified:true,getIdToken:async()=> "new"};
 bridge.onAuthChange();
 finish({data:status});
 await assert.rejects(load,/IDENTITY_CHANGED/);
});
