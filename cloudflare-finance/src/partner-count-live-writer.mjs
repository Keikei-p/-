/**
 * Cloudflare runtime composition for the already-tested partner count ledger.
 * Default OFF. No writes to records/products/recordCorrections/revenueGoals,
 * no delete, no credential in browser, no legacy URL support.
 */
import {createFirebaseIdTokenVerifier}
 from "../../security/firebase-id-token-verifier.mjs";
import {createStagedPartnerCountWriteGateway}
 from "../../security/staged-partner-count-write-gateway.mjs";
import {auditNoFinancialKeys}
 from "../../security/public-projection.mjs";
import {makePublicCountRestAdapters}
 from "./public-count-live-adapter.mjs";
import {makePartnerCountRestDb}
 from "./partner-count-rest-db.mjs";
import {readOwnPartnerCountDay}
 from "../../partner/count-only-ledger.mjs";
import {makePartnerCountAdminStore}
 from "../../partner/firestore-admin-count-store.mjs";
import {createTrustedMembershipLoader}
 from "../../security/trusted-membership-loader.mjs";

const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const deny=()=>{throw Error("partner_catalog_unavailable");};
function validateCatalogRow(data,id){
 if(!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).sort().join(",")!==
      ["catalogId","ownerCompanyId","active","visibility"].sort().join(",")||
    data.catalogId!==id||typeof data.ownerCompanyId!=="string"||
    !ID.test(data.ownerCompanyId)||typeof data.active!=="boolean"||
    !["shared_counts","private"].includes(data.visibility))deny();
 auditNoFinancialKeys(data);
 return {catalogId:id,ownerCompanyId:data.ownerCompanyId,
   active:data.active,visibility:data.visibility};
}
export function createPartnerCountRestWriteHandler({
 enabled=false,projectId="sales-management-cc116",fetcher=fetch,
 getServiceToken,subtle=globalThis.crypto?.subtle,nowSeconds,
 mintRecordId=()=>("pc_"+crypto.randomUUID().replaceAll("-","")),
 mintCorrectionId=()=>("pcfix_"+crypto.randomUUID().replaceAll("-",""))
}={}){
 if(enabled!==true)return createStagedPartnerCountWriteGateway({enabled:false});
 if(typeof getServiceToken!=="function")deny();
 const db=makePartnerCountRestDb({projectId,getServiceToken,fetcher});
 const auth=makePublicCountRestAdapters({projectId,getServiceToken,fetcher});
 const authenticateBearer=createFirebaseIdTokenVerifier({
  projectId,fetchKeys:fetcher,subtle,nowSeconds
 });
 return createStagedPartnerCountWriteGateway({
  enabled:true,db,authenticateBearer,
  loadAuthUser:auth.loadAuthUser,mintRecordId,mintCorrectionId,
  loadCountCatalog:async (tx,scope,request)=>{
   // Exactly referenced, explicitly published, money-free catalog documents
   // read at the same transaction as membership and count writes. Browsers
   // cannot choose a Firestore collection or request the raw product master.
   if(!scope||!ID.test(scope.companyId)||!ID.test(scope.hubCompanyId)||
      !request||!Array.isArray(request.lines)||
      request.lines.length>50||
      (request.status==="submitted"&&request.lines.length===0)||
      (request.status==="no_result"&&request.lines.length!==0))deny();
   const ids=request.lines.map(x=>x?.catalogId);
   if(ids.some(x=>typeof x!=="string"||!ID.test(x))||
      new Set(ids).size!==ids.length)deny();
   const output=[];
   for(const id of ids){
    const snap=await tx.getTrustedDocument("partnerCountCatalog/"+id);
    if(!snap.exists)deny();
    output.push(validateCatalogRow(snap.data(),id));
   }
   return output;
  }
 });
}

/**
 * Resolve only the CURRENT daily report of the cryptographically signed
 * caller. No caller-chosen UID/company or cross-team scans.
 */
export function createPartnerOwnDayRestHandler({
 enabled=false,projectId="sales-management-cc116",
 fetcher=fetch,getServiceToken,subtle=globalThis.crypto?.subtle,nowSeconds
}={}){
 const response=(status,value,origin)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json; charset=utf-8",
   "Cache-Control":"no-store","Vary":"Origin",
   ...(origin==="https://nico-factory.web.app"?
     {"Access-Control-Allow-Origin":origin}:{})}
 });
 if(enabled!==true)return async()=>response(503,{error:"service_disabled"},"");
 if(typeof getServiceToken!=="function")deny();
 const db=makePartnerCountRestDb({projectId,getServiceToken,fetcher});
 const store=makePartnerCountAdminStore(db);
 const api=makePublicCountRestAdapters({projectId,getServiceToken,fetcher});
 const verify=createFirebaseIdTokenVerifier({
  projectId,fetchKeys:fetcher,subtle,nowSeconds
 });
 return async request=>{
  const origin=request?.headers?.get?.("origin")??"";
  try{
   const url=new URL(request.url);
   if(origin!=="https://nico-factory.web.app"||
      url.pathname!=="/v1/partner-own-day"||
      url.protocol!=="https:"||request.method!=="GET"||
      [...url.searchParams.keys()].sort().join(",")!=="date,teamId"||
      !ID.test(url.searchParams.get("teamId")||""))
      return response(403,{error:"request_blocked"},origin);
   const token=request.headers.get("authorization")?.match(
     /^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1];
   if(!token)return response(401,{error:"unauthorized"},origin);
   const date=url.searchParams.get("date");
   const teamId=url.searchParams.get("teamId");
   const result=await readOwnPartnerCountDay({
    store,date,teamId,
    loadTrustedReader:async tx=>{
     const verified=await verify(token);
     const loader=createTrustedMembershipLoader({
      loadAuthUser:api.loadAuthUser,
      readDocument:async path=>{
       const snap=await tx.getTrustedDocument(path);
       return snap.exists?snap.data():null;
      }
     });
     const scope=await loader(verified.uid,verified);
     const company=await tx.getTrustedDocument("companies/"+scope.companyId);
     if(!company.exists||company.data().companyKind!=="partner")deny();
     return {serverVerified:true,tokenVerified:true,
      companyKind:"partner",companyId:scope.companyId,
      uid:scope.uid,teamIds:scope.teamIds};
    }
   });
   return response(200,result,origin);
  }catch{
   return response(403,{error:"request_blocked"},origin);
  }
 };
}
