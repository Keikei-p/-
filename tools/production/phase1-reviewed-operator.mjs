/**
 * Exact-reviewed Phase-1 production operator CLI (LOCAL / MANUAL ONLY).
 *
 * No workflow_dispatch, cron or automatic deploy is connected here.
 * The only possible live mutation in --apply is the reviewed Rules release
 * switch; underlying engine restores prior Rules after failed post-proofs.
 * NEVER prints credentials, Firestore paths, user IDs, records or amounts.
 *
 * Verify:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> ... node <script> verify
 * Apply:
 *   The same, plus a private 0600 JSON proof file outside the repository,
 *   independent human signoff and approved exact source/candidate digests.
 *
 * This CLI does NOT replace the independent review or actual real-account
 * access evidence and remains NO DEPLOY while in a Draft PR.
 */
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collect,PROJECT} from '../readonly-backup/backup.mjs';
import {restoreToLocalEmulator} from '../readonly-backup/restore-emulator.mjs';
import {inspect} from './inspect-firestore-backups-readonly.mjs';
import {
  phase1Boundary,allowedPhase1Request,BASELINE_GIT_BLOB,PHASE1_GIT_BLOB
} from './phase1-partner-finance-release.mjs';
import {phase1WithLiveAccountGate} from './phase1-live-proof-bridge.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const REVIEWED_MAIN='17681e69d3ebd7271cc9a58e138fd0e202db7294';
const VERIFIED_APPROVAL='INDEPENDENT_REVIEW_OF_PHASE1_RULES_AND_LIVE_IDENTITIES_COMPLETE';
const USAGE_APPROVAL='EXISTING_FUNCTIONS_AND_FULL_INVENTORY_APPROVED';
const OWN_KEYS=['ownerIdToken','partnerIdToken','expectedOwnerUid','expectedPartnerUid',
  'internalCompanyId','partnerCompanyId','productId','recordId'];
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const SHA=/^[a-f0-9]{40}$/;
const RUN_ID=/^[1-9][0-9]{0,14}$/;
// The reviewed GitHub repository is the only approved provenance. A local
// remote pointing elsewhere must not spoof the pinned main SHA.
const REVIEWED_ORIGINS=new Set([
  'https://github.com/Keikei-p/-.git',
  'https://github.com/Keikei-p/-',
  'git@github.com:Keikei-p/-.git',
  'git@github.com:Keikei-p/-',
  'ssh://git@github.com/Keikei-p/-.git'
]);
const stop=code=>{throw Error('STOP_PHASE1_OPERATOR_'+code);};
const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function validateOperatorIntent({mode,env,proof}){
 if(!['verify','apply'].includes(mode)||!obj(env)||
    env.FIREBASE_PROJECT_ID!==PROJECT||
    env.NICO_USAGE_APPROVAL!==USAGE_APPROVAL||
    typeof env.FIRESTORE_EMULATOR_HOST!=='string'||
    !/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(env.FIRESTORE_EMULATOR_HOST)||
    Number(env.FIRESTORE_EMULATOR_HOST.split(':')[1])>65535)
   stop('OFFLINE_PREFLIGHT');
 if(mode==='verify')return Object.freeze({apply:false});
 if(!SHA.test(env.NICO_PHASE1_REVIEWED_CHECKOUT_SHA||'')||
    !RUN_ID.test(env.NICO_PHASE1_REVIEWED_CI_RUN_ID||'')||
    env.NICO_PHASE1_INDEPENDENT_SIGNOFF!==VERIFIED_APPROVAL||
    env.NICO_PHASE1_REVIEWED_MAIN_SHA!==REVIEWED_MAIN||
    env.NICO_PHASE1_REVIEWED_BASELINE_BLOB!==BASELINE_GIT_BLOB||
    env.NICO_PHASE1_REVIEWED_CANDIDATE_BLOB!==PHASE1_GIT_BLOB||
    !obj(proof)||Object.keys(proof).sort().join(',')!==OWN_KEYS.slice().sort().join(',')||
    OWN_KEYS.some(key=>typeof proof[key]!=='string'||proof[key].length===0)||
    !['expectedOwnerUid','expectedPartnerUid','internalCompanyId',
      'partnerCompanyId','productId','recordId'].every(key=>ID.test(proof[key]))||
    proof.expectedOwnerUid===proof.expectedPartnerUid||
    proof.internalCompanyId===proof.partnerCompanyId||
    proof.ownerIdToken===proof.partnerIdToken)
   stop('INDEPENDENT_SIGNOFF_OR_REAL_ACCOUNTS_REQUIRED');
 return Object.freeze({apply:true});
}


