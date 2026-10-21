/**
 * Shared browser adapter for BOTH existing sales URLs.
 * Staged only: it is deliberately not imported by production index.html.
 * Must not silently fall back to the insecure legacy Firestore writer.
 */
export const SALES_HOST_ORIGINS=Object.freeze([
  "https://nico-factory.web.app",
  "https://keikei-p.github.io"
]);
export class CountEntryConflict extends Error {
  constructor(){super("Existing daily record changed. Reload before submitting.");this.name="CountEntryConflict";}
}
function acceptableOrigin(origin){return SALES_HOST_ORIGINS.includes(origin);}
function allowedGateway(url){
  try{
    const parsed=new URL(url);
    return parsed.protocol==="https:" && parsed.username==="" && parsed.password==="" &&
      parsed.search==="" && parsed.hash==="" && parsed.origin!=="null";
  }catch{return false;}
}
export function makeCountIntent({uid,date,teamId,workLocation,reportStatus="submitted",
    rows=[],existingRecord=null}){
  if(typeof uid!=="string"||typeof date!=="string"||typeof teamId!=="string")
    throw Error("invalid_selection");
  if(!Array.isArray(rows))throw Error("invalid_rows");
  const entries=rows.filter(row=>Number(row.count)>0).map(row=>{
    const keys=Object.keys(row);
    if(keys.some(k=>!["productId","planId","count"].includes(k)) ||
      !row.productId || !row.planId || !Number.isSafeInteger(Number(row.count)) ||
      Number(row.count)<0)throw Error("invalid_count_row");
    return {productId:String(row.productId),planId:String(row.planId),count:Number(row.count)};
  });
  const total=entries.reduce((acc,x)=>acc+x.count,0);
  if(reportStatus==="submitted"&&total<=0)throw Error("no_sales_count");
  if(reportStatus==="no_result"&&total!==0)throw Error("zero_report_has_count");
  const intent={uid,date,teamId,workLocation:String(workLocation||""),reportStatus,entries};
  if(existingRecord){
    if(!existingRecord.id||!existingRecord.recordVersion)throw Error("missing_server_record_version");
    if(existingRecord.uid!==uid||existingRecord.date!==date)throw Error("record_identity_changed");
    intent.recordId=existingRecord.id;
    intent.expectedRecordUpdateTime=existingRecord.recordVersion;
    const originalEntries=Object.values(existingRecord.results||{});
    // History may contain an old product plan no longer in today's catalog.
    // Do not permit repricing it accidentally; needs manual Owner review.
    if(originalEntries.some(r=>r.count>0 && !r.planId))
      throw Error("historical_plan_not_editable");
  }
  return intent;
}
export async function submitCountIntent({
  gatewayUrl,origin,user,input,fetcher=fetch,explicitCutover=false
}){
  if(!explicitCutover)throw Error("safe_write_not_released");
  if(!acceptableOrigin(origin))throw Error("origin_not_approved");
  if(!allowedGateway(gatewayUrl))throw Error("gateway_url_invalid");
  if(!user||typeof user.getIdToken!=="function")throw Error("not_authenticated");
  const token=await user.getIdToken(true);
  if(!token)throw Error("no_id_token");
  const response=await fetcher(new URL("/v1/count-record",gatewayUrl).toString(),{
    method:"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    cache:"no-store",
    body:JSON.stringify(input)
  });
  if(response.status===409)throw new CountEntryConflict();
  if(!response.ok)throw Error("secure_save_failed_"+response.status);
  const result=await response.json();
  if(result.saved!==true||result.recordId==null)throw Error("unconfirmed_secure_save");
  // Store the draft in the form until the server confirms successful commit.
  return result;
}
export async function getSafeFinancialView({
  gatewayUrl,origin,user,fetcher=fetch,explicitCutover=false
}){
  if(!explicitCutover)throw Error("safe_gateway_not_released");
  if(!acceptableOrigin(origin)||!allowedGateway(gatewayUrl))throw Error("invalid_host");
  if(!user||typeof user.getIdToken!=="function")throw Error("not_authenticated");
  const token=await user.getIdToken(true);
  const response=await fetcher(new URL("/v1/financial-view",gatewayUrl).toString(),{
    method:"GET",headers:{"Authorization":"Bearer "+token},cache:"no-store"
  });
  if(!response.ok)throw Error("secure_read_failed_"+response.status);
  const data=await response.json();
  if(!Array.isArray(data.records)||!Array.isArray(data.products))throw Error("invalid_secure_view");
  return data;
}
