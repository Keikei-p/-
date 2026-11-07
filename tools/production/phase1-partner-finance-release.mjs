/**
 * Phase-1 finance boundary: exact-source Rules switch engine (NOT DEPLOYED).
 * LIBRARY ONLY: no CLI or GitHub action can use live credentials in this PR.
 * Requires an exactly matching approved legacy source and candidate, a full
 * production snapshot restored to a separate local emulator, and independent
 * production account checks against a candidate emulator before a switch,
 * plus live checks immediately after any switch before reporting success.
 */
import {createHash} from 'node:crypto';
import {PROJECT,validateSafeCall,fingerprint} from '../readonly-backup/backup.mjs';

export const BASELINE_GIT_BLOB='d9f4df6a2ac0f8b5720534a2461ec66b94379190';
export const PHASE1_GIT_BLOB='6d6ac7fd3544b0326823e419a3acd7e1d060b714';
const RULES_ROOT='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
const RELEASE=RULES_ROOT+'/releases/cloud.firestore';
const NAME='projects/'+PROJECT+'/releases/cloud.firestore';
const RULESET=/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/;
const stop=code=>{throw Error('STOP_PHASE1_'+code);};
const normalized=s=>s.replace(/\r\n/g,'\n').trim();
const digest=s=>createHash('sha256').update(normalized(s)).digest('hex');
const blob=s=>createHash('sha1')
 .update('blob '+Buffer.byteLength(s,'utf8')+'\0')
 .update(s,'utf8').digest('hex');
function exactSources(old,candidate){
 if(typeof old!=='string'||blob(old)!==BASELINE_GIT_BLOB)stop('BASELINE_UNREVIEWED');
 if(typeof candidate!=='string'||blob(candidate)!==PHASE1_GIT_BLOB)stop('CANDIDATE_UNREVIEWED');
 const stripped=normalized(candidate);
 for(const marker of ['function noSecondaryPartnerWorkspace()',
  'match /products/{productId}', 'match /records/{recordId}',
  'match /recordCorrections/{correctionId}','match /linePairingCodes/{pairingCode}',
  'match /teams/{teamId}'])
  if(!stripped.includes(marker))stop('CANDIDATE_CONTRACT');
 return {old:digest(old),candidate:digest(candidate)};
}
/** Fixed-project API allowlist, never a generic Firestore proxy. */
export function allowedPhase1Request(method,url,body,candidateSha){
 if(validateSafeCall(method,url,body))return true;
 if(method==='GET'&&body===undefined){
  if(url===RELEASE)return true;
  const prefix='https://firebaserules.googleapis.com/v1/';
  return url.startsWith(prefix)&&RULESET.test(url.slice(prefix.length));
 }
 if(method==='POST'&&url===RULES_ROOT+'/rulesets'){
  const f=body?.source?.files;
  return Object.keys(body||{}).join()==='source'&&
   Object.keys(body?.source||{}).join()==='files'&&
   Array.isArray(f)&&f.length===1&&f[0].name==='firestore.rules'&&
   typeof f[0].content==='string'&&
   digest(f[0].content)===candidateSha;
 }
 if(method==='PATCH'&&url===RELEASE){
  return Object.keys(body||{}).sort().join()==='release,updateMask'&&
   body.updateMask==='rulesetName'&&
   Object.keys(body.release||{}).sort().join()==='name,rulesetName'&&
   body.release.name===NAME&&RULESET.test(body.release.rulesetName||'');
 }
 return false;
}
/**
 * All external calls are injected and denied unless narrowly allowlisted.
 * apply defaults false. No real production invocation is supplied here.
 * A Firestore REST inventory restore is NOT a managed-backup restoration.
 */