/**
 * A typed approval is not enough: only a clean, exact GitHub checkout with
 * a successful CI run for that same commit is eligible for production.
 * git ls-remote reads the current main without modifying the checkout.
 * gh uses the operator's own GitHub identity, not a secret passed to the CLI.
 * Injected functions are for offline contract tests, never the live CLI.
 */
export function assertReviewedCodeGate({env,git,gh}){
 if(!obj(env)||typeof git!=='function'||typeof gh!=='function'||
    !SHA.test(env.NICO_PHASE1_REVIEWED_CHECKOUT_SHA||'')||
    !RUN_ID.test(env.NICO_PHASE1_REVIEWED_CI_RUN_ID||''))
   stop('REVIEWED_CODE_EVIDENCE_REQUIRED');
 let local,dirty,main,run,origin;
 try{
  local=git('rev-parse',['HEAD']).trim();
  // Ignore build/cache files by .gitignore, but reject untracked files that
  // could replace imported code or hide an unreviewed proof input.
  dirty=git('status',['--porcelain','--untracked-files=normal']);
  origin=git('remote',['get-url','origin']).trim();
  main=git('ls-remote',['--exit-code','origin','refs/heads/main']);
  run=JSON.parse(gh('run',['view',env.NICO_PHASE1_REVIEWED_CI_RUN_ID,
   '--repo','Keikei-p/-','--json','headSha,conclusion,event,name']));
 }catch{stop('REVIEWED_CODE_CHECK_UNAVAILABLE');}
 const matches=/^([a-f0-9]{40})\s+refs\/heads\/main\s*$/.exec(main);
 if(local!==env.NICO_PHASE1_REVIEWED_CHECKOUT_SHA||
    dirty.trim()!==''||!REVIEWED_ORIGINS.has(origin)||
    !matches||matches[1]!==REVIEWED_MAIN||
    run?.headSha!==local||run?.conclusion!=='success'||
    run?.event!=='push'||
    run?.name!=='NICO affected secondary identity + finance boundary (NO DEPLOY)')
  stop('REVIEWED_SOURCE_OR_CI_DRIFT');
 return Object.freeze({sourceReviewed:true,ciForExactCheckout:true,mainUnchanged:true});
}

/**
 * Independently reviewed *means a real GitHub-approved review from another
 * authorized human on this exact release commit*. A local typed signoff
 * value or green CI run alone cannot establish this. Never trust JSON
 * supplied via environment variables as review evidence.
 *
 * This checks GitHub's authenticated REST API read-only and runs BEFORE
 * reading service-account credentials or any production data.
 */
