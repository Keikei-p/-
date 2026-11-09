import test from "node:test";
import assert from "node:assert/strict";
import {classifyJointRankingHttp,inspectJointRankingLive}
 from "../tools/production/inspect-joint-ranking-live-readonly.mjs";

test("anonymous 200 JSON is a SECURITY BLOCK, HTML is not an API success",()=>{
 assert.equal(classifyJointRankingHttp(200,"application/json"),
  "UNAUTHENTICATED_200_SECURITY_BLOCK");
 assert.equal(classifyJointRankingHttp(200,"text/html; charset=utf-8"),
  "HTTP_200_NOT_JSON_ROUTE_MISSING");
});
test("disabled, not deployed, real-account-required are all NO-GO, never proven safe",()=>{
 assert.equal(classifyJointRankingHttp(503,"application/json"),
  "DISABLED_OR_UNAVAILABLE_NO_GO");
 assert.equal(classifyJointRankingHttp(404,"text/html"),
  "NOT_FOUND_OR_UNREWRITTEN_ROUTE");
 assert.equal(classifyJointRankingHttp(401,"application/json"),
  "AUTH_REQUIRED_NOT_REAL_USER_PROOF");
 assert.equal(classifyJointRankingHttp(403,"text/html"),
  "ACCESS_DENIED_OR_IAM_BLOCK");
 assert.equal(classifyJointRankingHttp(302,"text/html"),
  "REDIRECT_UNEXPECTED");
});
test("two canonical GETs only, no Auth token, redirects, writes, response payload reads",async()=>{
 const calls=[],headers=new Headers({"content-type":"application/json"});
 const result=await inspectJointRankingLive({fetchFn:async(url,opts)=>{
  calls.push({url,opts});return {status:503,headers,
   text(){throw Error("RESPONSE_BODY_MUST_NOT_BE_READ")},
   json(){throw Error("RESPONSE_BODY_MUST_NOT_BE_PARSED")}
  };
 }});
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,
  "https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking?month=2026-11");
 assert.equal(calls[1].url,
  "https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11");
 for(const {opts} of calls){
  assert.equal(opts.method,"GET");
  assert.equal(opts.redirect,"manual");
  assert.equal(opts.headers.Accept,"application/json");
  assert(!JSON.stringify(opts.headers).includes("Authorization"));
  assert(!JSON.stringify(opts.headers).includes("Cookie"));
 }
 assert.equal(result.project,"sales-management-cc116");
 assert.equal(result.inspection,"ANONYMOUS_GET_ONLY");
 assert.equal(result.functionsDeployedByThisCheck,false);
 assert.equal(result.documentsWrittenByThisCheck,false);
 assert.equal(result.rulesChangedByThisCheck,false);
 assert.equal(result.realAccountAuthorizationVerified,false);
 assert.equal(result.liveReleaseGo,false);
 assert.deepEqual(result.targets.map(x=>x.status),[503,503]);
});
test("network failure never invents availability or readiness",async()=>{
 const result=await inspectJointRankingLive({fetchFn:async()=>{
  throw Error("private endpoint/network diagnostic");
 }});
 assert.equal(result.liveReleaseGo,false);
 assert.deepEqual(result.targets.map(x=>x.verdict),[
  "NETWORK_UNAVAILABLE_NOT_PROOF","NETWORK_UNAVAILABLE_NOT_PROOF"
 ]);
 assert(!JSON.stringify(result).includes("private endpoint"));
});
test("disabled-by-default direct Function and unrewritten Hosting remain clearly distinct",async()=>{
 let calls=0;
 const result=await inspectJointRankingLive({fetchFn:async()=>{
  calls++;
  return {status:calls===1?503:200,headers:new Headers({
   "content-type":calls===1?"application/json":"text/html"
  })};
 }});
 assert.deepEqual(result.targets.map(x=>x.verdict),[
  "DISABLED_OR_UNAVAILABLE_NO_GO",
  "HTTP_200_NOT_JSON_ROUTE_MISSING"
 ]);
 assert.equal(result.liveReleaseGo,false);
});
