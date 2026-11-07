#!/usr/bin/env node
/**
 * Production secondary-membership safety inventory; READ ONLY, aggregate output.
 * Never returns IDs/emails/names/amounts, changes authentication/Rules, or
 * issues write operations. Admin SDK is used only for bounded GETs.
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {inspect as inspectBackups} from './inspect-firestore-backups-readonly.mjs';

const PROJECT='sales-management-cc116';
const LIMIT=200;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const RULESET=/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/;
const abort=code=>{throw Error('STOP_SECONDARY_INVENTORY_'+code);};
const sha=v=>createHash('sha256').update(v.replace(/\r\n/g,'\n').trim()).digest('hex');
// Fixed reviewed sources; SHA/Blob prove EXACT live source bytes, not a UI switch.
const sourceFingerprint='d1d9998d874a1a31c81ddf6996e08cd9de3a3d13bd684e245140bf03cab32179';
const reviewedPhase1GitBlob='6d6ac7fd3544b0326823e419a3acd7e1d060b714';
const originalMainGitBlob='d9f4df6a2ac0f8b5720534a2461ec66b94379190';
const sha1Blob=v=>createHash('sha1').update('blob '+Buffer.byteLength(v,'utf8')+'\\0').update(v,'utf8').digest('hex');

/** Static classification ONLY. A matching rule candidate is NOT real-user proof. */
export function classifyLiveRules(source){
 if(typeof source!=='string'||source.length<100||source.length>200000)abort('UNVERIFIED_RULES_SOURCE');
 const blob=sha1Blob(source);
 return Object.freeze({
  exactReviewedPhase1Boundary:blob===reviewedPhase1GitBlob,
  exactOriginalMainRules:blob===originalMainGitBlob,
  matchesReviewedLegacyLive:sha(source)===sourceFingerprint,
  // Never promote any of these source checks to a real Owner/Partner token proof.
  actualAuthenticatedBoundaryVerified:false
 });
}
/** Presence of backups != freshness/restore: never use a stale READY snapshot. */
export function hasRecentReadyBackup(backup,nowMs=Date.now()){
 const time=Date.parse(backup?.latestReadySnapshot||'');
 const age=nowMs-time;
 return Number.isSafeInteger(backup?.readyBackups)&&backup.readyBackups>0&&
  Number.isFinite(nowMs)&&Number.isFinite(age)&&age>=0&&age<=48*60*60*1000;
}
const internalType=x=>x===undefined||x==='internal'||x==='direct';
const legacyType=x=>x===undefined||['internal','direct','member','managed'].includes(x);
const validPartnerName=x=>typeof x==='string'&&/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u.test(x.trim())&&
 !/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/.test(x);
const internalKind=x=>x===undefined||x==='internal'||x==='direct';
const internalAccess=x=>x===undefined||x==='internal';

export function classifySecondary({context,user,oldMember,oldCompany,partnerMember,partnerCompany}){
 const exists=!!context&&!!user&&!!oldMember&&!!oldCompany&&!!partnerMember&&!!partnerCompany;
 if(!exists)return 'broken';
 if(context.kind!=='partner_secondary'||context.active!==true)return 'inactive_or_unrecognized';
 if(!ID.test(context.primaryCompanyId||'')||!ID.test(context.partnerCompanyId||'')||
    context.primaryCompanyId===context.partnerCompanyId||
    user.companyId!==context.primaryCompanyId||
    oldMember.active===false||user.active===false||oldCompany.active===false||
    !internalKind(oldCompany.companyKind)||
    !internalAccess(user.accessKind)||!internalAccess(oldMember.accessKind)||
    !legacyType(user.memberType)||!legacyType(oldMember.memberType)||
    partnerCompany.companyKind!=='partner'||
    partnerCompany.active===false||
    partnerMember.active===false||
    partnerMember.accessKind!=='partner'||partnerMember.memberType!=='cooperator')
    return 'broken';
 if(oldCompany.ownerUid===context.uid||oldCompany.masterUid===context.uid||
    user.companyRole==='owner'||oldMember.companyRole==='owner')
    return 'owner_conflict';
 // Firestore current isCompanyMember() allows an internal member to read full
 // products/records even if canViewRevenue is false.
 return 'internal_finance_read_path';
}

/**
 * Strict dry-run only. A primary conversion must never be issued solely from
 * this boolean; the user's live client session and immutable backup remain
 * separate deployment gates.
 */
