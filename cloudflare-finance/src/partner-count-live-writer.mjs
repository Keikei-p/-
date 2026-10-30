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
