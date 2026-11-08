import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRankingOwnerFirebaseBridge}
 from "../ranking/owner-ranking-consent-firebase-bridge.mjs";

const healthy=()=>({
 schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
 partners:[{partnerCompanyId:"partner",companyName:"協力店A",
  ownApproved:false,otherApproved:false,canEdit:true,version:0}]
});
const make=(overrides={})=>{
 let tokenCount=0;
 const user={
  uid:"owner",emailVerified:true,getIdToken:async()=>{tokenCount++;},
  ...(overrides.user||{})
 };
 const auth={currentUser:user};
 const calls=[];
 const bridge=createRankingOwnerFirebaseBridge({
  auth,functions:{},sharedCodeSession:()=>overrides.shared===true,
  httpsCallable:(_functions,name)=>async data=>{
   calls.push({name,data});
   if(overrides.call) return overrides.call(name,data,auth);
   return {data:name==="getRankingOwnerConsentStatus"?healthy():{
    saved:true,partnerCompanyId:data.partnerCompanyId,
    enabled:data.enable,version:data.expectedVersion+1
   }};
  }
 });
 return {bridge,auth,calls,user,getTokenCount:()=>tokenCount};
};
test("bridge uses two distinct real callable names with current verified email-login user",async()=>{
 const x=make();
 const status=await x.bridge.loadStatus();
 assert.deepEqual(status,healthy());
 const changed=await x.bridge.saveConsent({
  partnerCompanyId:"partner",enable:true,expectedVersion:0
 });
 assert.deepEqual(changed,{
  saved:true,partnerCompanyId:"partner",enabled:true,version:1
 });
 assert.deepEqual(x.calls,[
  {name:"getRankingOwnerConsentStatus",data:{}},
  {name:"setRankingOwnerConsent",
   data:{partnerCompanyId:"partner",enable:true,expectedVersion:0}}
 ]);
 assert.equal(x.getTokenCount(),2);
});
test("no account, no verified mail, shared code session or failed ID token blocks BEFORE callable",async()=>{
 for(const changes of [
  x=>{x.auth.currentUser=null;},
  x=>{x.user.emailVerified=false;},
  x=>{x.user.uid="../../secret";},
  x=>{x.user.getIdToken=async()=>{throw Error("secret-token");}}
 ]){
  const x=make();changes(x);
  await assert.rejects(x.bridge.loadStatus(),/公開設定の認証/);
  await assert.rejects(x.bridge.saveConsent({
   partnerCompanyId:"partner",enable:true,expectedVersion:0
  }),/公開設定の認証/);
  assert.equal(x.calls.length,0);
 }
 const shared=make({shared:true});
 await assert.rejects(shared.bridge.loadStatus(),/公開設定の認証/);
 assert.equal(shared.calls.length,0);
});
test("mid-request auth switch never shows prior user's partner approval or accepts a save response",async()=>{
 const x=make({call:async(name,_data,auth)=>{
  auth.currentUser={uid:"newUser",emailVerified:true,getIdToken:async()=>{}};
  return {data:name==="getRankingOwnerConsentStatus"?healthy():{
   saved:true,enabled:true,partnerCompanyId:"partner",version:1
  }};
 }});
 await assert.rejects(x.bridge.loadStatus(),/公開設定の認証/);
 const y=make({call:async(_name,data,auth)=>{
  auth.currentUser=null;
  return {data:{
   saved:true,enabled:data.enable,partnerCompanyId:data.partnerCompanyId,version:1
  }};
 }});
 await assert.rejects(y.bridge.saveConsent({
  partnerCompanyId:"partner",enable:true,expectedVersion:0
 }),/公開設定の認証/);
});
test("unexpected client input or financial payload must fail closed",async()=>{
 const x=make();
 for(const bad of [
  {partnerCompanyId:"partner",enable:true,expectedVersion:0,totalRevenue:10},
  {partnerCompanyId:"../../partner",enable:true,expectedVersion:0},
  {partnerCompanyId:"partner",enable:"true",expectedVersion:0},
  {partnerCompanyId:"partner",enable:true,expectedVersion:"0"},
  {partnerCompanyId:"partner",enable:true,expectedVersion:999}
 ]){
  await assert.rejects(x.bridge.saveConsent(bad),/公開設定の認証/);
 }
 assert.equal(x.calls.length,0);
 const y=make({call:async()=>({data:{
  ...healthy(),unitPrice:50000
 }})});
 await assert.rejects(y.bridge.loadStatus(),/公開設定を安全に/);
});
test("failed, stale or forged server result never claims successful save",async()=>{
 for(const bad of [
  {saved:true,enabled:true,version:2,partnerCompanyId:"partner"},
  {saved:true,enabled:true,version:1,partnerCompanyId:"other"},
  {saved:true,enabled:true,version:1,partnerCompanyId:"partner",cashback:9000},
  {saved:false,enabled:true,version:1,partnerCompanyId:"partner"}
 ]){
  const x=make({call:async()=>({data:bad})});
  await assert.rejects(x.bridge.saveConsent({
   partnerCompanyId:"partner",enable:true,expectedVersion:0
  }),/公開設定の認証/);
 }
});
test("bridge uses no browser document API, direct Firestore or persisted financial state",()=>{
 const src=readFileSync(new URL(
  "../ranking/owner-ranking-consent-firebase-bridge.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/getFirestore|setDoc|updateDoc|deleteDoc|localStorage|sessionStorage|innerHTML|fetch[(]|XMLHttpRequest|indexedDB/);
 assert.match(src,/getRankingOwnerConsentStatus/);
 assert.match(src,/setRankingOwnerConsent/);
});
