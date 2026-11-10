/**
 * Owner settings ONLY: exact six new authenticated Functions.
 * Never deploy the joint ranking GET or update original count/finance Functions.
 */
export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const NEW=Object.freeze([
 "getRankingOwnerConsentStatus","setRankingOwnerConsent",
 "getOwnerProductVisibility","setOwnerProductVisibility",
 "getOwnerReviewedSkuMapping","setOwnerReviewedSkuMapping"
]);
export const TARGETS=Object.freeze(NEW.map(name=>
 "functions:ranking-owner-approvals:"+name));
export const EXPECTED_FLAGS=Object.freeze({
 NICO_RANKING_OWNER_SETTINGS_ENABLED:"enabled",
 NICO_OWNER_PRODUCT_VISIBILITY_ENABLED:"enabled",
 NICO_OWNER_SKU_MAPPING_ENABLED:"enabled",
 NICO_JOINT_COUNT_RANKING_ENABLED:"disabled"
});
const stopped=code=>{throw Error("STOP_OWNER_SIX_RELEASE_"+code);};
const isObject=v=>v&&typeof v==="object"&&!Array.isArray(v);
const id=v=>typeof v==="string"&&/^[A-Za-z0-9_./:-]{1,400}$/.test(v);
const key=name=>typeof name==="string"?name.split("/").at(-1):null;
export function ensureExactTargets(value){
 if(value!==TARGETS.join(","))stopped("TARGET_MISMATCH");
 return true;
}
export function inspectIsolatedSource(index,config){
 if(typeof index!=="string"||typeof config!=="string")stopped("SOURCE_MISSING");
 let parsed;try{parsed=JSON.parse(config);}catch{stopped("CONFIG_INVALID");}
 if(Object.keys(parsed).join("|")!=="functions"||
    parsed.functions?.source!=="functions-ranking-approvals"||
    parsed.functions?.codebase!=="ranking-owner-approvals"||
    parsed.functions?.ignore?.join("|")!=="node_modules|.git|firebase-debug.log")
    stopped("CONFIG_SCOPE");
 const names=[...index.matchAll(/exports\.([A-Za-z][A-Za-z0-9]*)\s*=/g)].map(x=>x[1]);
 const approved=[...NEW,"getVerifiedJointCountRanking"];
 if(names.length!==approved.length||
    approved.some(n=>names.filter(x=>x===n).length!==1)||
    !NEW.every(n=>index.includes("exports."+n+"=onCall"))||
    !index.includes("exports.getVerifiedJointCountRanking=onRequest"))
    stopped("FUNCTION_EXPORT_DRIFT");
 for(const flag of Object.keys(EXPECTED_FLAGS)){
  if(!index.includes("process.env."+flag+'==="enabled"'))stopped("FEATURE_FLAG_DRIFT");
 }
 if(index.includes("submitPartnerWorkspaceCounts")||
    index.includes("managePartnerWorkspace")||
    index.includes("deleteUser(")||index.includes("deleteDoc(")||
    index.includes("firebase deploy")||
    !index.includes('region:"asia-northeast1"')||
    !index.includes("maxInstances:2"))
    stopped("FUNCTION_FINANCE_SCOPE_DRIFT");
 return true;
}
function paths(inventory){
 const rows=inventory?.result;
 if(!Array.isArray(rows)||rows.length>1000)stopped("INVENTORY_MISSING");
 const result=new Set();
 for(const row of rows){
  const name=row?.id||row?.name;
  if(!id(name)||result.has(name))stopped("INVENTORY_INVALID");
  result.add(name);
 }
 return result;
}
export function assertAbsent(inventory){
 const before=paths(inventory);
 if([...before].some(x=>NEW.includes(key(x))))stopped("TARGET_ALREADY_EXISTS");
 return Object.freeze({knownFunctionCount:before.size,targetsAbsent:true});
}
export function compareDeployment(before,after){
 const old=paths(before),now=paths(after);
 if([...old].some(x=>!now.has(x)))stopped("EXISTING_FUNCTION_REMOVED");
 if([...old].some(x=>NEW.includes(key(x))))stopped("TARGET_ALREADY_EXISTS");
 const added=[...now].filter(x=>!old.has(x));
 if(added.length!==NEW.length||
    NEW.some(n=>added.filter(x=>key(x)===n).length!==1))
    stopped("ADDED_FUNCTION_SET_MISMATCH");
 for(const item of added){
  if(item!==key(item)&&item!==
     "projects/"+PROJECT+"/locations/"+REGION+"/functions/"+key(item))
    stopped("ADDED_REGION_MISMATCH");
  if(item===key(item)){
   const row=after.result.find(x=>(x.id||x.name)===item);
   if(row?.region!==REGION)stopped("SHORT_ID_NO_REGION");
  }
 }
 return Object.freeze({
  ownerFunctionsAdded:6,originalFunctionsRemoved:0,
  approvedTargetsOnly:true,financeOrRulesChanged:false,
  realAccountCountSaveVerified:false,financeRawGetListDeniedVerified:false,
  jointRankingProductionEnabled:false
 });
}
export function checkDeployedMetadata(rows){
 if(!Array.isArray(rows)||rows.length>1000)stopped("REMOTE_METADATA_INVALID");
 const root="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
 for(const name of NEW){
  const entries=rows.filter(x=>x?.name===root+name);
  if(entries.length!==1)stopped("REQUIRED_FUNCTION_MISSING");
  const body=entries[0];
  if(body.state!=="ACTIVE"||
     body.buildConfig?.entryPoint!==name||
     body.buildConfig?.runtime!=="nodejs22"||
     typeof body.serviceConfig?.uri!=="string"||
     !body.serviceConfig.uri.startsWith("https://"))
    stopped("REQUIRED_FUNCTION_NOT_ACTIVE");
  const env=body.serviceConfig.environmentVariables;
  if(!isObject(env)||
     Object.entries(EXPECTED_FLAGS).some(([key,value])=>env[key]!==value))
    stopped("REQUIRED_FUNCTION_FLAGS_MISMATCH");
 }
 const ranking=rows.filter(x=>x?.name===root+"getVerifiedJointCountRanking");
 if(ranking.length>1||
    ranking.length===1&&ranking[0].serviceConfig?.environmentVariables?.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled")
    stopped("JOINT_RANKING_EXPOSED");
 return Object.freeze({
  allSixActive:true,ownerConfigurationOnly:true,
  noEnabledJointRanking:true,noFinanceGateChanged:true
 });
}
