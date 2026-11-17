/**
 * Source-pinned release preflight for existing getPartnerWorkspace ONLY.
 * Does not deploy, access production credentials, or change stored counts.
 * Refuses to interpret a passing unit test as authenticated live proof.
 */
import {blobSha} from "../hosting/owner-setup-additive-guard.mjs";

const stop=x=>{throw Error("STOP_OWNER_GET_ONLY_"+x);};
export const TARGET="functions:partner-workspace:getPartnerWorkspace";
export const APPROVED=Object.freeze({
 "functions-partner-workspace/index.js":"42eea81ab01449bedbbedabdc1a8fb6bfba1e284",
 "functions-partner-workspace/service.cjs":"f78b1fa16f71848b20579ad220f82b703fe7f209",
 "functions-partner-workspace/workspace-identity.cjs":"e06305c7dd151a3e5bab93a394396754fd25088e",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750"
});
export function inspectOwnerGetCandidate(sources,target=TARGET){
 if(target!==TARGET)stop("TARGET");
 if(!sources||typeof sources!=="object"||Array.isArray(sources)||
    Object.keys(sources).sort().join("|")!==Object.keys(APPROVED).sort().join("|"))
  stop("SOURCE_SET");
 for(const [path,sha] of Object.entries(APPROVED)){
  if(typeof sources[path]!=="string"||blobSha(sources[path])!==sha)
   stop("SOURCE_DRIFT");
 }
 const index=sources["functions-partner-workspace/index.js"];
 const service=sources["functions-partner-workspace/service.cjs"];
 const identity=sources["functions-partner-workspace/workspace-identity.cjs"];
 let conf;try{conf=JSON.parse(sources["firebase.partner-workspace.json"]);}catch{stop("CONFIG");}
 if(Object.keys(conf).join("|")!=="functions"||
    conf.functions?.source!=="functions-partner-workspace"||
    conf.functions?.codebase!=="partner-workspace"||
    conf.functions?.ignore?.join("|")!=="node_modules|.git|firebase-debug.log")
  stop("CONFIG_SCOPE");
 if(!index.includes("exports.getPartnerWorkspace=onCall(opts,service.view)")||
    !index.includes('region:"asia-northeast1"')||
    !service.includes("ownerSetupCompaniesOnly===true")||
    !service.includes("setupOnly?ownerSetupActor(request):actor(request)")||
    !service.includes('Object.keys(d).sort().join("|")!=="date|ownerSetupCompaniesOnly"')||
    !service.includes('s.kind!=="hub"||s.role!=="owner"')||
    !service.includes("enabled:()=>true,now")||
    !identity.includes("verifyIdToken(bearer,true)")||
    !identity.includes("getAuth().getUser(uid)"))
  stop("OWNER_GET_SOURCE_INCOMPLETE");
 if(!index.includes('sharedRankingEnabled:()=>process.env.NICO_PARTNER_SHARED_RANKING_ENABLED==="enabled"')||
    !index.includes('submissionPublicationEnabled:()=>process.env.NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"'))
  stop("COUNT_FLAGS_DRIFT");
 return Object.freeze({
  target:TARGET,sourcePinned:true,ownerReadOnlyPathPresent:true,
  onlyGetTargetReviewed:true,otherFunctionsUnchanged:false,
  liveOwnerAuthVerified:false,backendDeployedVerified:false,
  financeBoundaryVerified:false,releaseAuthorized:false,
  safeToDeploy:false,productionWrites:0
 });
}
export function inspectOwnerGetMetadata({before,after}={}){
 const name="projects/sales-management-cc116/locations/asia-northeast1/functions/getPartnerWorkspace";
 const normalize=rows=>{
  if(!Array.isArray(rows)||rows.length<1||rows.length>1000)stop("FUNCTION_LIST");
  const seen=new Set();
  const all=new Map();
  for(const entry of rows){
   if(typeof entry?.name!=="string"||seen.has(entry.name)||
      typeof entry?.updateTime!=="string"||
      typeof entry?.state!=="string")stop("METADATA");
   seen.add(entry.name);all.set(entry.name,entry);
  }
  if(!all.has(name))stop("GET_FUNCTION_ABSENT");
  return all;
 };
 const old=normalize(before),next=normalize(after);
 if(old.size!==next.size||[...old.keys()].some(x=>!next.has(x)))
  stop("INVENTORY_CHANGED");
 // A single Function release must never replace the other partner count
 // writers, finance endpoints, or original login paths.
 for(const [key,entry] of old){
  const newer=next.get(key);
  if(key!==name&&JSON.stringify(newer)!==JSON.stringify(entry))
   stop("OTHER_FUNCTION_CHANGED");
 }
 const a=old.get(name),b=next.get(name);
 if(a.state!=="ACTIVE"||b.state!=="ACTIVE"||
    a.buildConfig?.entryPoint!=="getPartnerWorkspace"||
    b.buildConfig?.entryPoint!=="getPartnerWorkspace"||
    a.buildConfig?.runtime!==b.buildConfig?.runtime||
    b.buildConfig?.runtime!=="nodejs22"||
    a.serviceConfig?.uri!==b.serviceConfig?.uri||
    !b.serviceConfig?.uri?.startsWith("https://"))
  stop("GET_FUNCTION_DRIFT");
 const flags=a.serviceConfig?.environmentVariables;
 const actual=b.serviceConfig?.environmentVariables;
 if(!flags||!actual||JSON.stringify(flags)!==JSON.stringify(actual))
  stop("FEATURE_FLAGS_CHANGED");
 return Object.freeze({
  originalFunctionCount:old.size,otherFunctionsUnchanged:true,
  existingFlagsUnchanged:true,getFunctionActive:true,
  // Metadata does NOT prove that the modified branch is active. A test
  // with a real signed Owner token is required after limited deployment.
  ownerAuthVerified:false,readyForOwnerUi:false
 });
}
