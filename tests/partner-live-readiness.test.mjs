import test from "node:test";
import assert from "node:assert/strict";
import {probe} from "../tools/production/partner-live-readiness.mjs";

const fake=(overrides={})=>{
 const seen=[];
 const fetcher=async(url,opts)=>{
  seen.push({url,opts});
  const name=url.includes("cloudfunctions.net/")?url.split("/").at(-1):
    url.includes("/v1/partner-count-catalog")?"catalog":
    url.includes("/health")?"health":
    new URL(url).pathname;
  const callable=url.includes("cloudfunctions.net/");
  const status=overrides[name]??(callable?401:name==="catalog"?403:
    name==="/partner-counts-v2.html"?404:200);
  return {status,ok:status>=200&&status<300,
   text:async()=>name==="/partner-workspace.html"?
    (overrides.workspaceHtml??'<form id="companyCodeLoginForm"></form><form id="companyCodeIssueForm"></form><form id="companyCodeActivateForm"></form>'):""};
 };
 return {fetcher,seen};
};

test("real count and workspace pages must both exist; legacy v2 does not gate readiness",async()=>{
 const x=fake(), r=await probe(x.fetcher);
 assert.equal(r.inviteReady,true);
 assert.equal(r.partnerUiReady,true);
 assert.equal(r.legacyPartnerPageStatus,404);
 assert.equal(r.allCallablesAvailableAndClosed,true);
 assert.equal(r.productionCountReleaseApproved,false);
 assert.equal(r.authenticatedEndToEndVerified,false);
 const routes=x.seen.map(v=>new URL(v.url).pathname);
 assert(routes.includes("/partner-counts.html"));
 assert(routes.includes("/partner-workspace.html"));
 assert(routes.includes("/partner-invite.html"));
 const absent=fake({"/partner-workspace.html":404});
 assert.equal((await probe(absent.fetcher)).partnerUiReady,false);
});
test("all seven live callables must reject anonymous calls, absent endpoints are not pass",async()=>{
 const x=fake();
 const r=await probe(x.fetcher);
 assert.equal(Object.keys(r.callableAnonymousRefusal).length,7);
 assert.equal(r.allCallablesAvailableAndClosed,true);
 const failed=fake({submitPartnerWorkspaceCounts:404});
 const result=await probe(failed.fetcher);
 assert.equal(result.allCallablesAvailableAndClosed,false);
 assert.equal(result.callableAnonymousRefusal.workspaceSave,false);
 const exposed=fake({getPartnerWorkspace:200});
 assert.equal((await probe(exposed.fetcher)).allCallablesAvailableAndClosed,false);
});
test("production probes cannot transmit real identity or mutate any account",async()=>{
 const x=fake();
 await probe(x.fetcher);
 for(const {url,opts} of x.seen){
  assert.equal(opts.redirect,"error");
  assert(["GET","POST"].includes(opts.method));
  if(opts.method==="POST"){
   assert(url.includes(".cloudfunctions.net/"));
   assert.deepEqual(JSON.parse(opts.body),{data:{}});
   assert.equal(opts.headers["Content-Type"],"application/json");
  }
  assert(!url.includes("email="));
  assert(!url.includes("token="));
  assert(!url.includes("uid="));
  assert(!url.includes("password"));
  assert.equal(opts.headers.Authorization,undefined);
 }
});
test("anonymous worker catalog exposure is detected separately",async()=>{
 const x=fake({catalog:200});
 const r=await probe(x.fetcher);
 assert.equal(r.unauthenticatedApiSafe,false);
 assert.equal(r.allCallablesAvailableAndClosed,true);
});

test("live company-code UI and four backend endpoints require positive independent evidence",async()=>{
 const x=fake({codeIssue:401,codeActivate:400,codeLogin:400,codeLogout:401});
 const actual=await probe(x.fetcher);
 assert.equal(actual.companyCodeUiLive,true);
 assert.equal(actual.companyCodeEndpointsRespond,true);
 assert.equal(actual.companyCodePublicSurfaceReady,true);
 assert.equal(actual.companyCodeAuthenticatedRealUserVerified,false);
 assert.deepEqual(Object.keys(actual.codeEndpointStatus),
  ["codeIssue","codeActivate","codeLogin","codeLogout"]);
 const missingApi=await probe(fake({codeLogin:404}).fetcher);
 assert.equal(missingApi.companyCodeEndpointsRespond,false);
 assert.equal(missingApi.companyCodePublicSurfaceReady,false);
 const missingUI=await probe(fake({workspaceHtml:"<h1>legacy workspace</h1>"}).fetcher);
 assert.equal(missingUI.companyCodeUiLive,false);
 assert.equal(missingUI.companyCodePublicSurfaceReady,false);
});
test("even published company-code endpoints never prove login or saved counts by themselves",async()=>{
 const x=fake({"codeIssue":401,"codeActivate":400,"codeLogin":400,"codeLogout":401});
 const result=await probe(x.fetcher);
 assert.equal(result.companyCodePublicSurfaceReady,true);
 assert.equal(result.authenticatedEndToEndVerified,false);
 assert.equal(result.productionCountReleaseApproved,false);
 assert.equal(result.companyCodeAuthenticatedRealUserVerified,false);
 for(const name of ["issuePartnerCompanyCode","activatePartnerCompanyCode",
    "loginPartnerCompanyCode","logoutPartnerCompanyCode"]){
  const item=x.seen.find(p=>p.url.endsWith("/"+name));
  assert(item,"Missing "+name);
  assert.equal(item.opts.method,"POST");
  assert.deepEqual(JSON.parse(item.opts.body),{data:{}});
  assert.equal(item.opts.headers.Authorization,undefined);
 }
});
