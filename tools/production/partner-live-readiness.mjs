#!/usr/bin/env node
/**
 * Public readiness probe. Only GET/unauthenticated HEAD/POST denied tests.
 * Never obtains credentials, sends real user data, signs in, writes Firestore,
 * changes Hosting/Cloudflare, or attempts a production release.
 */
const urls={
  invite:"https://nico-factory.web.app/partner-invite.html",
  home:"https://nico-factory.web.app/",
  partnerForm:"https://nico-factory.web.app/partner-counts-v2.html",
  workerHealth:"https://sales-finance-gateway.jyhokei0124.workers.dev/health",
  workerCatalog:"https://sales-finance-gateway.jyhokei0124.workers.dev/v1/partner-count-catalog",
  inviteCallable:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/createPartnerCompanyInvitation"
};
const allowed=new Set(Object.values(urls).map(u=>new URL(u).origin));
function clean(status){return Number.isInteger(status)?status:0;}
export async function probe(fetcher=fetch,timeoutMs=12000){
 const findings={};
 for(const [name,link] of Object.entries(urls)){
  const url=new URL(link);
  if(url.protocol!=="https:"||!allowed.has(url.origin))throw Error("disallowed_destination");
  const ctrl=new AbortController();
  const time=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
   const isCallable=name==="inviteCallable";
   // Callable POST contains an invalid/anonymous empty payload. It MUST fail.
   const result=await fetcher(link,{
    method:isCallable?"POST":"GET",
    redirect:"error",signal:ctrl.signal,
    headers:isCallable?{"Content-Type":"application/json"}:{Accept:"text/html,application/json"},
    ...(isCallable?{body:JSON.stringify({data:{}})}:{})
   });
   // No content ever logged; only status and expected page/closed service state.
   findings[name]={status:clean(result.status),reachable:true};
  }catch(error){
   findings[name]={status:0,reachable:false,errorCode:
    error?.name==="AbortError"?"TIMEOUT":"NETWORK_UNAVAILABLE"};
  }finally{clearTimeout(time);}
 }
 const inviteReady=findings.home.status===200&&findings.invite.status===200;
 const partnerUiReady=findings.partnerForm.status===200;
 const countBackendReady=findings.workerHealth.status===200;
 const unauthenticatedApiSafe=[401,403,404,503].includes(findings.workerCatalog.status);
 const inviteAuthSafe=[401,403].includes(findings.inviteCallable.status);
 // Healthy homepage and invite do NOT imply count registration is enabled.
 return {project:"sales-management-cc116",canonicalHost:"nico-factory.web.app",
  inviteReady,partnerUiReady,countBackendReady,unauthenticatedApiSafe,
  inviteAuthSafe,productionCountReleaseApproved:false,
  findings};
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 const x=await probe();
 console.log(JSON.stringify(x,null,2));
 // Fail on missing live security refusal or web availability, not on a count
 // UI intentionally withheld. This is a read-only audit, not a release gate.
 if(!x.inviteReady||!x.inviteAuthSafe||
    (x.findings.workerCatalog.reachable&&!x.unauthenticatedApiSafe))
   process.exitCode=1;
}