export function transferEligibility({context,user,oldMember,oldCompany,
 partnerMember,partnerCompany,relation,staff,team,archived,auth}){
 if(classifySecondary({context,user,oldMember,oldCompany,partnerMember,partnerCompany})!=='internal_finance_read_path')
  return false;
 if(context.primaryCompanyId!==context.hubCompanyId||
    partnerCompany.hubCompanyId!==context.hubCompanyId||
    partnerCompany.ownerUid===context.uid||
    oldCompany.ownerUid===context.uid||oldCompany.masterUid===context.uid||
    user.companyRole==='owner'||oldMember.companyRole==='owner'||
    (user.companyRole!=null&&user.companyRole!=='member')||
    (oldMember.companyRole!=null&&oldMember.companyRole!=='member')||
    user.uid!==context.uid||user.companyId!==context.primaryCompanyId||
    oldMember.uid!=null&&oldMember.uid!==context.uid||
    oldMember.companyId!=null&&oldMember.companyId!==context.primaryCompanyId||
    user.active!==true||oldMember.active!==true||
    (user.email&&user.email.trim().toLowerCase()!==context.emailLower)||
    (oldMember.email&&oldMember.email.trim().toLowerCase()!==context.emailLower)||
    !['leader','member'].includes(context.role)||
    context.role!==partnerMember.role||!ID.test(context.teamId||'')||
    partnerMember.teamId!==context.teamId||
    partnerMember.companyRole!=='member'||partnerMember.uid!==context.uid||
    partnerMember.companyId!==context.partnerCompanyId||
    partnerMember.canViewRevenue!==false||partnerMember.canViewUnitPrice!==false||
    partnerMember.canCreateInvite===true||
    !validPartnerName(partnerMember.name)||
    !relation||relation.active!==true||relation.countSharingApproved!==true||
    relation.hubCompanyId!==context.hubCompanyId||
    relation.partnerCompanyId!==context.partnerCompanyId||
    !staff||staff.kind!=='account'||staff.uid!==context.uid||
    staff.active!==true||staff.companyId!==context.partnerCompanyId||
    staff.role!==context.role||staff.teamId!==context.teamId||
    !team||team.companyId!==context.partnerCompanyId||team.active!==true||
    archived===true||
    !auth||auth.disabled===true||auth.emailVerified!==true||
    typeof auth.email!=='string'||auth.email.toLowerCase()!==context.emailLower)
    return false;
 return true;
}

async function bounded(db,name,fields){
 const snap=await db.collection(name).select(...fields).limit(LIMIT+1).get();
 if(snap.size>LIMIT)abort('SCAN_CAP');
 return snap.docs;
}
async function doc(db,name,id,fields){
 if(!ID.test(id||''))abort('IDENTIFIER');
 const parts=name.split('/').filter(Boolean);
 let ref=db.collection(parts[0]).doc(parts[1]||id);
 if(parts.length===3)ref=ref.collection(parts[2]).doc(id);
 return (await ref.get()).data()||null;
}
function refDoc(db,name,id){
 if(!ID.test(id||''))abort('IDENTIFIER');
 return db.collection(name).doc(id);
}
async function getRulesClassification(credential,request=fetch){
 const {access_token:token}=await credential.getAccessToken();
 if(!token)abort('RULES_TOKEN');
 const root='https://firebaserules.googleapis.com/v1/';
 const requestJson=async endpoint=>{
  const r=await request(endpoint,{method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token}});
  if(!r.ok)abort('RULES_HTTP_'+r.status);
  return r.json();
 };
 const release=await requestJson(root+'projects/'+PROJECT+'/releases/cloud.firestore');
 if(!RULESET.test(release.rulesetName||''))abort('RULESET_NAME');
 const current=await requestJson(root+release.rulesetName);
 if(!Array.isArray(current?.source?.files)||current.source.files.length!==1||
    typeof current.source.files[0].content!=='string')abort('RULESET_CONTENT');
 return classifyLiveRules(current.source.files[0].content);
}

