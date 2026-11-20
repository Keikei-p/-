/**
 * Activate ONLY the two already deployed, previously disabled Owner-only
 * count correction callables. No new Functions; no original replacements.
 */
import {PROJECT,REGION,CODEBASE,NAMES,TARGETS,exactDeploymentTarget} from "./owner-two-disabled-release-scope.mjs";
export {TARGETS,exactDeploymentTarget};
const STOP=code=>{throw Error("STOP_OWNER_ENABLE_"+code)};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function byId(j){
 if(!obj(j)||!Array.isArray(j.result)||j.result.length>500)STOP("INVENTORY");
 const m=new Map();
 for(const x of j.result){
  const raw=x?.id??x?.name;
  if(typeof raw!=="string"||raw.length>500||m.has(raw))STOP("FUNCTION_ID");
  m.set(raw,x);
 }
 return m;
}
function details(name,inventory){
 const rows=[...inventory.entries()].filter(([id])=>id.split("/").at(-1)===name);
 if(rows.length!==1)STOP("MISSING_OR_DUPLICATE_"+name.toUpperCase());
 const [id,row]=rows[0],parsed=id.match(/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/);
 const p=row.projectId??row.project??parsed?.[1]??null;
 const region=row.region??row.location??row.regionId??parsed?.[2]??null;
 const codebase=row.codebase??row.labels?.["firebase-functions-codebase"]??null;
 const platform=row.platform??row.generation??null;
 const flag=row.environmentVariables?.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED??
  row.serviceConfig?.environmentVariables?.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED??null;
 if(p!==PROJECT||region!==REGION||codebase!==CODEBASE||
    row.state!=="ACTIVE"||
    !(typeof platform==="string"&&/(?:gcfv2|gen2|2nd)/i.test(platform)))
  STOP("TARGET_METADATA");
 return {id,flag};
}
export function inspectActivation(before,after){
 const b=byId(before),a=byId(after);
 if(b.size!==a.size)STOP("FUNCTION_SET_CHANGED");
 for(const id of b.keys())if(!a.has(id))STOP("FUNCTION_ID_CHANGED");
 for(const name of NAMES){
  const was=details(name,b),now=details(name,a);
  if(was.id!==now.id||was.flag!=="disabled"||now.flag!=="enabled")
   STOP("FLAG_TRANSITION_NOT_VERIFIED");
 }
 return Object.freeze({
  exactExistingTwoActivated:true,addedFunctions:0,removedFunctions:0,
  ownerOnlyCountCallablesEnabled:true,originalSourceChanged:false,
  financialOriginalDocumentsWritten:0,
  existingPartnerCountEntriesWrittenDuringDeployment:0,
  firestoreRulesChanged:false,hostingChanged:false,
  realAccountCountCorrectionTested:false
 });
}
export function beforeDisabled(inventory){
 const data=byId(inventory);
 for(const name of NAMES)if(details(name,data).flag!=="disabled")
  STOP("TARGET_NOT_DISABLED");
 return true;
}
export function afterEnabled(inventory){
 const data=byId(inventory);
 for(const name of NAMES)if(details(name,data).flag!=="enabled")
  STOP("TARGET_NOT_ENABLED");
 return true;
}
