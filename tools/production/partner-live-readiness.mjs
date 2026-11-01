#!/usr/bin/env node
/**
 * Public readiness probe. Only GET/unauthenticated HEAD/POST denied tests.
 * Never obtains credentials, sends real user data, signs in, writes Firestore,
 * changes Hosting/Cloudflare, or attempts a production release.
 */
const urls={
  invite:"https://nico-factory.web.app/partner-invite.html",
  home:"https://nico-factory.web.app/",
  partnerForm:"https://nico-factory.web.app/partner-counts.html",
  workspace:"https://nico-factory.web.app/partner-workspace.html",
  legacyPartnerForm:"https://nico-factory.web.app/partner-counts-v2.html",
  workspaceView:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getPartnerWorkspace",
  workspaceManage:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/managePartnerWorkspace",
  workspaceSave:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/submitPartnerWorkspaceCounts",
  workspaceAccept:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/acceptPartnerWorkspaceInvite",
  invitePreview:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/previewPartnerCompanyInvitation",
  inviteAccept:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/acceptPartnerCompanyInvitation",
  workerHealth:"https://sales-finance-gateway.jyhokei0124.workers.dev/health",
  workerCatalog:"https://sales-finance-gateway.jyhokei0124.workers.dev/v1/partner-count-catalog",
  inviteCallable:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/createPartnerCompanyInvitation",
  codeIssue:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/issuePartnerCompanyCode",
  codeActivate:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/activatePartnerCompanyCode",
  codeLogin:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/loginPartnerCompanyCode",
  codeLogout:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/logoutPartnerCompanyCode"
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
   const isCallable=["inviteCallable","invitePreview","inviteAccept",
    "workspaceView","workspaceManage","workspaceSave","workspaceAccept",
    "codeIssue","codeActivate","codeLogin","codeLogout"].includes(name);
   // Anonymous empty callable request MUST fail. Never include user identity.
   // No authenticated changes, no database updates, no secrets, no invites.
   const result=await fetcher(link,{
    method:isCallable?"POST":"GET",
    redirect:"error",signal:ctrl.signal,
    headers:isCallable?{"Content-Type":"application/json"}:{Accept:"text/html,application/json"},
    ...(isCallable?{body:JSON.stringify({data:{}})}:{})
   });
   // No content ever logged; only status and expected page/closed service state.
   findings[name]={status:clean(result.status),reachable:true};
   if(name==="workspace"&&result.status===200){
    // Public HTML source only. Do not log the response or any credentials.
    const html=await result.text();
    findings[name].companyCodeUiPresent=typeof html==="string"&&
      html.includes('id="companyCodeLoginForm"')&&
      html.includes('id="companyCodeIssueForm"')&&
      html.includes('id="companyCodeActivateForm"');
   }
  }catch(error){
   findings[name]={status:0,reachable:false,errorCode:
    error?.name==="AbortError"?"TIMEOUT":"NETWORK_UNAVAILABLE"};
  }finally{clearTimeout(time);}
 }
 const inviteReady=findings.home.status===200&&findings.invite.status===200;
 const partnerUiReady=findings.partnerForm.status===200&&findings.workspace.status===200;
 const countBackendReady=findings.workerHealth.status===200;
 const unauthenticatedApiSafe=[401,403,404,503].includes(findings.workerCatalog.status);
 const inviteAuthSafe=[401,403].includes(findings.inviteCallable.status);
 const callableNames=["inviteCallable","invitePreview","inviteAccept",
   "workspaceView","workspaceManage","workspaceSave","workspaceAccept"];
 const callableAnonymousRefusal=Object.fromEntries(callableNames.map(name=>
   [name,[401,403].includes(findings[name].status)]));
 const allCallablesAvailableAndClosed=Object.values(callableAnonymousRefusal).every(Boolean);
 // Distinguish a missing endpoint (404) from an intentionally rejected empty
 // request. Login and activation can return 400 before authentication because
 // a company code is required; neither value proves a successful login.
 const codeEndpointStatus=Object.fromEntries(["codeIssue","codeActivate","codeLogin","codeLogout"].map(name=>
   [name,findings[name]?.status||0]));
 const companyCodeEndpointsRespond=Object.values(codeEndpointStatus)
   .every(status=>[400,401,403].includes(status));
 const companyCodeUiLive=findings.workspace?.companyCodeUiPresent===true;
 const companyCodePublicSurfaceReady=companyCodeUiLive&&companyCodeEndpointsRespond;
 // This does not prove authenticated partner registration, permissions or finance safety.
 return {project:"sales-management-cc116",canonicalHost:"nico-factory.web.app",
  inviteReady,partnerUiReady,countBackendReady,unauthenticatedApiSafe,
  inviteAuthSafe,allCallablesAvailableAndClosed,callableAnonymousRefusal,
  legacyPartnerPageStatus:findings.legacyPartnerForm.status,
  companyCodeUiLive,companyCodeEndpointsRespond,companyCodePublicSurfaceReady,
  codeEndpointStatus,
  companyCodeAuthenticatedRealUserVerified:false,
  productionCountReleaseApproved:false,
  authenticatedEndToEndVerified:false,
  findings};
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 const x=await probe();
 console.log(JSON.stringify(x,null,2));
 // Fail on missing live security refusal or web availability, not on a count
 // UI intentionally withheld. This is a read-only audit, not a release gate.
 if(!x.inviteReady||!x.partnerUiReady||!x.inviteAuthSafe||
    !x.allCallablesAvailableAndClosed||
    (x.findings.workerCatalog.reachable&&!x.unauthenticatedApiSafe))
   process.exitCode=1;
}
