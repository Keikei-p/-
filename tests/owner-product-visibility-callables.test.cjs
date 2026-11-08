"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {makeProductVisibilityCallables}=require(
 "../functions-ranking-approvals/product-visibility-controller.cjs");
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code}
}
const TOKEN="a".repeat(30);
const identity={uid:"owner",email:"owner@example.test",emailVerified:true};
function request(data={},override={}){
 return {auth:{uid:"owner",token:{email:"owner@example.test",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+TOKEN}},data,...override};
}
const status={schema:"nico-hub-product-visibility-v1",role:"hub_owner",
 version:1,hubCompanyId:"hub",partnerOverrides:{},
 products:[{id:"nuro",name:"NURO光",active:true,enabled:true}]};
function calls({enabled=true,loaded=status,result=null}={}){
 let access=0,reads=0,writes=0;
 const trusted={
  createVerifiedRankTokenReader:()=>async token=>{
   if(token!==TOKEN)throw Error("INVALID_TOKEN");
   access++;return identity;
  }
 };
 const data={
  createOwnerProductVisibilityStore:()=>({
   async readStatus(auth){reads++;
    assert.deepEqual(auth,identity);return loaded;},
   async saveSwitch(input){writes++;
    assert.deepEqual(input.principal,identity);
    return result??{saved:true,version:2,productId:input.productId,
     enabled:input.enabled,partnerCompanyId:input.partnerCompanyId};}
  })
 };
 const api=makeProductVisibilityCallables({
  db:{},FieldValue:{},getAuth:()=>({}),HttpsError,
  enabled:()=>enabled,modules:async()=>[trusted,data]
 });
 return {api,get access(){return access},get reads(){return reads},get writes(){return writes}};
}
test("feature stays disabled by default, with NO Auth or DB reads",async()=>{
 const f=calls({enabled:false});
 await assert.rejects(f.api.load(request()),e=>e.code==="failed-precondition");
 assert.equal(f.access,0);assert.equal(f.reads,0);
});
test("owner read returns only count-only product flags, without financial values",async()=>{
 const f=calls(),v=await f.api.load(request());
 assert.deepEqual(v,status);
 assert.equal(f.access,1);assert.equal(f.reads,1);
});
test("owner save requires exact request and fresh verified Firebase ID token",async()=>{
 const f=calls(),v=await f.api.save(request({
  productId:"nuro",enabled:false,expectedVersion:1,partnerCompanyId:null
 }));
 assert.deepEqual(v,{saved:true,version:2,productId:"nuro",
  enabled:false,partnerCompanyId:null});
 assert.equal(f.writes,1);
});
test("forged UID/email and extra company, price or role fields never reach DB",async()=>{
 const f=calls();
 const requests=[
  request({productId:"nuro",enabled:true,expectedVersion:1,partnerCompanyId:null,price:10000}),
  request({productId:"nuro",enabled:true,expectedVersion:1,partnerCompanyId:null,role:"owner"}),
  request({productId:"nuro",enabled:true,expectedVersion:1}),
  request({productId:"nuro",enabled:"true",expectedVersion:1,partnerCompanyId:null}),
  request({}, {auth:{uid:"fake",token:{email:"owner@example.test",email_verified:true}}}),
  request({}, {auth:{uid:"owner",token:{email:"fake@example.test",email_verified:true}}}),
  request({}, {rawRequest:{headers:{authorization:"Bearer fake"}}})
 ];
 for(const req of requests)
  await assert.rejects(
   (req.data&&Object.keys(req.data).length?f.api.save(req):f.api.load(req)),
   e=>["unauthenticated","invalid-argument","permission-denied"].includes(e.code));
 assert.equal(f.writes,0);
});
test("unexpected money value in store response blocks before the network return",async()=>{
 const f=calls({loaded:{...status,
  products:[{...status.products[0],revenue:50000}]}});
 await assert.rejects(f.api.load(request()),e=>e.code==="permission-denied");
});