export async function inventory({db,credential,authService,request=fetch,includeBackup=true}){
 if(!db||!credential||!authService)abort('MISSING_DEPENDENCY');
 const [contexts,companies,transfers]=await Promise.all([
  bounded(db,'partnerWorkspaceContexts',['uid','kind','active','primaryCompanyId',
   'partnerCompanyId','hubCompanyId','role','teamId','emailLower']),
  bounded(db,'companies',['companyKind','ownerUid','masterUid','active','hubCompanyId']),
  bounded(db,'partnerHistoricalTransfers',['uid','sourceCompanyId','destinationCompanyId'])
 ]);
 const values={totalContexts:contexts.length,activeSecondaryContexts:0,
  ownerConflicts:0,nonOwnerOldFinancePaths:0,inactiveOrUnknownContexts:0,
  inconsistentContexts:0,internalOwnersScanned:0,internalOwnerContexts:0,
  historicalTransfersPresent:transfers.length,transferEligibleCandidates:0,transferNeedsReview:0};
 for(const c of contexts){
  const x=c.data()||{};
  if(x.uid!==c.id||!ID.test(c.id)||!ID.test(x.primaryCompanyId||'')||
     !ID.test(x.partnerCompanyId||''))abort('CONTEXT_SCHEMA');
  const [user,oldMember,oldCompany,partnerMember,partnerCompany,relation,staff,team,archive,auth]=await Promise.all([
   refDoc(db,'users',c.id).get().then(s=>s.data()||null),
   db.collection('companies').doc(x.primaryCompanyId).collection('members').doc(c.id).get().then(s=>s.data()||null),
   refDoc(db,'companies',x.primaryCompanyId).get().then(s=>s.data()||null),
   db.collection('companies').doc(x.partnerCompanyId).collection('members').doc(c.id).get().then(s=>s.data()||null),
   refDoc(db,'companies',x.partnerCompanyId).get().then(s=>s.data()||null),
   refDoc(db,'partnerRelations',x.partnerCompanyId).get().then(s=>s.data()||null),
   db.collection('companies').doc(x.partnerCompanyId).collection('partnerWorkStaff').doc(c.id).get().then(s=>s.data()||null),
   ID.test(x.teamId||'')?
    db.collection('companies').doc(x.partnerCompanyId).collection('partnerWorkTeams').doc(x.teamId).get().then(s=>s.data()||null):
    Promise.resolve(null),
   refDoc(db,'partnerHistoricalTransfers',c.id).get().then(s=>s.exists),
   authService.getUser(c.id).then(a=>({email:a.email,emailVerified:a.emailVerified,disabled:a.disabled}))
  ]);
  const kind=classifySecondary({context:x,user,oldMember,oldCompany,partnerMember,partnerCompany});
  if(kind==='internal_finance_read_path'){
   const eligible=transferEligibility({context:x,user,oldMember,oldCompany,partnerMember,
     partnerCompany,relation,staff,team,archived:archive,auth});
   if(eligible)values.transferEligibleCandidates++;
   else values.transferNeedsReview++;
  }
  if(kind==='owner_conflict'){values.ownerConflicts++;values.activeSecondaryContexts++;}
  else if(kind==='internal_finance_read_path'){values.nonOwnerOldFinancePaths++;values.activeSecondaryContexts++;}
  else if(kind==='inactive_or_unrecognized')values.inactiveOrUnknownContexts++;
  else values.inconsistentContexts++;
 }
 for(const c of companies){
  const x=c.data()||{};
  if(!internalKind(x.companyKind)||x.active===false)continue;
  if(!ID.test(x.ownerUid||''))abort('INTERNAL_OWNER_ID');
  values.internalOwnersScanned++;
  const [user,member,ctx]=await Promise.all([
   refDoc(db,'users',x.ownerUid).get(),
   db.collection('companies').doc(c.id).collection('members').doc(x.ownerUid).get(),
   refDoc(db,'partnerWorkspaceContexts',x.ownerUid).get()
  ]);
  if(ctx.exists)values.internalOwnerContexts++;
  if(!user.exists||!member.exists||user.data().companyId!==c.id||
     !internalAccess(user.data().accessKind)||
     !internalAccess(member.data().accessKind)||
     !legacyType(user.data().memberType)||
     !legacyType(member.data().memberType))abort('INTERNAL_OWNER_MEMBERSHIP');
 }
 const rules=await getRulesClassification(credential,request);
 const backup=includeBackup?await inspectBackups():null;
 return Object.freeze({
  project:PROJECT,mode:'READ_ONLY',productionWrites:0,
  ...values,
  rulesFingerprintMatchesLastReviewed:rules.matchesReviewedLegacyLive,
  exactReviewedPhase1RulesActive:rules.exactReviewedPhase1Boundary,
  liveRulesSourceUnrecognized:!rules.matchesReviewedLegacyLive&&
   !rules.exactReviewedPhase1Boundary&&!rules.exactOriginalMainRules,
  // Rule presence is NOT evidence that the affected partner's USER token is denied.
  rulesSourceOnlyNeverRealUserProof:true,
  readyBackups:backup?.readyBackups??null,
  recentReadyBackupWithin48h:hasRecentReadyBackup(backup),
  latestBackupExists:Boolean(backup?.latestReadySnapshot),
  // Structural audit does not test with real partner UID.
  realPartnerFinanceDenyVerified:false,
  liveOwnerLoginVerified:false,
  safeToMigrate:false,safeToDeploy:false
 });
}
/** Public Actions logs never include individual account counts or stable
 * identifiers: one secondary UID can otherwise be re-identified in a small
 * workplace. Detailed evidence stays in memory for fail-closed decisions.
 */
