/**
 * NICO joint ranking function — ONE FUNCTION ONLY, manual / disabled.
 *
 * No network, no deployment, no data writes in this script. Inspect exact
 * reviewed source and compare Firebase CLI read-only inventories.
 * A successful inventory is NOT proof of live user finance isolation.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

export const TARGET="functions:ranking-owner-approvals:getVerifiedJointCountRanking";
export const NAME="getVerifiedJointCountRanking";
const PROJECT="sales-management-cc116",REGION="asia-northeast1";
const NAMES=new Set(["getRankingOwnerConsentStatus","setRankingOwnerConsent",
 "getOwnerProductVisibility","setOwnerProductVisibility",
 "getOwnerReviewedSkuMapping","setOwnerReviewedSkuMapping",NAME]);
const STOP=reason=>{throw Error("JOINT_RANKING_DISABLED_RELEASE_"+reason);};
export function ensureSingleRankingTarget(value){
 if(value!==TARGET)STOP("EXTRA_OR_WRONG_FUNCTION");
 return true;
}
export function inspectIsolatedRankingSource(indexText,configText){
 if(typeof indexText!=="string"||typeof configText!=="string")
  STOP("SOURCE_UNAVAILABLE");
 let cfg;
 try{cfg=JSON.parse(configText);}catch{STOP("CONFIG_INVALID");}
 if(Object.keys(cfg).sort().join("|")!=="functions"||
   cfg.functions?.source!=="functions-ranking-approvals"||
   cfg.functions?.codebase!=="ranking-owner-approvals"||
   !indexText.includes('NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"')||
   !indexText.includes('NICO_OWNER_PRODUCT_VISIBILITY_ENABLED==="enabled"')||
   !indexText.includes('NICO_OWNER_SKU_MAPPING_ENABLED==="enabled"')||
   !indexText.includes('NICO_RANKING_OWNER_SETTINGS_ENABLED==="enabled"')||
   !indexText.includes('exports.getVerifiedJointCountRanking=onRequest({')||
   !indexText.includes('cors:false')||
   !indexText.includes('createJointCountHttpAdapter({'))STOP("UNREVIEWED_CODEBASE");
 const names=[...indexText.matchAll(/exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)]
  .map(x=>x[1]);
 if(names.length!==NAMES.size||new Set(names).size!==names.length||
    names.some(x=>!NAMES.has(x)))STOP("UNREVIEWED_EXPORTS");
 return true;
}
function parseInventory(json){
 const items=json?.result;
 if(!Array.isArray(items)||items.length>500)STOP("INVENTORY_UNAVAILABLE");
 const ids=new Map();
 for(const item of items){
  const name=item?.id||item?.name;
  if(typeof name!=="string"||name.length>256||
     !/^[A-Za-z0-9_./-]+$/.test(name)||ids.has(name))
    STOP("INVENTORY_INVALID");
  ids.set(name,item);
 }
 return ids;
}
function basename(s){return s.split("/").at(-1);}
function approvedNew(item,name){
 if(name===NAME){
  // Some CLI versions use short IDs, others full Gen2 resource paths.
  if(item.id===NAME||item.name===NAME)
   return item.region===REGION||item.location===REGION;
  return true;
 }
 const match=name.match(/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/);
 return Boolean(match&&match[1]===PROJECT&&match[2]===REGION&&match[3]===NAME);
}
export function inspectPredeployInventory(json){
 const items=parseInventory(json);
 for(const id of items.keys())
  if(basename(id)===NAME)STOP("TARGET_ALREADY_PRESENT");
 return Object.freeze({originalCount:items.size,
  newFunctionAbsent:true,legacyInventoryReadOnly:true});
}
export function compareOneDisabledFunction(before,after){
 const a=parseInventory(before),b=parseInventory(after);
 inspectPredeployInventory(before);
 for(const name of a.keys())if(!b.has(name))STOP("ORIGINAL_FUNCTION_MISSING");
 const added=[...b].filter(([name])=>!a.has(name));
 if(added.length!==1||basename(added[0][0])!==NAME||
    !approvedNew(added[0][1],added[0][0]))
   STOP("ADDITIONAL_FUNCTION_OR_WRONG_REGION");
 return Object.freeze({allOriginalFunctionsPreserved:true,
  exactlyOneNewRankingFunction:true,newFunctionName:NAME,
  realFinanceBoundaryVerified:false,productionRankingEnabled:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const index=readFileSync(new URL("../../functions-ranking-approvals/index.js",import.meta.url),"utf8");
  const config=readFileSync(new URL("../../firebase.ranking-approvals.json",import.meta.url),"utf8");
  inspectIsolatedRankingSource(index,config);
  ensureSingleRankingTarget(TARGET);
  console.log("JOINT_RANKING_DISABLED_ONE_FUNCTION_SCOPE_PASS_NO_DEPLOY");
 }catch(e){
  console.error(/^JOINT_RANKING_DISABLED_RELEASE_[A-Z_]+$/.test(e?.message||"")?
   e.message:"JOINT_RANKING_DISABLED_RELEASE_UNVERIFIED");
  process.exitCode=1;
 }
}
