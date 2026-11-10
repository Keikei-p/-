/**
 * Protect every existing Gen2 Function except the exact reviewed Owner
 * consent STATUS callable. No existing count, finance, consent WRITE,
 * product visibility, SKU map, ranking GET or Auth service may change.
 * Live metadata values remain in temporary runner files, only counts logged.
 */
import {createHash} from "node:crypto";
import {NEW,PROJECT,REGION,checkDeployedMetadata} from "./owner-setup-six-release-scope.mjs";
const STOP=code=>{throw Error("STOP_OWNER_STATUS_SINGLE_RELEASE_"+code);};
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
export const TARGET="getRankingOwnerConsentStatus";
export const DEPLOY_TARGET="functions:ranking-owner-approvals:"+TARGET;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==="object"?
 Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))
  .map(([k,value])=>[k,stable(value)])):v;
const sha=v=>createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
export function snapshotOtherFunctions(rows){
 if(!Array.isArray(rows)||rows.length>1000)STOP("LIST_BUDGET");
 checkDeployedMetadata(rows);
 const result=new Map(),target=ROOT+TARGET;
 for(const item of rows){
  const name=item?.name;
  if(typeof name!=="string"||!name.startsWith(ROOT)||result.has(name))
   STOP("REGION_NAME_INVALID");
  result.set(name,sha(item));
 }
 if(!result.has(target))STOP("STATUS_TARGET_MISSING");
 const original=rows.find(x=>x.name===target);
 if(original.state!=="ACTIVE"||typeof original.updateTime!=="string"||
    !original.updateTime)STOP("TARGET_NOT_ACTIVE");
 result.delete(target);
 return Object.freeze({
  protected:Object.fromEntries([...result].sort(([a],[b])=>a.localeCompare(b))),
  targetUpdateTime:original.updateTime,
  protectedCount:result.size
 });
}
export function compareSingleFunctionVersion(before,afterRows){
 if(!before||!before.protected||typeof before.targetUpdateTime!=="string"||
    !Number.isSafeInteger(before.protectedCount))STOP("BEFORE_MISSING");
 const after=snapshotOtherFunctions(afterRows);
 const prev=before.protected,now=after.protected;
 if(before.protectedCount!==after.protectedCount||
    Object.keys(prev).length!==Object.keys(now).length||
    Object.entries(prev).some(([k,v])=>!/^[a-f0-9]{64}$/.test(v)||
     now[k]!==v))STOP("OTHER_FUNCTION_UPDATED_OR_DELETED");
 if(after.targetUpdateTime===before.targetUpdateTime)
  STOP("TARGET_REVISION_NOT_CHANGED");
 if(!NEW.includes(TARGET))STOP("TARGET_SCOPE");
 return Object.freeze({
  exactlyOneOwnerStatusRevisionUpdated:true,
  unaffectedExistingGen2:after.protectedCount,
  originalFinanceCountProductMapAndConsentWriteFunctionsUnchanged:true,
  jointRankingStillDisabled:true,productionDocumentWrites:0
 });
}
