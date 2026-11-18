import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makePartnerTabPublicationCallables}=require(
 "../functions-partner-tabs/controller.cjs"
);
class HttpsError extends Error {
 constructor(code,message){super(message);this.code=code;}
}
const bearer="Bearer "+"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345";
const auth={uid:"owner1",token:{email_verified:true,email:"owner@example.com"}};
const request=(data={})=>({data,auth,
 rawRequest:{headers:{authorization:bearer}}});
const saved={schema:"nico-partner-tabs-v1",revision:1,
 published:true,tabs:["team"]};
function fixture(on=true) {
 const calls={loads:0,auth:0,writes:0,owner:0,partner:0};
 const store={
  async readOwner(actor){calls.owner++;assert.equal(actor.uid,"owner1");return saved;},
  async readPartner(actor){calls.partner++;return saved;},
  async saveOwner(args){
   calls.writes++;
   assert.equal(args.actor.uid,"owner1");
   assert.equal(args.expectedRevision,1);
   assert.deepEqual(args.selectedTabs,["team"]);
   return {saved:true,schema:"nico-partner-tabs-v1",revision:2,
    published:true,tabs:["team"]};
  }
 };
 const service=makePartnerTabPublicationCallables({
  db:{runTransaction(){}},
  FieldValue:{serverTimestamp(){}},
  getAuth:()=>({}),
  HttpsError,
  enabled:()=>on,
  modules:async()=>{
   calls.loads++;
   return [{
    createVerifiedRankTokenReader:()=>async token=>{
     calls.auth++;
     assert.equal(token,bearer.slice(7));
     return {uid:"owner1",email:"owner@example.com",emailVerified:true};
    }
   },{
    createPartnerTabPublicationStore:()=>store
   }];
  }
 });
 return {calls,service};
}
const fails=(fn,code)=>assert.rejects(fn,e=>e instanceof HttpsError&&e.code===code);

test("OFF flag rejects before any token loading, Auth or DB",async()=>{
 const {calls,service}=fixture(false);
 await fails(()=>service.loadOwner(request()),"failed-precondition");
 await fails(()=>service.loadPartner(request()),"failed-precondition");
 await fails(()=>service.saveOwner(request({
  expectedRevision:1,published:true,tabs:["team"]
 })),"failed-precondition");
 assert.deepEqual(calls,{loads:0,auth:0,writes:0,owner:0,partner:0});
});
test("verified owner status and partner status are strict, safe shapes",async()=>{
 const {calls,service}=fixture();
 assert.deepEqual(await service.loadOwner(request()),saved);
 assert.deepEqual(await service.loadPartner(request()),saved);
 assert.equal(calls.owner,1);
 assert.equal(calls.partner,1);
 assert.equal(calls.loads,1);
});
test("only exact Owner payload and immutable revision may save",async()=>{
 const {calls,service}=fixture();
 const result=await service.saveOwner(request({
  expectedRevision:1,published:true,tabs:["team"]
 }));
 assert.deepEqual(result,{saved:true,schema:"nico-partner-tabs-v1",
  revision:2,published:true,tabs:["team"]});
 assert.equal(calls.writes,1);
 for(const data of [
  {expectedRevision:1,published:true,tabs:["team"],companyId:"other"},
  {expectedRevision:1,published:true,tabs:["finance"]},
  {expectedRevision:1,published:true,tabs:["team","team"]},
  {expectedRevision:-1,published:true,tabs:["team"]},
  {expectedRevision:1,published:true,tabs:["salesAnalysis"]},
  {expectedRevision:1,published:1,tabs:["team"]}
 ]){
  await fails(()=>service.saveOwner(request(data)),"invalid-argument");
 }
 assert.equal(calls.writes,1);
});
test("bearer, verified Auth identity and exact claims required",async()=>{
 const {calls,service}=fixture();
 await fails(()=>service.loadOwner({...request(),auth:{...auth,uid:"other"}}),
  "unauthenticated");
 await fails(()=>service.loadOwner({...request(),rawRequest:{headers:{}}}),
  "unauthenticated");
 await fails(()=>service.loadOwner({...request(),auth:{
  ...auth,token:{email_verified:false,email:"owner@example.com"}}}),
  "unauthenticated");
 await fails(()=>service.loadOwner(request({role:"owner"})),"invalid-argument");
 assert.equal(calls.owner,0);
});
test("erroring store does not leak private authorization detail",async()=>{
 const {service}=fixture();
 const value=await service.loadPartner(request());
 assert.equal(Object.hasOwn(value,"companyId"),false);
 assert.equal(Object.hasOwn(value,"revenue"),false);
 assert.equal(Object.hasOwn(value,"uid"),false);
});