export async function phase1Boundary({
 request,snapshot,restore,backup,reviewedBaseline,reviewedCandidate,
 apply=false,approval=false,candidateEmulatorVerified=false,
 realOwnerBeforeVerified=false,backupReviewed=false,
 verifyLiveRoles=null,preApplyCheck=null,log=()=>{},now=()=>Date.now()
}={}){
 if(typeof request!=='function'||typeof snapshot!=='function'||
    typeof restore!=='function'||typeof backup!=='function'||
    typeof log!=='function'||typeof now!=='function')stop('DEPENDENCIES');
 const hashes=exactSources(reviewedBaseline,reviewedCandidate);
 // A real partner's live finance request is expected to be ALLOWED under
 // the previous vulnerable Rules; demanding a live denial pre-switch is
 // impossible. Candidate proof is an independently reviewed emulator gate.
 // Real live partner get/list denial is checked IMMEDIATELY AFTER the switch.
 if(apply&&(!approval||!candidateEmulatorVerified||!realOwnerBeforeVerified||
    !backupReviewed||typeof verifyLiveRoles!=='function'||
    typeof preApplyCheck!=='function'))
  stop('MISSING_PRODUCTION_APPROVAL');
 const call=async(method,url,body)=>{
  if(!allowedPhase1Request(method,url,body,hashes.candidate))stop('API_NOT_ALLOWED');
  return request(method,url,body);
 };
 const getRelease=async()=>{
  const release=await call('GET',RELEASE);
  if(!RULESET.test(release?.rulesetName||''))stop('LIVE_RELEASE');
  return release.rulesetName;
 };
 const getSource=async ruleset=>{
  if(!RULESET.test(ruleset||''))stop('RULESET_ID');
  const response=await call('GET','https://firebaserules.googleapis.com/v1/'+ruleset);
  if(response?.source?.files?.length!==1||
     response.source.files[0].name!=='firestore.rules'||
     typeof response.source.files[0].content!=='string')stop('LIVE_SOURCE');
  return response.source.files[0].content;
 };
 const starting=await getRelease();
 const live=await getSource(starting);
 const liveHash=digest(live);
 if(liveHash!==hashes.old&&liveHash!==hashes.candidate)
  stop('UNREVIEWED_LIVE_RULES');
 if(liveHash===hashes.old&&normalized(live)!==normalized(reviewedBaseline))
  stop('LIVE_BASELINE_PARITY');
 if(liveHash===hashes.candidate&&normalized(live)!==normalized(reviewedCandidate))
  stop('LIVE_CANDIDATE_PARITY');
 // A long inventory or emulator restore must not silently age a reviewed
 // managed backup past 48 hours. This callback is read-only, and a failure
 // cannot publish, change or roll back the active production Rules release.
 const requireRecentManagedBackup=async()=>{
  const managed=await backup();
  const checkedAt=now();
  const age=checkedAt-Date.parse(managed?.latestReadySnapshot||'');
  if(!Number.isInteger(managed?.readyBackups)||managed.readyBackups<1||
     !Number.isFinite(checkedAt)||!Number.isFinite(age)||
     age<0||age>48*60*60*1000)
   stop('RECENT_BACKUP_REQUIRED');
 };
 await requireRecentManagedBackup();
 const before=await snapshot();
 const inventory=fingerprint(before);
 if(!before.documents.length)stop('EMPTY_INVENTORY');
 const restored=await restore(before);
 if(restored?.fieldsAndIdsVerified!==true||restored.productionTouched!==false||
    restored.documentCount!==before.documents.length||
    restored.sourceInventoryFingerprint!==inventory)
  stop('ISOLATED_RESTORE_UNVERIFIED');
 if(fingerprint(await snapshot())!==inventory)stop('INVENTORY_CHANGED');
 if((await getRelease())!==starting)stop('RULES_RELEASE_RACE');
 const summary=Object.freeze({
  project:PROJECT,documents:before.documents.length,
  inventorySha256:inventory,oldRulesSha256:liveHash,
  reviewedCandidateSha256:hashes.candidate,
  isolatedFieldsAndIdsRestored:true,
  managedBackupRestored:false,metadataTimestampsRestored:false,
  productionDocumentWrites:0,
  reviewedOwnerBeforeSwitch:realOwnerBeforeVerified===true,
  reviewedCandidateEmulatorBoundary:candidateEmulatorVerified===true,
  reviewedRealPartnerFinanceDeny:false,postSwitchRoleVerified:false,
  reviewedPartnerCountViewBeforeSwitch:false,
  reviewedPartnerCountViewAfterSwitch:false,
  applied:false
 });
 log(summary);
 if(!apply)return summary;
 // Already-present Rules must still pass real account checks before a
 // positive verification result; do not roll back a Ruleset we did not set.
 const validateLiveRoles=async()=>{
  const result=await verifyLiveRoles({
   expectedRulesSha256:hashes.candidate,
   releaseName:NAME
  });
  if(result?.checkedAgainst!=='production-live'||
     result.partnerDocumentDenied!==true||result.partnerListDenied!==true||
     result.ownerFinanceAllowed!==true)stop('POST_SWITCH_ROLE_UNVERIFIED');
  if(result.partnerCountViewAllowed!==true)
   stop('POST_SWITCH_COUNT_VIEW_UNVERIFIED');
  return {postSwitchRoleVerified:true,
   reviewedRealPartnerFinanceDeny:true,reviewedLiveOwnerFinanceRead:true,
   reviewedPartnerCountViewAfterSwitch:true};
 };
 if(liveHash===hashes.candidate){
  const roles=await validateLiveRoles();
  // A concurrent operator can replace the release during the real user
  // checks. Never report that the reviewed candidate is still active based
  // only on the earlier source read; do not roll back a release we did not set.
  if((await getRelease())!==starting)stop('POST_PROOF_RULES_RELEASE_RACE');
  return {...summary,...roles,applied:false,
   alreadyAtReviewedCandidate:true,reviewedRulesPresent:true};
 }
 let created=null,attempted=false;
 const point=async rulesetName=>call('PATCH',RELEASE,{
  release:{name:NAME,rulesetName},updateMask:'rulesetName'
 });
 try{
  created=await call('POST',RULES_ROOT+'/rulesets',{
   source:{files:[{name:'firestore.rules',content:reviewedCandidate}]}
  });
  if(!RULESET.test(created?.name||''))stop('NEW_RULESET_INVALID');
  if((await getRelease())!==starting)stop('RULES_RELEASE_RACE');
  if(fingerprint(await snapshot())!==inventory)stop('INVENTORY_CHANGED_BEFORE_APPLY');
  // The backup + isolation scan can take several minutes. Do not flip
  // production Rules on a stale Owner / affected-partner user session.
  // This is the last gate, directly before the *first* release PATCH; a
  // failure leaves the existing live Rules untouched. Its result contains
  // no user IDs, amounts, document bodies or authentication credentials.
  const ready=await preApplyCheck();
  if(ready?.checkedAgainst!=='production-live'||
     ready?.ownerFinanceAllowed!==true||
     ready?.affectedSecondaryBound!==true||
     ready?.partnerSessionFresh!==true)
    stop('PRE_SWITCH_ACCOUNT_UNVERIFIED');
  if(ready?.partnerCountViewAllowed!==true)
    stop('PRE_SWITCH_COUNT_VIEW_UNVERIFIED');
  // A live rep may submit an actual count while Owner + partner identity
  // are being rechecked. Switching against that stale inventory would make
  // the release look successful briefly and then force rollback. Fail BEFORE
  // the active Rules PATCH instead, without touching the newly saved count.
  if((await getRelease())!==starting)stop('RULES_RELEASE_RACE_BEFORE_PATCH');
  if(fingerprint(await snapshot())!==inventory)
    stop('LIVE_COUNT_OR_FINANCE_CHANGED_BEFORE_PATCH');
  // Last irreversible boundary: recheck the managed backup's READY status
  // and 48-hour freshness *after* the final account and inventory checks.
  // Do not trust a timestamp cached before a slow local restore.
  await requireRecentManagedBackup();
  attempted=true;
  await point(created.name);
  if((await getRelease())!==created.name||
     digest(await getSource(created.name))!==hashes.candidate)
    stop('RELEASE_READBACK_FAILED');
  if(fingerprint(await snapshot())!==inventory)stop('INVENTORY_CHANGED_AFTER_APPLY');
  const roleResult=await validateLiveRoles();
  // A successful GET/LIST proof is stale if the active Rules release moved
  // while those requests ran. The catch block preserves concurrent releases.
  if((await getRelease())!==created.name)stop('POST_PROOF_RULES_RELEASE_RACE');
  return {...summary,...roleResult,
   reviewedPartnerCountViewBeforeSwitch:true,
   applied:true,rollbackRuleset:starting,
   currentRuleset:created.name};
 }catch(error){
  if(attempted){
   const current=await getRelease();
   if(current===created.name){
    await point(starting);
    if((await getRelease())!==starting)stop('ROLLBACK_READBACK_FAILED');
    log({rulesRolledBack:true,productionDocumentWrites:0});
   }else if(current!==starting)stop('CONCURRENT_OPERATOR_MANUAL_REVIEW');
  }
  throw error;
 }
}
