#!/usr/bin/env node
/**
 * PUBLIC READ-ONLY production status for the existing canonical NICO site.
 * No credentials, authentication, Firestore requests, Cloudflare writes, or
 * deploys. Results are only status codes / page marker booleans.
 *
 * Public GET/anonymous empty callable checks are not evidence that an actual
 * member can sign in, see historical revenue, or save a production record.
 */
const BASE="https://nico-factory.web.app";
const WORKER="https://sales-finance-gateway.jyhokei0124.workers.dev";
const CALLABLE="https://asia-northeast1-sales-management-cc116.cloudfunctions.net/";
const PAGES=Object.freeze({
 home:{url:BASE+"/",marker:"営業実績管理"},
 partnerInvite:{url:BASE+"/partner-invite.html",marker:"createPartnerCompanyInvitation"},
 partnerCounts:{url:BASE+"/partner-counts.html",marker:"getPartnerQuickCounts"},
 partnerWorkspace:{url:BASE+"/partner-workspace.html",marker:"submitPartnerWorkspaceCounts"}
});
const FUNCTIONS=Object.freeze([
 "createPartnerCompanyInvitation","previewPartnerCompanyInvitation","acceptPartnerCompanyInvitation",
 "getPartnerQuickCounts","submitPartnerQuickCounts",
 "getPartnerWorkspace","managePartnerWorkspace",
 "acceptPartnerWorkspaceInvite","submitPartnerWorkspaceCounts"
]);
const safeStatuses=new Set([401,403]);
const OFF_STATUSES=new Set([401,403,503]);
function result(status,verified=false){
 return Object.freeze({status:Number.isInteger(status)?status:0,verified});
}
async function read(fetcher,url,options,timeoutMs){
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
 try{
  const resp=await fetcher(url,{...options,redirect:"error",signal:ctrl.signal});
  return resp;
 }finally{clearTimeout(timer);}
}
function routeOK(url){
 const valid=new Set([new URL(BASE).origin,new URL(WORKER).origin,
  new URL(CALLABLE).origin]);
 return new URL(url).protocol==="https:"&&valid.has(new URL(url).origin);
}
export async function checkNicoLivePublic({fetcher=fetch,timeoutMs=12000}={}){
 if(typeof fetcher!=="function"||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)
  throw Error("invalid_audit_dependencies");
 const pages={},apis={};
 for(const [name,info] of Object.entries(PAGES)){
  if(!routeOK(info.url))throw Error("disallowed_public_route");
  try{
   const r=await read(fetcher,info.url,{method:"GET",headers:{Accept:"text/html"}},timeoutMs);
   const body=r.status===200?await r.text():"";
   // A SPA fallback can return HTTP 200 for an absent route.
   pages[name]=result(r.status,r.status===200&&body.includes(info.marker));
   if(name==="home")pages.inviteTabPresent=body.includes("partnerInviteInline");
  }catch{
   pages[name]=result(0,false);
   if(name==="home")pages.inviteTabPresent=false;
  }
 }
 for(const name of FUNCTIONS){
  const url=CALLABLE+name;
  if(!routeOK(url))throw Error("disallowed_callable_route");
  try{
   const r=await read(fetcher,url,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({data:{}})
   },timeoutMs);
   apis[name]=result(r.status,safeStatuses.has(r.status));
  }catch{apis[name]=result(0,false);}
 }
 const svc={};
 for(const [name,path,ok] of [
   ["workerHealth","/health",new Set([200])],
   ["workerPartnerCatalog","/v1/partner-count-catalog",OFF_STATUSES],
   ["workerPersonalRank","/v1/internal-ranks?month=2026-10",OFF_STATUSES]
 ]){
  try{
   const url=WORKER+path;
   if(!routeOK(url))throw Error("disallowed_gateway_route");
   const r=await read(fetcher,url,{method:"GET"},timeoutMs);
   svc[name]=result(r.status,ok.has(r.status));
  }catch{svc[name]=result(0,false);}
 }
 const publicPagesReady=Object.values(PAGES).every((info,i)=>
  pages[Object.keys(PAGES)[i]]?.verified===true);
 const callableAnonymousProtected=FUNCTIONS.every(name=>apis[name].verified);
 const gatewayAnonymousProtected=svc.workerPartnerCatalog.verified&&svc.workerPersonalRank.verified;
 const report={
  project:"sales-management-cc116",site:BASE,
  publicPagesReady,inviteTabPresent:pages.inviteTabPresent===true,
  callableAnonymousProtected,gatewayAnonymousProtected,
  gatewayReachable:svc.workerHealth.verified===true,
  // These cannot be inferred from anonymous public HTML/HTTP.
  ownerRevenueLoginVerified:false,partnerLoginAndCountSaveVerified:false,
  liveFinanceRulesVerified:false,backupRestoreVerified:false,
  fullProductionCutoverApproved:false,
  pages,apis,gateway:svc
 };
 return Object.freeze(report);
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 const report=await checkNicoLivePublic();
 console.log(JSON.stringify(report,null,2));
 // This audit is deliberately a failing *readiness gate*, not a deploy hook.
 // A failing status never causes a write or rollback.
 if(!report.publicPagesReady||!report.inviteTabPresent||
    !report.callableAnonymousProtected||!report.gatewayAnonymousProtected)
  process.exitCode=1;
}
