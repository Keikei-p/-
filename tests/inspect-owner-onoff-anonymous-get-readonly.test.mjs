import test from "node:test";
import assert from "node:assert/strict";
import {
 OWNER_VISIBILITY_GET_URL,classifyOwnerOnOffAnonymousRead,
 inspectOwnerOnOffAnonymousLiveGet
} from "../tools/production/inspect-owner-onoff-anonymous-get-readonly.mjs";

function fake({status=400,data={error:{status:"FAILED_PRECONDITION",
  message:"owner_product_settings_disabled"}}}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  return {status,text:async()=>JSON.stringify(data)};
 };
 return {fetchImpl,calls};
}
test("the ONLY live diagnostic is the anonymous GET callable with no identity and no SET write",async()=>{
 const f=fake(),r=await inspectOwnerOnOffAnonymousLiveGet({fetchImpl:f.fetchImpl});
 assert.deepEqual(r,{classification:"SERVER_FEATURE_FLAG_OFF",httpStatus:400});
 assert.equal(f.calls.length,1);
 const [{url,opts}]=f.calls;
 assert.equal(url,OWNER_VISIBILITY_GET_URL);
 assert.match(url,/\/getOwnerProductVisibility$/);
 assert.doesNotMatch(url,/setOwnerProductVisibility/);
 assert.equal(opts.method,"POST");
 assert.deepEqual(JSON.parse(opts.body),{data:{}});
 assert.equal(opts.headers["Content-Type"],"application/json");
 assert.equal(opts.redirect,"error");
 assert(!JSON.stringify(f.calls).includes("Authorization"));
});
test("an unauthenticated response is NOT mistaken for Owner write success",async()=>{
 const f=fake({status:401,data:{error:{status:"UNAUTHENTICATED",
  message:"owner_product_login_required"}}});
 const r=await inspectOwnerOnOffAnonymousLiveGet({fetchImpl:f.fetchImpl});
 assert.equal(r.classification,"AUTHENTICATION_REQUIRED_NOT_WRITE_VERIFIED");
 assert.notEqual(r.classification,"OWNER_SWITCH_LIVE_VERIFIED");
});
test("a network/proxy response or changed server error text is unknown, not approval",async()=>{
 for(const [status,data] of [
  [404,{}],
  [500,{error:{status:"INTERNAL",message:"unexpected"}}],
  [400,{error:{status:"FAILED_PRECONDITION",message:"different"}}],
  [401,{error:{status:"UNAUTHENTICATED",message:"different"}}]
 ]){
  const f=fake({status,data});
  const r=await inspectOwnerOnOffAnonymousLiveGet({fetchImpl:f.fetchImpl});
  assert.equal(r.classification,"UNKNOWN");
 }
});
test("server must refuse a call without an authenticated Owner",async()=>{
 const f=fake({status:200,data:{result:{products:[]}}});
 await assert.rejects(inspectOwnerOnOffAnonymousLiveGet({fetchImpl:f.fetchImpl}),
  /ANONYMOUS_GET_DID_NOT_REFUSE/);
});
test("oversized remote payload, invalid timeout and response shape are rejected",async()=>{
 await assert.rejects(inspectOwnerOnOffAnonymousLiveGet({timeoutMs:0}),
  /OWNER_ONOFF_PUBLIC_STATE_INPUT/);
 await assert.rejects(inspectOwnerOnOffAnonymousLiveGet({
  fetchImpl:async()=>({status:400,text:async()=> "x".repeat(5000)})
 }),/UNEXPECTED_RESPONSE_SIZE/);
 await assert.rejects(inspectOwnerOnOffAnonymousLiveGet({
  fetchImpl:async()=>({status:0,text:async()=>""})
 }),/RESPONSE/);
});
test("read-only evaluator never asserts an active feature from anonymous errors",()=>{
 const variants=[
  classifyOwnerOnOffAnonymousRead({httpStatus:403,
   error:{status:"PERMISSION_DENIED",message:"owner_product_not_authorized"}}),
  classifyOwnerOnOffAnonymousRead({httpStatus:400,
   error:{status:"FAILED_PRECONDITION",message:"owner_product_settings_disabled"}}),
  classifyOwnerOnOffAnonymousRead({httpStatus:401,
   error:{status:"UNAUTHENTICATED",message:"owner_product_login_required"}})
 ];
 assert(variants.every(v=>v.classification!=="PRODUCTION_RELEASE_APPROVED"));
 assert(variants.every(v=>v.classification!=="FINANCE_ISOLATION_VERIFIED"));
});
