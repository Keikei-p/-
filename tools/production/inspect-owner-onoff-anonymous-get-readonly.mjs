/**
 * Read-only diagnostic of the existing Owner visibility GET callable.
 * Never invokes the SET callable. The GET controller checks its feature flag
 * and authentication BEFORE reading Firestore and cannot write any data.
 * No tokens, account IDs, finance fields or secrets are supplied or logged.
 *
 * A public anonymous response is NOT proof of Owner write permissions, live
 * company catalog/identity or the absence of partner finance exposure.
 */
export const OWNER_VISIBILITY_GET_URL=
 "https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getOwnerProductVisibility";
const STOP=code=>{throw Error("OWNER_ONOFF_PUBLIC_STATE_"+code);};

export function classifyOwnerOnOffAnonymousRead({httpStatus,error}={}){
 if(!Number.isSafeInteger(httpStatus)||httpStatus<100||httpStatus>599)
  STOP("BAD_HTTP_STATUS");
 if(!error||typeof error!=="object"||Array.isArray(error))
  return Object.freeze({classification:"UNKNOWN",httpStatus});
 const status=error.status,message=error.message;
 if(status==="FAILED_PRECONDITION"&&
    message==="owner_product_settings_disabled"&&httpStatus>=400)
   return Object.freeze({
    classification:"SERVER_FEATURE_FLAG_OFF",httpStatus
   });
 if(status==="UNAUTHENTICATED"&&
    message==="owner_product_login_required"&&httpStatus>=400)
   return Object.freeze({
    classification:"AUTHENTICATION_REQUIRED_NOT_WRITE_VERIFIED",httpStatus
   });
 return Object.freeze({classification:"UNKNOWN",httpStatus});
}

export async function inspectOwnerOnOffAnonymousLiveGet({
 fetchImpl=fetch,timeoutMs=10000
}={}){
 if(typeof fetchImpl!=="function"||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
  STOP("INPUT");
 const response=await fetchImpl(OWNER_VISIBILITY_GET_URL,{
  method:"POST",redirect:"error",
  headers:{"Content-Type":"application/json"},
  body:'{"data":{}}',signal:AbortSignal.timeout(timeoutMs)
 });
 if(!response||!Number.isSafeInteger(response.status)||
    response.status<100||response.status>599||
    typeof response.text!=="function")STOP("RESPONSE");
 // A valid callable error cannot be a success for an anonymous request.
 const raw=await response.text();
 if(raw.length>4096)STOP("UNEXPECTED_RESPONSE_SIZE");
 let parsed;try{parsed=JSON.parse(raw)}catch{
  return Object.freeze({classification:"UNKNOWN",httpStatus:response.status});
 }
 if(response.status<400)STOP("ANONYMOUS_GET_DID_NOT_REFUSE");
 return classifyOwnerOnOffAnonymousRead({
  httpStatus:response.status,error:parsed?.error
 });
}