export function assertIndependentPRApprovalGate({env,gh}){
 if(!obj(env)||typeof gh!=='function'||
    !SHA.test(env.NICO_PHASE1_REVIEWED_CHECKOUT_SHA||''))
   stop('INDEPENDENT_REVIEW_EVIDENCE_REQUIRED');
 const checkout=env.NICO_PHASE1_REVIEWED_CHECKOUT_SHA;
 let pr,reviews;
 try{
  pr=JSON.parse(gh('api',['repos/Keikei-p/-/pulls/380']));
  reviews=JSON.parse(gh('api',['repos/Keikei-p/-/pulls/380/reviews?per_page=100']));
 }catch{stop('INDEPENDENT_REVIEW_CHECK_UNAVAILABLE');}
 if(!obj(pr)||pr.state!=='open'||pr.draft!==false||
    pr.head?.sha!==checkout||
    typeof pr.user?.login!=='string'||!pr.user.login||
    !Array.isArray(reviews)||reviews.length===0||reviews.length>100)
   stop('INDEPENDENT_REVIEW_NOT_APPROVED');
 // REST review IDs increase in submission order. A later dismissal/change
 // request cannot be hidden behind an earlier APPROVED review.
 const latest=new Map();
 for(const item of reviews){
  const login=item?.user?.login;
  if(typeof login!=='string'||!/^[A-Za-z0-9-]{1,39}$/.test(login)||
     !Number.isSafeInteger(item.id)||item.id<=0)continue;
  const prior=latest.get(login);
  if(!prior||prior.id<item.id)latest.set(login,item);
 }
 if([...latest.values()].some(x=>x.state==='CHANGES_REQUESTED'))
  stop('INDEPENDENT_REVIEW_CHANGES_REQUESTED');
 const eligible=[...latest.values()].filter(x=>
  x.state==='APPROVED'&&x.commit_id===checkout&&
  x.user?.type==='User'&&x.user.login!==pr.user.login&&
  ['COLLABORATOR','MEMBER','OWNER'].includes(x.author_association));
 for(const review of eligible){
  let permission;
  try{
   permission=JSON.parse(gh('api',[
    'repos/Keikei-p/-/collaborators/'+review.user.login+'/permission'
   ]))?.permission;
  }catch{stop('INDEPENDENT_REVIEW_CHECK_UNAVAILABLE');}
  if(['admin','maintain','write'].includes(permission))
   return Object.freeze({independentHumanApproved:true,
    approvedCommitExact:true,reviewedByAuthorizedCollaborator:true});
 }
 stop('INDEPENDENT_REVIEW_NOT_APPROVED');
}

function privateProofFile(env){
 const file=env.NICO_PHASE1_PRIVATE_PROOF_FILE;
 if(typeof file!=='string'||!path.isAbsolute(file))stop('PRIVATE_PROOF_FILE_REQUIRED');
 let resolved,info;
 try{
  resolved=realpathSync(file);
  info=statSync(resolved);
 }catch{stop('PRIVATE_PROOF_FILE_INVALID');}
 if(!info.isFile()||
    path.relative(ROOT,resolved)===''||
    (!path.relative(ROOT,resolved).startsWith('..'+path.sep)&&
     !path.isAbsolute(path.relative(ROOT,resolved)))||
    (process.platform!=='win32'&&(info.mode&0o077)!==0))
   stop('PRIVATE_PROOF_MUST_BE_OUTSIDE_REPO_AND_PRIVATE');
 let data;
 try{data=JSON.parse(readFileSync(resolved,'utf8'));}
 catch{stop('PRIVATE_PROOF_INVALID_JSON');}
 return data;
}