export function publicInventorySummary(result){
 return Object.freeze({
  project:PROJECT,mode:'READ_ONLY',productionWrites:0,
  secondaryContextsPresent:Boolean(result.totalContexts),
  oldInternalFinancePathPresent:Boolean(result.nonOwnerOldFinancePaths),
  ownerContextConflictPresent:Boolean(result.ownerConflicts||result.internalOwnerContexts),
  unrecognizedContextPresent:Boolean(result.inactiveOrUnknownContexts||result.inconsistentContexts),
  unapprovedTransferPresent:Boolean(result.transferNeedsReview),
  transferCandidatePresent:Boolean(result.transferEligibleCandidates),
  historicalTransferPresent:Boolean(result.historicalTransfersPresent),
  rulesFingerprintMatchesLastReviewed:result.rulesFingerprintMatchesLastReviewed===true,
  readyBackupPresent:Number.isInteger(result.readyBackups)&&result.readyBackups>0,
  latestBackupExists:result.latestBackupExists===true,
  recentReadyBackupWithin48h:result.recentReadyBackupWithin48h===true,
  exactReviewedPhase1RulesActive:result.exactReviewedPhase1RulesActive===true,
  liveRulesSourceUnrecognized:result.liveRulesSourceUnrecognized===true,
  authenticatedBoundaryProofStillRequired:true,
  realPartnerFinanceDenyVerified:false,liveOwnerLoginVerified:false,
  safeToMigrate:false,safeToDeploy:false
 });
}
async function main(){
 if(process.env.NICO_SECONDARY_INVENTORY_MODE!=='READ_ONLY'||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    JSON.parse(readFileSync('.firebaserc','utf8')).projects.default!==PROJECT)
   abort('PRODUCTION_READ_GATE');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const {applicationDefault,initializeApp}=require('firebase-admin/app');
 const {getFirestore}=require('firebase-admin/firestore');
 const {getAuth}=require('firebase-admin/auth');
 const credential=applicationDefault();
 initializeApp({credential,projectId:PROJECT});
 const result=await inventory({db:getFirestore(),credential,authService:getAuth()});
 console.log('NICO_SECONDARY_READ_ONLY '+JSON.stringify(publicInventorySummary(result)));
 // A successful inventory is not a deploy authorization.
 if(result.ownerConflicts||result.internalOwnerContexts)console.log('BLOCK_OWNER_SECONDARY_CONTEXT');
 if(result.nonOwnerOldFinancePaths)console.log('BLOCK_PARTNER_OLD_FINANCE_READ_PATH');
 if(result.inconsistentContexts)console.log('BLOCK_SECONDARY_CONTEXT_INVALID');
 if(!result.exactReviewedPhase1RulesActive)console.log('BLOCK_PHASE1_FINANCE_BOUNDARY_NOT_ACTIVE');
 if(result.liveRulesSourceUnrecognized)console.log('BLOCK_LIVE_RULESET_UNRECOGNIZED');
 if(!result.recentReadyBackupWithin48h)console.log('BLOCK_RECENT_READY_BACKUP_NOT_VERIFIED');
 if(result.transferNeedsReview)console.log('BLOCK_TRANSFER_PRECONDITION');
 if(result.transferEligibleCandidates)console.log('TRANSFER_CANDIDATE_FOUND__NO_WRITES');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{console.error(/^STOP_SECONDARY_INVENTORY_[A-Z0-9_]+$/.test(e.message)?e.message:'STOP_SECONDARY_INVENTORY_UNVERIFIED');process.exitCode=1;});
}
