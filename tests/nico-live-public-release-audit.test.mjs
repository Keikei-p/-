import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkNicoLivePublic} from "../tools/production/nico-live-public-release-audit.mjs";
function fake({omitted=null,wrongMarker=null,exposed=null,noTab=false}={}){
 const calls=[];
 const fetcher=async (url,options)=>{
  calls.push({url,options});
  const path=new URL(url).pathname;
  if(url.includes("cloudfunctions.net/")){
   const func=path.split("/").at(-1);
   return new Response("{}",{status:func===exposed?200:401});
  }
  if(url.includes(".workers.dev")){
   return new Response("{}",{status:path==="/health"?200:503});
  }
  if(path===omitted)return new Response("gone",{status:404});
  let body=path==="/"
   ?"営業実績管理 "+(noTab?"":"partnerInviteInline")
   :path==="/partner-invite.html"?"createPartnerCompanyInvitation"
   :path==="/partner-counts.html"?"getPartnerQuickCounts"
   :path==="/partner-workspace.html"?"submitPartnerWorkspaceCounts"
   :"";
  if(path===wrongMarker)body="fallback login page without marker";
  return new Response(body,{status:200,headers:{"Content-Type":"text/html"}});
 };
 return {calls,fetcher};
}
test("static public read-only audit finds pages and denies anonymous finance endpoints",async()=>{
 const client=fake();
 const r=await checkNicoLivePublic({fetcher:client.fetcher});
 assert.equal(r.publicPagesReady,true);
 assert.equal(r.inviteTabPresent,true);
 assert.equal(r.callableAnonymousProtected,true);
 assert.equal(r.gatewayAnonymousProtected,true);
 assert.equal(r.gatewayReachable,true);
 assert.equal(r.fullProductionCutoverApproved,false);
 assert.equal(r.ownerRevenueLoginVerified,false);
 assert.equal(r.partnerLoginAndCountSaveVerified,false);
 assert.equal(r.liveFinanceRulesVerified,false);
 assert.equal(r.backupRestoreVerified,false);
 assert.equal(client.calls.length,4+9+3);
 for(const {url,options} of client.calls){
  assert.ok(url.startsWith("https://nico-factory.web.app/")||
   url.startsWith("https://asia-northeast1-sales-management-cc116.cloudfunctions.net/")||
   url.startsWith("https://sales-finance-gateway.jyhokei0124.workers.dev/"));
  assert.ok(["GET","POST"].includes(options.method));
  if(options.method==="POST")assert.equal(options.body,'{"data":{}}');
  assert.equal(options.redirect,"error");
  assert.equal(options.headers?.Authorization,undefined);
 }
});
test("HTTP 200 for a SPA fallback does not mark partner page deployed",async()=>{
 const r=await checkNicoLivePublic({fetcher:fake({wrongMarker:"/partner-workspace.html"}).fetcher});
 assert.equal(r.pages.partnerWorkspace.status,200);
 assert.equal(r.pages.partnerWorkspace.verified,false);
 assert.equal(r.publicPagesReady,false);
});
test("missing invite/tab or failed anonymous refusal is not production-ready",async()=>{
 const r=await checkNicoLivePublic({fetcher:fake({noTab:true,exposed:"submitPartnerWorkspaceCounts"}).fetcher});
 assert.equal(r.publicPagesReady,true);
 assert.equal(r.inviteTabPresent,false);
 assert.equal(r.callableAnonymousProtected,false);
 assert.equal(r.apis.submitPartnerWorkspaceCounts.status,200);
});
test("uncertain network fails closed without pretending a production page exists",async()=>{
 const r=await checkNicoLivePublic({fetcher:async()=>{throw Error("network");}});
 assert.equal(r.publicPagesReady,false);
 assert.equal(r.callableAnonymousProtected,false);
 assert.equal(r.gatewayReachable,false);
 assert.equal(r.fullProductionCutoverApproved,false);
});
test("live audit code contains no mutation calls or service identity use",()=>{
 const src=readFileSync(new URL("../tools/production/nico-live-public-release-audit.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/FIREBASE_SERVICE_ACCOUNT_JSON|firebase-admin|serviceAccount|Google_APPLICATION_CREDENTIALS|firebase\s+deploy|wrangler\s+deploy|deleteDoc|setDoc|updateDoc/);
});
