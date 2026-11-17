/**
 * One EXISTING callable only: setOwnerProductVisibility.
 * Pure Cloud Functions v2 metadata gate. Never reads/writes Firestore and
 * never grants anyone a right to deploy. Full source review happens in CI.
 */
export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const PREFIX="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
export const TARGET=PREFIX+"setOwnerProductVisibility";
export const USER_FLAGS=Object.freeze([
 "NICO_OWNER_PRODUCT_VISIBILITY_ENABLED",
 "NICO_OWNER_SKU_MAPPING_ENABLED",
 "NICO_RANKING_OWNER_SETTINGS_ENABLED",
 "NICO_JOINT_COUNT_RANKING_ENABLED"
]);
const PLATFORM=new Set(["FIREBASE_CONFIG","GCLOUD_PROJECT","FUNCTION_TARGET",
 "FUNCTION_SIGNATURE_TYPE","FUNCTION_REGION","LOG_EXECUTION_ID",
 "EVENTARC_CLOUD_EVENT_SOURCE"]);
const OWNER_NAMES=Object.freeze([
 "getOwnerProductVisibility","setOwnerProductVisibility",
 "getOwnerReviewedSkuMapping","setOwnerReviewedSkuMapping"
]);
const stop=code=>{throw Error("STOP_OWNER_ON_SETTER_"+code);};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function checked(rows){
 if(!Array.isArray(rows)||rows.length!==20)stop("INVENTORY_COUNT");
 const entries=new Map();
 for(const f of rows){
  if(!object(f)||typeof f.name!=="string"||
     !f.name.startsWith(PREFIX)||entries.has(f.name)||
     f.state!=="ACTIVE"||
     !object(f.buildConfig)||!object(f.serviceConfig))stop("ACTIVE_SOURCE");
  entries.set(f.name,f);
 }
 for(const name of OWNER_NAMES)if(!entries.has(PREFIX+name))
  stop("OWNER_FOUR_MISSING");
 const original=entries.get(TARGET),env=original.serviceConfig.environmentVariables;
 if(original.buildConfig.runtime!=="nodejs22"||
    original.buildConfig.entryPoint!=="setOwnerProductVisibility"||
    !String(original.serviceConfig.uri||"").startsWith("https://")||
    !object(env)||Array.isArray(original.serviceConfig.secretEnvironmentVariables)&&
       original.serviceConfig.secretEnvironmentVariables.length>0)
  stop("TARGET_RUNTIME");
 const keys=Object.keys(env);
 if(keys.length>80||keys.some(k=>!USER_FLAGS.includes(k)&&!PLATFORM.has(k)))
  stop("UNREVIEWED_TARGET_ENVIRONMENT");
 for(const k of USER_FLAGS){
  if(Object.hasOwn(env,k)&&!["enabled","disabled"].includes(env[k]))
   stop("UNREVIEWED_FLAG_FORMAT");
 }
 if(env.NICO_OWNER_PRODUCT_VISIBILITY_ENABLED!=="enabled")
  stop("OWNER_PUBLICATION_DISABLED");
 if(env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled")
  stop("UNREVIEWED_RANK_RELEASE");
 const ranking=entries.get(PREFIX+"getVerifiedJointCountRanking");
 if(!ranking||ranking.serviceConfig.environmentVariables?.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled")
  stop("RANK_ALREADY_ENABLED");
 for(const name of ["getPartnerWorkspace","submitPartnerWorkspaceCounts"]){
  const p=entries.get(PREFIX+name);
  if(!p)stop("PARTNER_LEDGER_MISSING");
  if(["NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED","NICO_PARTNER_SHARED_RANKING_ENABLED",
      "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED"].some(
       key=>p.serviceConfig.environmentVariables?.[key]==="enabled"))
   stop("PARTNER_RISK_ALREADY_ENABLED");
 }
 return entries;
}
export function inspectOwnerOnSetterMetadata(rows){
 const entries=checked(rows),target=entries.get(TARGET);
 const env=target.serviceConfig.environmentVariables;
 const envText=USER_FLAGS.filter(k=>Object.hasOwn(env,k))
  .map(k=>k+"="+env[k]).join("\n");
 return Object.freeze({
  inventoryCount:entries.size,target:TARGET,
  previouslyActive:true,ownerPublicationEnabled:true,
  highRiskCountWriteAndRankDisabled:true,
  envText:envText?envText+"\n":"",
  snapshot:entries,
  productionDocumentWritesByInspection:0,
  approvedForDeployment:false
 });
}
export function compareOwnerOnSetterUpdate(before,after){
 if(!before?.snapshot||!after?.snapshot||
    before.target!==TARGET||after.target!==TARGET||
    before.snapshot.size!==20||after.snapshot.size!==20)
  stop("INVENTORY_CHANGED");
 const b=checked([...before.snapshot.values()]);
 const a=checked([...after.snapshot.values()]);
 for(const [name,prior] of b){
  const next=a.get(name);
  if(!next)stop("FUNCTION_MISSING");
  if(name!==TARGET){
   if(next.updateTime!==prior.updateTime||
      next.buildConfig.entryPoint!==prior.buildConfig.entryPoint||
      next.buildConfig.runtime!==prior.buildConfig.runtime||
      next.serviceConfig.uri!==prior.serviceConfig.uri||
      JSON.stringify(next.serviceConfig.environmentVariables||{})!==
        JSON.stringify(prior.serviceConfig.environmentVariables||{}))
    stop("UNRELATED_FUNCTION_CHANGED");
  }
 }
 const prior=b.get(TARGET),next=a.get(TARGET);
 if(!next.updateTime||next.updateTime===prior.updateTime||
    next.buildConfig.runtime!=="nodejs22"||
    next.buildConfig.entryPoint!=="setOwnerProductVisibility"||
    next.serviceConfig.uri!==prior.serviceConfig.uri||
    next.serviceConfig.serviceAccountEmail!==prior.serviceConfig.serviceAccountEmail||
    JSON.stringify(next.serviceConfig.environmentVariables||{})!==
      JSON.stringify(prior.serviceConfig.environmentVariables||{}))
  stop("TARGET_NOT_REVIEWED_OR_ENV_CHANGED");
 if(before.envText!==after.envText)stop("USER_FLAGS_CHANGED");
 return Object.freeze({
  exactlyOneOwnerSetterUpdated:true,otherNineteenUnchanged:true,
  ownerProductFlagPreserved:true,rankingAndPublicationStillDisabled:true,
  firestoreDocumentWritesByAudit:0,authenticatedOwnerSaveNotYetVerified:true
 });
}
