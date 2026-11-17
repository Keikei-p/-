/**
 * Exact existing getPartnerWorkspace callable release guard.
 * Inspects v2 Cloud Functions metadata; never sets credentials, IAM or data.
 * A one-function release must preserve all pre-existing runtime flags.
 */
export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const TARGET="projects/"+PROJECT+"/locations/"+REGION+"/functions/getPartnerWorkspace";
export const FEATURE_FLAGS=Object.freeze([
 "PARTNER_WORKSPACE_ENABLED","PARTNER_COMPANY_CODE_AUTH_ENABLED",
 "NICO_PARTNER_SHARED_RANKING_ENABLED",
 "NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
 "NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED",
 "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED"
]);
// Firebase automatically provides EVENTARC_CLOUD_EVENT_SOURCE for custom
// Cloud Events. It is platform-owned, never a user-set release toggle.
const PLATFORM=new Set(["FIREBASE_CONFIG","GCLOUD_PROJECT","FUNCTION_TARGET",
 "FUNCTION_SIGNATURE_TYPE","FUNCTION_REGION","LOG_EXECUTION_ID",
 "EVENTARC_CLOUD_EVENT_SOURCE"]);
const stop=reason=>{throw Error("STOP_OWNER_GET_ONE_FUNCTION_"+reason);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
// Diagnostic only. Strict release inspection below continues to reject all
// unknown variables. Never print values, source configurations, tokens or UIDs.
export function inspectOwnerGetEnvironmentKeyNames(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>1000)
  stop("KEY_AUDIT_INVENTORY");
 const matches=rows.filter(x=>x?.name===TARGET);
 if(matches.length!==1)stop("KEY_AUDIT_TARGET");
 const target=matches[0];
 if(target.state!=="ACTIVE"||
    target.buildConfig?.runtime!=="nodejs22"||
    target.buildConfig?.entryPoint!=="getPartnerWorkspace"||
    !obj(target.serviceConfig?.environmentVariables)||
    Array.isArray(target.serviceConfig?.secretEnvironmentVariables)&&
    target.serviceConfig.secretEnvironmentVariables.length>0)
  stop("KEY_AUDIT_UNVERIFIED");
 const names=Object.keys(target.serviceConfig.environmentVariables);
 if(names.length>100||names.some(x=>!/^[A-Za-z_][A-Za-z0-9_]{0,95}$/.test(x)))
  stop("KEY_AUDIT_UNTRUSTED_NAME");
 const unknown=names.filter(x=>!FEATURE_FLAGS.includes(x)&&!PLATFORM.has(x)).sort();
 return Object.freeze({
  target:"getPartnerWorkspace",unrecognizedKeyNames:Object.freeze(unknown),
  unrecognizedKeyCount:unknown.length,secretValuesPrinted:false,
  releaseApproved:false,productionWrites:0
 });
}
export function inspectOwnerGetMetadata(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>1000)stop("INVENTORY");
 const result=new Map();
 for(const item of rows){
  if(!obj(item)||typeof item.name!=="string"||
     !item.name.startsWith("projects/"+PROJECT+"/locations/"+REGION+"/functions/")||
     result.has(item.name))stop("FUNCTION_METADATA");
  result.set(item.name,item);
 }
 const original=result.get(TARGET);
 if(!original||original.state!=="ACTIVE"||
    original.buildConfig?.runtime!=="nodejs22"||
    original.buildConfig?.entryPoint!=="getPartnerWorkspace"||
    !String(original.serviceConfig?.uri||"").startsWith("https://"))
  stop("EXISTING_TARGET_NOT_VERIFIED");
 if(!obj(original.serviceConfig?.environmentVariables)||
    Array.isArray(original.serviceConfig?.secretEnvironmentVariables)&&
    original.serviceConfig.secretEnvironmentVariables.length>0)
  stop("TARGET_ENVIRONMENT_UNVERIFIED");
 const existing=original.serviceConfig.environmentVariables;
 for(const key of Object.keys(existing)){
  if(!FEATURE_FLAGS.includes(key)&&!PLATFORM.has(key))
   stop("UNREVIEWED_RUNTIME_VARIABLE");
 }
 for(const key of FEATURE_FLAGS){
  if(Object.hasOwn(existing,key)&&
     !["enabled","disabled"].includes(existing[key]))
   stop("FEATURE_FLAG_FORMAT");
 }
 // Do not prepare an Owner read-only release while other unverified
 // publication/ranking/correction write modes are live.
 for(const key of ["NICO_PARTNER_SHARED_RANKING_ENABLED",
  "NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
  "NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED",
  "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED"]){
  if(existing[key]==="enabled")stop("OTHER_FEATURE_ALREADY_ENABLED");
 }
 const envText=FEATURE_FLAGS.filter(key=>Object.hasOwn(existing,key))
  .map(key=>key+"="+existing[key]).join("\n");
 return Object.freeze({
  count:result.size,
  target:TARGET,
  originalVersion:original.updateTime||null,
  envText:envText?envText+"\n":"",
  safeToInspect:true,
  // Only an explicit main-branch workflow release can use the captured flags.
  safeToDeploy:false,
  productionWrites:0,
  snapshot:result
 });
}
export function compareSingleFunctionRollout(before,after){
 if(!before?.snapshot||!after?.snapshot||
    before.target!==TARGET||after.target!==TARGET||
    before.snapshot.size!==after.snapshot.size)
  stop("INVENTORY_CHANGED");
 for(const [name,prior] of before.snapshot){
  const next=after.snapshot.get(name);
  if(!next||next.state!=="ACTIVE")stop("FUNCTION_REMOVED_OR_DISABLED");
  if(name!==TARGET){
   if(next.updateTime!==prior.updateTime||
      next.buildConfig?.entryPoint!==prior.buildConfig?.entryPoint||
      next.serviceConfig?.uri!==prior.serviceConfig?.uri)
    stop("UNRELATED_FUNCTION_CHANGED");
  }
 }
 const prior=before.snapshot.get(TARGET),next=after.snapshot.get(TARGET);
 if(!next||next.buildConfig?.runtime!=="nodejs22"||
    next.buildConfig?.entryPoint!=="getPartnerWorkspace")
  stop("TARGET_RUNTIME_CHANGED");
 if(next.updateTime===prior.updateTime)stop("TARGET_NOT_UPDATED");
 if(before.envText!==after.envText)stop("TARGET_FLAGS_CHANGED");
 // Never silently remove or rewrite Firebase-managed Eventarc configuration.
 // Do not copy its value into a dotenv file or print it in any CI output.
 const eventarc="EVENTARC_CLOUD_EVENT_SOURCE";
 const priorEnvironment=prior.serviceConfig?.environmentVariables||{};
 const nextEnvironment=next.serviceConfig?.environmentVariables||{};
 if(priorEnvironment[eventarc]!==nextEnvironment[eventarc]||
    Object.hasOwn(priorEnvironment,eventarc)!==
    Object.hasOwn(nextEnvironment,eventarc))
  stop("PLATFORM_ENV_CHANGED");
 return Object.freeze({
  exactlyOneFunctionUpdated:true,otherFunctionsUnchanged:true,
  existingFlagsPreserved:true,productionDocumentWrites:0,
  ownerAuthenticatedGetVerified:false,financeRulesChanged:false,
  hostingChanged:false
 });
}