async function runOperator(mode,env=process.env){
 if(!['verify','apply'].includes(mode)||!obj(env))stop('INVALID_MODE');
 // Fail before any cloud request if the operator has not explicitly
 // approved the identity/source/backup procedure or the output is unsafe.
 const proof=mode==='apply'?privateProofFile(env):null;
 const intent=validateOperatorIntent({mode,env,proof});
 if(intent.apply){
  // Must pass before Admin credentials, backup metadata, or any live read.
  const run=(bin,args)=>execFileSync(bin,args,{
   cwd:ROOT,encoding:'utf8',timeout:30000,maxBuffer:64*1024,
   stdio:['ignore','pipe','ignore']
  });
  assertReviewedCodeGate({env,
   git:(cmd,args)=>run('git',[cmd,...args]),
   gh:(cmd,args)=>run('gh',[cmd,...args])
  });
  // Unlike a self-declared approval env string, this exact-head approval is
  // independently backed by GitHub and must survive a latest-review check.
  assertIndependentPRApprovalGate({
   env,gh:(cmd,args)=>run('gh',[cmd,...args])
  });
 }
 let settings;
 try{settings=JSON.parse(readFileSync(path.join(ROOT,'.firebaserc'),'utf8'));}
 catch{stop('PROJECT_CONFIGURATION');}
 if(settings?.projects?.default!==PROJECT)stop('WRONG_PROJECT');
 const baseline=execFileSync('git',['cat-file','blob',BASELINE_GIT_BLOB],{
  cwd:ROOT,encoding:'utf8',maxBuffer:256*1024,stdio:['ignore','pipe','ignore']
 });
 const candidate=readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
 const candidateSha256=createHash('sha256').update(candidate.replace(/\r\n/g,'\n').trim()).digest('hex');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const credential=require('firebase-admin/app').applicationDefault();
 const request=async(method,url,body)=>{
  if(!allowedPhase1Request(method,url,body,
   candidateSha256))stop('UNAPPROVED_ENDPOINT');
  // For allowlisted write requests the source digest check happens in
  // the Phase1 engine; never send any other production document mutation.
  let token;
  try{token=(await credential.getAccessToken())?.access_token;}
  catch{stop('SERVICE_ACCESS_UNAVAILABLE');}
  if(typeof token!=='string'||!token)stop('SERVICE_ACCESS_UNAVAILABLE');
  let response;
  try{response=await fetch(url,{method,redirect:'error',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{stop('TRANSPORT_UNVERIFIED');}
  if(!response?.ok)stop('HTTP_RESPONSE_UNVERIFIED');
  try{return await response.json();}
  catch{stop('JSON_RESPONSE_UNVERIFIED');}
 };
 const release={
  request,snapshot:()=>collect(request,{maxDocuments:10000}),
  restore:source=>restoreToLocalEmulator(source,{
   emulatorHost:env.FIRESTORE_EMULATOR_HOST
  }),
  backup:()=>inspect(),reviewedBaseline:baseline,reviewedCandidate:candidate
 };
 if(!intent.apply){
  const check=await phase1Boundary({...release,apply:false});
  return {checkedAgainst:'live-readonly-inventory',
   documents:check.documents,isolatedFieldsAndIdsRestored:check.isolatedFieldsAndIdsRestored,
   productionDocumentWrites:0,applied:false};
 }
 const accounts={
  ownerIdToken:proof.ownerIdToken,partnerIdToken:proof.partnerIdToken,
  expectedOwnerUid:proof.expectedOwnerUid,expectedPartnerUid:proof.expectedPartnerUid,
  internalCompanyId:proof.internalCompanyId,
  productId:proof.productId,recordId:proof.recordId
 };
 const result=await phase1WithLiveAccountGate({
  release,accounts,
  identity:{credential,partnerCompanyId:proof.partnerCompanyId},
  approval:true,candidateEmulatorVerified:true,backupReviewed:true
 });
 return {checkedAgainst:'production-live',applied:result.applied,
  postSwitchRoleVerified:result.postSwitchRoleVerified===true,
  reviewedRealPartnerFinanceDeny:result.reviewedRealPartnerFinanceDeny===true,
  reviewedPartnerCountViewAfterSwitch:result.reviewedPartnerCountViewAfterSwitch===true,
  productionDocumentWrites:0};
}

async function main(){
 if(process.argv.length!==3)stop('INVALID_ARGUMENTS');
 const answer=await runOperator(process.argv[2]);
 // No real user tokens, document IDs, prices, names or financial totals.
 console.log('PHASE1_REVIEWED_OPERATOR '+JSON.stringify(answer));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(err=>{
  const message=typeof err?.message==='string'?err.message:'';
  console.error(/^STOP_[A-Z0-9_]+$/.test(message)?message:'STOP_PHASE1_OPERATOR_REDACTED');
  process.exitCode=1;
 });
}
