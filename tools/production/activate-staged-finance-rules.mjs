/**
 * FIREBASE RULES ONLY. No Firestore Admin data writes, auth, hosting or Functions.
 * Use ONLY after real owner finance and partner count save have been checked.
 * The current and staged Ruleset names are immutable observed resource IDs.
 */
import {createHash} from "node:crypto";
import {originalRules,proposeSecondaryFinanceFence} from
 "../../security/secondary-finance-read-fence.mjs";
export const PROJECT="sales-management-cc116";
const ROOT="projects/"+PROJECT;
const RELEASE=ROOT+"/releases/cloud.firestore";
const OLD=ROOT+"/rulesets/b1884292-0572-4092-8a45-009024309b95";
const STAGED=ROOT+"/rulesets/a7561d7c-d65c-4c37-bd57-c5614070332d";
const EXPECTED_CANDIDATE_SHA="25fd2c0257e92beb5ba9e3b2f8b3a5801d2fa010188675c685c05051eafb12a8";
const abort=x=>{throw Error("STOP_FINANCE_RULES_CUTOVER_"+x);};
const sha=x=>createHash("sha256").update(x).digest("hex");
const sources=()=>{
 const baseline=originalRules(),next=proposeSecondaryFinanceFence();
 if(sha(next)!==EXPECTED_CANDIDATE_SHA)abort("CANDIDATE_CHANGED");
 return {baseline,next};
};
const realBackup=b=>{
 if(!b||!Number.isSafeInteger(b.readyBackups)||b.readyBackups<1||
    typeof b.latestReadySnapshot!=="string")return false;
 const diff=Date.now()-Date.parse(b.latestReadySnapshot);
 return Number.isFinite(diff)&&diff>=0&&diff<48*60*60*1000;
};
const source=body=>{
 const s=body?.source?.files;
 if(!Array.isArray(s)||s.length!==1||
    s[0]?.name!=="firestore.rules"||typeof s[0]?.content!=="string")
  abort("RULESET_SOURCE_MALFORMED");
 return s[0].content;
};
const patchBody=rulesetName=>({
 release:{name:RELEASE,rulesetName},updateMask:"rulesetName"
});
export async function switchFinanceRules({
 mode="inspect",request,functionsReady=false,backup=null,
 ownerBeforeAttested=false,partnerCountsBeforeAttested=false,
 operatorApproval=false
}={}){
 if(!["inspect","apply","rollback"].includes(mode))abort("INVALID_MODE");
 if(typeof request!=="function")abort("TRANSPORT_MISSING");
 const {baseline,next}=sources();
 const readRelease=async()=>{
  const result=await request("GET",RELEASE);
  if(result?.name!==RELEASE||![OLD,STAGED].includes(result.rulesetName))
   abort("LIVE_RELEASE_UNKNOWN");
  return result.rulesetName;
 };
 const readSource=async(name)=>{
  if(![OLD,STAGED].includes(name))abort("FOREIGN_RULESET");
  return source(await request("GET",name));
 };
 const old=await readSource(OLD),staged=await readSource(STAGED);
 if(old!==baseline||staged!==next)abort("LIVE_SOURCE_DRIFT");
 const active=await readRelease();
 if(mode==="inspect"){
  return Object.freeze({
   inspected:true,mode,oldSourceVerified:true,stagedSourceVerified:true,
   activeIsOriginal:active===OLD,activeIsStaged:active===STAGED,
   productionDocumentWrites:0,releaseUpdated:false,
   realAccountFinanceProof:false
  });
 }
 if(operatorApproval!==true)abort("EXPLICIT_OPERATOR_APPROVAL_REQUIRED");
 if(mode==="rollback"){
  if(active===OLD)return {mode,alreadyOriginal:true,releaseUpdated:false};
  if((await readRelease())!==STAGED)abort("CONCURRENT_RELEASE_CHANGED");
  await request("PATCH",RELEASE,patchBody(OLD));
  if((await readRelease())!==OLD)abort("ROLLBACK_NOT_VERIFIED");
  return {mode,releaseUpdated:true,returnedToOriginal:true,
   productionDocumentWrites:0};
 }
 if(!functionsReady||!realBackup(backup)||
    ownerBeforeAttested!==true||partnerCountsBeforeAttested!==true)
  abort("APPLY_PRECONDITIONS_MISSING");
 if(active!==OLD)abort("ALREADY_ACTIVATED_OR_RACED");
 if((await readRelease())!==OLD)abort("LIVE_RELEASE_CHANGED");
 let patchAttempted=false;
 try{
  patchAttempted=true;
  await request("PATCH",RELEASE,patchBody(STAGED));
  if((await readRelease())!==STAGED)abort("STAGED_RELEASE_NOT_READ_BACK");
  if((await readSource(STAGED))!==next)abort("STAGED_SOURCE_CHANGED");
  return Object.freeze({mode,releaseUpdated:true,
   stagedRulesNowLive:true,productionDocumentWrites:0,
   userRealPartnerDeniedProved:false,ownerPostSwitchVerified:false,
   furtherLiveUserVerificationRequired:true});
 }catch(e){
  if(patchAttempted){
   let now;
   try{now=await readRelease();}catch{abort("UNKNOWN_LIVE_STATE_MANUAL_RECOVERY");}
   if(now===STAGED){
    try{
     await request("PATCH",RELEASE,patchBody(OLD));
     if((await readRelease())!==OLD)abort("AUTOMATIC_ROLLBACK_UNVERIFIED");
    }catch{abort("ROLLBACK_UNVERIFIED_NEEDS_MANUAL_RECOVERY");}
   }else if(now!==OLD)abort("CONCURRENT_RELEASE_MANUAL_REVIEW");
  }
  throw e;
 }
}
export const PINNED=Object.freeze({project:PROJECT,release:RELEASE,
 original:OLD,staged:STAGED,candidateSha256:EXPECTED_CANDIDATE_SHA});
