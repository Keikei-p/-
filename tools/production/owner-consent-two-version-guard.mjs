/** Exactly 2 reviewed deployed Owner consent Functions may update. All other
 * existing Gen2 metadata, including count, money, catalog and ranking, MUST be
 * byte-stable. Original Gen1/Gen2 six are checked independently.
 */
import {createHash} from "node:crypto";
import {PROJECT,REGION,checkDeployedMetadata} from "./owner-setup-six-release-scope.mjs";
export const TARGETS=Object.freeze([
 "getRankingOwnerConsentStatus","setRankingOwnerConsent"
]);
export const DEPLOY_TARGETS=Object.freeze(TARGETS.map(x=>
 "functions:ranking-owner-approvals:"+x));
const ROOT="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const STOP=code=>{throw Error("STOP_OWNER_CONSENT_TWO_RELEASE_"+code);};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==="object"?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const hash=x=>createHash("sha256").update(JSON.stringify(stable(x))).digest("hex");
export function snapshotAllExceptTwo(rows){
 if(!Array.isArray(rows)||rows.length>1000)STOP("LIST_INVALID");
 checkDeployedMetadata(rows);
 const listed=new Map();
 for(const entry of rows){
  if(typeof entry?.name!=="string"||!entry.name.startsWith(ROOT)||
    listed.has(entry.name)||entry.state!=="ACTIVE"||
    typeof entry.updateTime!=="string"||entry.updateTime.length<10)
   STOP("INVALID_OR_DUPLICATE");
  listed.set(entry.name,entry);
 }
 const targets={};
 for(const name of TARGETS){
  const target=listed.get(ROOT+name);
  if(!target||target.buildConfig?.entryPoint!==name)
   STOP("TARGET_ABSENT_OR_BAD");
  targets[name]=target.updateTime;
  listed.delete(ROOT+name);
 }
 return Object.freeze({
  targets,protected:Object.fromEntries([...listed].map(([k,v])=>[k,hash(v)])
    .sort(([a],[b])=>a.localeCompare(b))),count:listed.size
 });
}
export function compareTwoVersions(before,after){
 if(!before||!before.targets||!before.protected||
   Object.keys(before.targets).sort().join("|")!==TARGETS.slice().sort().join("|")||
   !Number.isSafeInteger(before.count))STOP("BEFORE_INVALID");
 const current=snapshotAllExceptTwo(after);
 if(current.count!==before.count||
    Object.keys(current.protected).length!==Object.keys(before.protected).length||
    Object.entries(before.protected).some(([key,digest])=>
      !/^[a-f0-9]{64}$/.test(digest)||current.protected[key]!==digest))
   STOP("OTHER_FUNCTION_CHANGED");
 for(const target of TARGETS){
  if(typeof before.targets[target]!=="string"||
     current.targets[target]===before.targets[target])STOP("TARGET_NOT_UPDATED");
 }
 return Object.freeze({
  updatedOwnerConsentFunctions:TARGETS.length,
  unchangedOtherGen2Functions:current.count,
  unchangedOriginalFinanceCountAndOwnerSettings:true,
  rankingFunctionStillDisabled:true,productionDocumentWrites:0
 });
}
