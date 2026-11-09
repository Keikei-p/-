/**
 * Enable ONLY an already deployed Owner count list callable. The correction
 * callable remains explicitly disabled and byte-for-byte metadata stable.
 * No company Owner role grants, no Firestore writes, no change to six originals.
 */
export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const CODEBASE="hub-owner-correction-v3";
export const READ_NAME="listHubPartnerCounts";
export const WRITE_NAME="correctHubPartnerCounts";
export const TARGET="functions:hub-owner-correction-v3:listHubPartnerCounts";
const STOP=x=>{throw Error("STOP_OWNER_LIST_ONLY_"+x)};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function exactListOnlyTarget(value){
 if(value!==TARGET)STOP("UNREVIEWED_TARGET");
 return value;
}
const key=x=>typeof x==="string"?x.split("/").at(-1):"";
function inventory(json){
 if(!obj(json)||!Array.isArray(json.result)||json.result.length>500||
    json.nextPageToken!=null)STOP("UNVERIFIED_INVENTORY");
 const m=new Map();
 for(const row of json.result){
  const id=row?.id??row?.name;
  if(!obj(row)||typeof id!=="string"||id.length>500||m.has(id)||
     !/^(?:[A-Za-z][A-Za-z0-9_-]*|projects\/[^/]+\/locations\/[^/]+\/functions\/[A-Za-z][A-Za-z0-9_-]*)$/.test(id))
   STOP("BAD_FUNCTION_ID");
  m.set(id,row);
 }
 return m;
}
function find(rows,name){
 const found=[...rows.entries()].filter(([id])=>key(id)===name);
 if(found.length!==1)STOP("MISSING_OR_DUPLICATE_"+name.toUpperCase());
 const [id,row]=found[0];
 const parsed=/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/.exec(id);
 const project=row.projectId??row.project??parsed?.[1];
 const region=row.region??row.location??row.regionId??parsed?.[2];
 const codebase=row.codebase??row.labels?.["firebase-functions-codebase"];
 const platform=row.platform??row.generation;
 const flags=row.environmentVariables??row.serviceConfig?.environmentVariables??{};
 const flag=flags.HUB_OWNER_COUNT_CORRECTION_V3_ENABLED;
 if(project!==PROJECT||region!==REGION||codebase!==CODEBASE||
    row.state!=="ACTIVE"||
    !(typeof platform==="string"&&/(?:gcfv2|gen2|2nd)/i.test(platform))||
    !["enabled","disabled"].includes(flag))
  STOP("FUNCTION_METADATA_UNVERIFIED");
 return {id,row,flag};
}
export function inspectBeforeOwnerListOnly(before){
 const b=inventory(before),reader=find(b,READ_NAME),writer=find(b,WRITE_NAME);
 if(reader.flag!=="disabled"||writer.flag!=="disabled")
  STOP("NOT_BOTH_DISABLED");
 return Object.freeze({targetPresent:true,listDisabled:true,correctionDisabled:true,
  functionCount:b.size});
}
export function inspectAfterOwnerListOnly(before,after){
 const b=inventory(before),a=inventory(after);
 if(b.size!==a.size||[...b.keys()].some(k=>!a.has(k)))
  STOP("FUNCTION_SET_CHANGED");
 const readBefore=find(b,READ_NAME),readAfter=find(a,READ_NAME);
 const writeBefore=find(b,WRITE_NAME),writeAfter=find(a,WRITE_NAME);
 if(readBefore.id!==readAfter.id||writeBefore.id!==writeAfter.id||
    readBefore.flag!=="disabled"||readAfter.flag!=="enabled"||
    writeBefore.flag!=="disabled"||writeAfter.flag!=="disabled")
  STOP("OWNER_FLAG_CHANGE_SCOPE");
 if(JSON.stringify(writeBefore.row)!==JSON.stringify(writeAfter.row))
  STOP("WRITER_METADATA_CHANGED");
 for(const [id,row] of b){
  if(id!==readBefore.id&&JSON.stringify(row)!==JSON.stringify(a.get(id)))
   STOP("UNRELATED_FUNCTION_METADATA_CHANGED");
 }
 return Object.freeze({
  enabledReadOnlyCallable:true,originalFunctionIdsUnchanged:true,
  correctionFunctionStillDisabled:true,originalWriterMetadataUnchanged:true,
  replacedFunctionCount:1,addedFunctions:0,removedFunctions:0,
  firestoreRulesChanged:false,hostingChanged:false,
  companyOwnerPermissionsChanged:false,dataWrites:0,
  authenticatedOwnerRuntimeTested:false
 });
}
export function assertReadOnlyListSource({service,entry}={}){
 if(typeof service!=="string"||typeof entry!=="string")STOP("SOURCE_MISSING");
 const start=service.indexOf(" async function list(request){");
 const end=service.indexOf(" async function correct(request){");
 if(start<0||end<=start)STOP("READ_SERVICE_NOT_SEPARATED");
 const onlyList=service.slice(start,end);
 if(!onlyList.includes("ensureHub(request,null)")||
    !onlyList.includes("ensurePartner(r=>r.get()")||
    !onlyList.includes('scope:"existing-partner-counts-only"')||
    !onlyList.includes("containsFinance:false")||
    /(?:\brunTransaction\s*\(|\btx\.(?:update|create|set|delete)\s*\(|\.(?:set|update|delete|create|add)\s*\()/.test(onlyList))
  STOP("READ_SERVICE_CONTRACT_CHANGED");
 if(!entry.includes('exports.listHubPartnerCounts=onCall(options,service.list)')||
    !entry.includes('exports.correctHubPartnerCounts=onCall(options,service.correct)')||
    !entry.includes('minInstances:0')||
    !entry.includes('maxInstances:2')||
    !entry.includes('region:"asia-northeast1"')||
    !entry.includes('cors:["https://nico-factory.web.app"]'))
  STOP("ENTRY_CONTRACT_CHANGED");
 return true;
}
