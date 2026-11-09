/**
 * Exact target release scope for the two ADDITIVE, default-disabled
 * Hub Owner count-correction callables. No existing function is changed.
 */
export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const CODEBASE="hub-owner-correction-v3";
export const NAMES=Object.freeze(["listHubPartnerCounts","correctHubPartnerCounts"]);
export const TARGETS=Object.freeze(NAMES.map(name=>
 "functions:"+CODEBASE+":"+name));
const STOP=reason=>{throw Error("STOP_OWNER_TWO_DISABLED_"+reason)};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function exactDeploymentTarget(value){
 if(value!==TARGETS.join(","))STOP("TARGET");
 return value;
}
function parseInventory(data){
 if(!object(data)||!Array.isArray(data.result)||data.result.length>500||
    data.nextPageToken!==undefined)STOP("INVENTORY_UNVERIFIED");
 const seen=new Map();
 for(const entry of data.result){
  if(!object(entry))STOP("ROW_UNVERIFIED");
  const raw=entry.id??entry.name;
  if(typeof raw!=="string"||raw.length>500||
     !/^(?:[A-Za-z][A-Za-z0-9_-]*|projects\/[^/]+\/locations\/[^/]+\/functions\/[A-Za-z][A-Za-z0-9_-]*)$/.test(raw)||
     seen.has(raw))STOP("ID_UNVERIFIED");
  seen.set(raw,entry);
 }
 return seen;
}
function basename(id){return id.split("/").at(-1)}
export function verifyDisabledDeployment(before,after){
 const original=parseInventory(before),current=parseInventory(after);
 for(const [id] of original)if(!current.has(id))STOP("ORIGINAL_FUNCTION_DISAPPEARED");
 if([...original.keys()].some(x=>NAMES.includes(basename(x))))
  STOP("OWNER_FUNCTION_ALREADY_EXISTS");
 const added=[...current.keys()].filter(x=>!original.has(x));
 if(added.length!==2||new Set(added.map(basename)).size!==2||
    added.some(x=>!NAMES.includes(basename(x))))STOP("MORE_THAN_TWO_FUNCTIONS_CHANGED");
 for(const id of added){
  const row=current.get(id);
  const match=/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/.exec(id);
  const project=row.projectId??row.project??match?.[1]??null;
  const region=row.region??row.location??row.regionId??match?.[2]??null;
  const codebase=row.codebase??row.labels?.["firebase-functions-codebase"]??null;
  const generation=row.platform??row.generation??null;
  const state=row.state??row.status??null;
  const flags=row.environmentVariables??row.serviceConfig?.environmentVariables??null;
  if(project!==PROJECT||region!==REGION||codebase!==CODEBASE||
     !(typeof generation==="string"&&/(?:gcfv2|gen2|2nd)/i.test(generation))||
     state!=="ACTIVE"||!object(flags)||
     flags.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED!=="disabled")
   STOP("RELEASE_METADATA_MISMATCH");
 }
 return Object.freeze({
  exactTwoAdditiveFunctions:true,
  gen2Tokyo:true,
  codebase:CODEBASE,
  minInstancesZeroSourcePinned:true,
  featureFlagDisabled:true,
  allPreviousFunctionIdsStillListed:true,
  financeRulesOrHostingChanged:false,
  countCorrectionsProductionEnabled:false,
  realAccountOwnerPermissionTested:false,
  financialOriginalReads:0,
  dataWrites:0
 });
}
export function inspectReviewedSource({index,config}){
 if(typeof index!=="string"||typeof config!=="string")STOP("SOURCE");
 let cfg;try{cfg=JSON.parse(config)}catch{STOP("CONFIG_JSON")}
 const f=cfg.functions;
 if(!f||cfg&&Object.keys(cfg).join("|")!=="functions"||
    f.source!=="functions-hub-owner-correction"||
    f.codebase!==CODEBASE||
    !Array.isArray(f.ignore)||f.ignore.join("|")!=="node_modules|.git|firebase-debug.log"||
    !index.includes('HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled"')||
    !index.includes('minInstances:0')||!index.includes('maxInstances:2')||
    !index.includes('region:"asia-northeast1"')||
    !index.includes('cors:["https://nico-factory.web.app"]'))STOP("CONFIG_SCOPE");
 const exported=[...index.matchAll(/exports\.([A-Za-z][A-Za-z0-9]*)\s*=/g)].map(x=>x[1]);
 if(exported.length!==2||exported.some(x=>!NAMES.includes(x))||
    new Set(exported).size!==2)STOP("ONLY_EXACT_TWO");
 return true;
}
