/**
 * STAGING / NO DEPLOY. ONE new function only, all existing functions immutable.
 * The manual release workflow must also require current main SHA, credential,
 * immutable originals, explicit approved cost and disabled feature flag.
 */
const TARGET="functions:ranking-owner-approvals:getVerifiedJointCountRanking";
const NAME="getVerifiedJointCountRanking";
const ID=/^[A-Za-z0-9_./-]{1,280}$/;
const STOP=()=>{throw Error("NICO_RANKING_DISABLED_RELEASE_SCOPE_BLOCKED")};
export function target(){return TARGET}
export function ensureExactTarget(value){
 if(value!==TARGET)STOP();
 return true;
}
export function inspectSource(index,config){
 if(typeof index!=="string"||typeof config!=="string")STOP();
 let json;try{json=JSON.parse(config)}catch{STOP()}
 if(Object.keys(json).length!==1||
    !json.functions||
    Object.keys(json.functions).sort().join("|")!=="codebase|ignore|source"||
    !Array.isArray(json.functions.ignore)||
    json.functions.ignore.join("|")!=="node_modules|.git|firebase-debug.log"||
    json.functions.source!=="functions-ranking-approvals"||
    json.functions.codebase!=="ranking-owner-approvals"||
    !index.includes('exports.getVerifiedJointCountRanking=onRequest')||
    !index.includes('NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"')||
    !index.includes('region:"asia-northeast1"'))STOP();
 const names=[...index.matchAll(/exports\.([A-Za-z][A-Za-z0-9]*)\s*=/g)]
  .map(x=>x[1]);
 const expected=[
  "getRankingOwnerConsentStatus","setRankingOwnerConsent",
  "getOwnerProductVisibility","setOwnerProductVisibility",
  "getOwnerReviewedSkuMapping","setOwnerReviewedSkuMapping",
  NAME
 ];
 if(names.length!==expected.length||
    names.some(x=>!expected.includes(x))||
    new Set(names).size!==expected.length)STOP();
 return true;
}
export function getIds(inventory){
 const items=inventory?.result;
 if(!Array.isArray(items)||items.length>500)STOP();
 const seen=new Set();
 for(const item of items){
  const n=item?.id||item?.name;
  if(typeof n!=="string"||!ID.test(n)||seen.has(n))STOP();
  seen.add(n);
 }
 return seen;
}
export function compareInventory(before,after){
 const old=getIds(before),now=getIds(after);
 for(const x of old)if(!now.has(x))STOP();
 const basename=x=>x.split("/").at(-1);
 if([...old].some(x=>basename(x)===NAME))STOP();
 const newIds=[...now].filter(x=>!old.has(x));
 if(newIds.length!==1||basename(newIds[0])!==NAME)STOP();
 const id=newIds[0];
 const exactLong="projects/sales-management-cc116/locations/asia-northeast1/functions/"+NAME;
 // The CLI short spelling needs a region/source codebase verification in
 // the workflow inventory; short ID alone is not proof of a correct region.
 if(id!==exactLong&&id!==NAME)STOP();
 return Object.freeze({newFunctionOnly:true,oldFunctionIdsPreserved:true,
  targetFunctionName:NAME,regionRequiresConfirmation:id===NAME,
  productionRankingEnabled:false,hostingRewritten:false,
  safeToExposePartnerFinance:false});
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,"/"))){
 ensureExactTarget(TARGET);
 console.log("EXACT_DISABLED_RANKING_FUNCTION_SCOPE_OK");
}
