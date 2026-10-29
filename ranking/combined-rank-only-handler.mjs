/**
 * NOT DEPLOYED. Authentication, reciprocal company approval, publication
 * completeness and Firestore reads must be supplied by the trusted SERVER.
 * Never make the browser a holder of raw records or approval data.
 */
import {createRankOnlyPublication} from "./rank-only-publication.mjs";
const CANONICAL="https://nico-factory.web.app";
const PATH="/v1/combined-ranks";
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const UID=/^[A-Za-z0-9_:-]{1,128}$/;
class Block extends Error{constructor(status=403){super("blocked");this.status=status;}}
function send(status,payload,origin){
 const headers={"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","Pragma":"no-cache",
  "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
  "Vary":"Origin"};
 if(origin===CANONICAL)headers["Access-Control-Allow-Origin"]=CANONICAL;
 return new Response(JSON.stringify(payload),{status,headers});
}
function contextValid(ctx,uid){
 if(!ctx||ctx.serverVerified!==true||ctx.userActive!==true||
    ctx.memberActive!==true||ctx.companyActive!==true||
    ctx.reciprocalOwnersApproved!==true||ctx.individualNamesApproved!==true||
    ctx.completeSnapshotBudgetApproved!==true||
    ctx.viewerUid!==uid||!UID.test(ctx.hubCompanyId||"")||
    !UID.test(ctx.viewerCompanyId||"")||
    !Array.isArray(ctx.approvedCompanyIds)||
    ctx.approvedCompanyIds.length<1||ctx.approvedCompanyIds.length>30||
    ctx.approvedCompanyIds.some(x=>!UID.test(x))||
    new Set(ctx.approvedCompanyIds).size!==ctx.approvedCompanyIds.length||
    !ctx.approvedCompanyIds.includes(ctx.hubCompanyId)||
    !ctx.approvedCompanyIds.includes(ctx.viewerCompanyId))
  throw new Block();
}
export function createStagedCombinedRankReadHandler({
 enabled=false,verifyFirebaseToken,loadFreshApprovedContext,
 loadCompletePublicCountSources
}={}){
 if(enabled!==true)return async request=>send(503,{error:"service_disabled"},
  request?.headers?.get?.("Origin")??"");
 if(typeof verifyFirebaseToken!=="function"||
    typeof loadFreshApprovedContext!=="function"||
    typeof loadCompletePublicCountSources!=="function")
  throw Error("Combined rank trusted server dependencies missing");
 return async request=>{
  const origin=request?.headers?.get?.("Origin")??"";
  try{
   if(request.method!=="GET")throw new Block(405);
   if(origin&&origin!==CANONICAL)throw new Block();
   const url=new URL(request.url);
   if(url.pathname!==PATH)throw new Block(404);
   const keys=[...url.searchParams.keys()];
   if(keys.length!==1||keys[0]!=="month"||
      !MONTH.test(url.searchParams.get("month")??""))throw new Block(400);
   const header=request.headers.get("Authorization")??"";
   const token=header.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1];
   if(!token)throw new Block(401);
   let auth;
   try{auth=await verifyFirebaseToken(token);}catch{throw new Block(401);}
   if(!auth||!UID.test(auth.uid)||auth.emailVerified!==true)throw new Block(401);
   // Only trusted server callbacks select the linked companies. The HTTP
   // caller cannot pass company IDs, ranks, products or approval booleans.
   const ctx=await loadFreshApprovedContext(auth);
   contextValid(ctx,auth.uid);
   const trusted=await loadCompletePublicCountSources({
    month:url.searchParams.get("month"),context:ctx
   });
   if(!trusted||trusted.hubCompanyId!==ctx.hubCompanyId||
      trusted.period!==url.searchParams.get("month")||
      JSON.stringify(trusted.approvedCompanyIds)!==
        JSON.stringify(ctx.approvedCompanyIds))throw new Block(503);
   const ranking=createRankOnlyPublication(trusted);
   return send(200,ranking,origin);
  }catch(err){
   // Never leak a person/company name, ID, count, monetary value or query.
   const status=err instanceof Block?err.status:503;
   return send(status,{error:"request_blocked"},origin);
  }
 };
}
