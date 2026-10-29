/**
 * STAGING ONLY / DEFAULT OFF.
 * Server-side composition for partner count create/correction.
 *
 * This is NOT a Cloud Function endpoint and never initializes Firebase,
 * publishes a URL, reads finance, deletes history or changes Security Rules.
 * Actual deployment requires a separately reviewed trusted backend.
 */
import {
  stageNewPartnerCount,stageCorrectPartnerCount
} from "../partner/count-only-ledger.mjs";
import {makePartnerCountAdminStore}
 from "../partner/firestore-admin-count-store.mjs";
import {createTrustedPartnerWriteContext}
 from "./trusted-partner-write-context.mjs";

const deny=()=>{throw Error("partner_count_write_denied");};
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const RETRY=/^[A-Za-z0-9_-]{16,96}$/;
const allowed=(value,keys)=>{
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join(",")!==keys.sort().join(","))deny();
 return value;
};
const validId=value=>typeof value==="string"&&ID.test(value);
const response=(status,body)=>new Response(JSON.stringify(body),{
 status,headers:{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
});
const no=()=>response(403,{error:"request_blocked"});
const unavailable=()=>response(503,{error:"service_unavailable"});
/**
 * All privileged capabilities come from the HOST SERVER, never HTTP request
 * parameters. db must be a server-owned Admin Firestore instance.
 * loadCountCatalog MUST read only nonfinancial catalog entries at the same
 * tx snapshot and verify every shared hub/custom-product mapping.
 */
export function createStagedPartnerCountWriteGateway({
 enabled=false,db,authenticateBearer,loadAuthUser,
 loadCountCatalog,mintRecordId,mintCorrectionId
}={}){
 if(enabled!==true)return async()=>response(503,{error:"service_disabled"});
 if(!db||typeof authenticateBearer!=="function"||
    typeof loadAuthUser!=="function"||
    typeof loadCountCatalog!=="function"||
    typeof mintRecordId!=="function"||
    typeof mintCorrectionId!=="function")throw Error("Trusted server adapter missing");
 const store=makePartnerCountAdminStore(db);
 return async function handle(request){
  try{
   if(!request||request.method!=="POST"||
      request.headers?.get?.("content-type")?.split(";")[0]?.trim().toLowerCase()
       !=="application/json")return no();
   const authorization=request.headers?.get?.("authorization")||"";
   const token=authorization.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1];
   if(!token)return response(401,{error:"unauthorized"});
   const raw=await request.text();
   if(!raw||raw.length>16384)return no();
   let command;
   try{command=JSON.parse(raw);}catch{return no();}
   const action=command?.action;
   if(action!=="create"&&action!=="correct")return no();
   if(action==="create"){
    allowed(command,["action","request","retryKey"]);
    if(typeof command.retryKey!=="string"||!RETRY.test(command.retryKey))return no();
   }else{
    allowed(command,["action","request","recordId","expectedVersion"]);
    if(!validId(command.recordId)||
      !Number.isSafeInteger(command.expectedVersion)||
      command.expectedVersion<1)return no();
   }
   // The user cannot provide identity, company ID, client record ID on create,
   // correction audit ID, prices or a privileged read/scope callback.
   allowed(command.request,["date","teamId","status","lines"]);
   const loadTrustedContext=createTrustedPartnerWriteContext({
    token,request:command.request,authenticateBearer,loadAuthUser,
    readInTransaction:async (tx,path)=>{
     const snapshot=await tx.getTrustedDocument(path);
     return snapshot.exists?snapshot.data():null;
    },
    loadCountCatalog
   });
   if(action==="create"){
    const result=await stageNewPartnerCount({
     store,loadTrustedContext,request:command.request,
     idempotencyKey:command.retryKey,
     mintRecordId:async()=>{
      const id=await mintRecordId();
      if(!validId(id)||!id.startsWith("pc_"))deny();
      return id;
     }
    });
    return response(200,{
     saved:true,status:result.status,recordId:result.recordId,
     version:result.version,
     ...(result.ownCount===undefined?{}:{ownCount:result.ownCount,
       sharedCount:result.sharedCount})
    });
   }
   const correctionId=await mintCorrectionId();
   if(!validId(correctionId)||!correctionId.startsWith("pcfix_"))return unavailable();
   const result=await stageCorrectPartnerCount({
    store,loadTrustedContext,request:command.request,
    recordId:command.recordId,expectedVersion:command.expectedVersion,
    correctionId
   });
   return response(200,{saved:true,status:result.status,
    recordId:result.recordId,version:result.version,
    ownCount:result.ownCount,sharedCount:result.sharedCount});
  }catch{
   // Do not serialize Firestore errors, JWT data, user/company identifiers,
   // revenue, finance paths or failed authorization reasons.
   return no();
  }
 };
}
