/**
 * NO DEPLOY: verify the exact Phase-1 finance Rules candidate against a
 * transient, typed copy of the LIVE Firestore inventory in demo-sales-restore.
 * Production I/O is restricted to READ-ONLY metadata / document-list APIs.
 * Emulator authentication contexts are SYNTHETIC; this cannot replace
 * signed real Firebase ID-token GET/LIST checks or count-entry continuity.
 *
 * Never print source documents, document IDs, emails, UID values, amounts,
 * Firebase tokens, URLs with sensitive fields, or SDK exception text.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collect,fingerprint,validateSafeCall,PROJECT} from '../tools/readonly-backup/backup.mjs';
import {restoreToLocalEmulator} from '../tools/readonly-backup/restore-emulator.mjs';
import {classifyLiveRules,hasRecentReadyBackup} from '../tools/production/audit-secondary-contexts-readonly.mjs';
import {inspect as inspectBackup} from '../tools/production/inspect-firestore-backups-readonly.mjs';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const LIVE_RULES_RELEASE='https://firebaserules.googleapis.com/v1/projects/'+PROJECT+'/releases/cloud.firestore';
const RULESET=/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/;
const reviewedBlob='6d6ac7fd3544b0326823e419a3acd7e1d060b714';
const TEST_PROJECT='demo-sales-restore';
const rulesPath=new URL('./fixtures/reviewed-phase1-finance-boundary.rules',import.meta.url);
const fail=(code)=>{throw Error('STOP_PHASE1_EMULATOR_'+code);};
const val=(fields,key)=>fields?.[key]?.stringValue;
const yes=(fields,key)=>fields?.[key]?.booleanValue===true;
const hasMoney=(fields,key)=>fields?.[key]&&
 ('integerValue' in fields[key]||'doubleValue' in fields[key]);
const uidForPath=(path,prefix)=>path.startsWith(prefix)&&
 !path.slice(prefix.length).includes('/')?path.slice(prefix.length):null;
const blob=s=>createHash('sha1')
 .update('blob '+Buffer.byteLength(s,'utf8')+String.fromCharCode(0))
 .update(s,'utf8').digest('hex');

export function assertExactReviewedRules(source){
 if(typeof source!=='string'||blob(source)!==reviewedBlob)fail('UNREVIEWED_CANDIDATE');
 return true;
}

/**
 * Stable choices are read ONLY from the snapshot in memory. Every active
 * secondary context must be tested; selecting an unrelated deny-only user
 * would falsely certify the reviewed boundary.
 */
export function chooseAffectedSamples(snapshot){
 if(snapshot?.projectId!==PROJECT||!Array.isArray(snapshot.documents)||
    snapshot.documents.length===0)fail('SNAPSHOT');
 const byPath=new Map(snapshot.documents.map(row=>[row.path,row]));
 if(byPath.size!==snapshot.documents.length)fail('DUPLICATE');
 const active=snapshot.documents.filter(row=>uidForPath(row.path,'partnerWorkspaceContexts/')&&
    val(row.value?.fields,'kind')==='partner_secondary'&&yes(row.value?.fields,'active'));
 if(active.length===0)fail('NO_AFFECTED_SECONDARY');
 const samples=[];
 for(const c of active){
  const uid=uidForPath(c.path,'partnerWorkspaceContexts/');
  const internalId=val(c.value.fields,'primaryCompanyId');
  const partnerId=val(c.value.fields,'partnerCompanyId');
  if(![uid,internalId,partnerId].every(x=>ID.test(x||''))||internalId===partnerId)
    fail('CONTEXT_IDS');
  const main=byPath.get('companies/'+internalId);
  const partner=byPath.get('companies/'+partnerId);
  const user=byPath.get('users/'+uid);
  const oldMember=byPath.get('companies/'+internalId+'/members/'+uid);
  const partnerMember=byPath.get('companies/'+partnerId+'/members/'+uid);
  if(!main||!partner||!user||!oldMember||!partnerMember||
     val(user.value?.fields,'companyId')!==internalId||
     val(main.value?.fields,'companyKind')==='partner'||
     val(partner.value?.fields,'companyKind')!=='partner')
    fail('SECONDARY_MEMBERSHIP');
  const owner=val(main.value?.fields,'ownerUid');
  if(!ID.test(owner||'')||owner===uid||
     !byPath.has('users/'+owner)||
     !byPath.has('companies/'+internalId+'/members/'+owner)||
     byPath.has('partnerWorkspaceContexts/'+owner))
    fail('INTERNAL_OWNER_BINDING');
  const product=snapshot.documents.find(row=>
    uidForPath(row.path,'products/')&&
    val(row.value?.fields,'companyId')===internalId&&
    hasMoney(row.value?.fields,'revenue'));
  const record=snapshot.documents.find(row=>
    uidForPath(row.path,'records/')&&
    val(row.value?.fields,'companyId')===internalId&&
    hasMoney(row.value?.fields,'totalRevenue'));
  if(!product||!record)fail('FINANCE_DOCUMENTS_MISSING');
  samples.push(Object.freeze({
   owner,partner:uid,companyId:internalId,
   productId:uidForPath(product.path,'products/'),
   recordId:uidForPath(record.path,'records/')
  }));
 }
 return samples;
}

async function run(){
 let phase='ENV';
 if(process.env.GITHUB_ACTIONS!=='true'||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.GCLOUD_PROJECT!==TEST_PROJECT||
    !/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    JSON.parse(readFileSync(new URL('../.firebaserc',import.meta.url),'utf8'))?.projects?.default!==PROJECT)
   fail('REVIEWED_EMULATOR_ENV');
 const rules=readFileSync(rulesPath,'utf8');
 assertExactReviewedRules(rules);
 const require=createRequire(import.meta.url);
 const adminRequire=createRequire(new URL('../functions/package.json',import.meta.url));
 const {applicationDefault}=adminRequire('firebase-admin/app');
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 const {doc,collection,query,where,limit,getDoc,getDocsFromServer}=require('firebase/firestore');
 const credential=applicationDefault();

 async function oauthRead(method,url,body){
  if(!validateSafeCall(method,url,body))fail('FORBIDDEN_FIRESTORE_ENDPOINT');
  const token=(await credential.getAccessToken())?.access_token;
  if(!token)fail('NO_READ_IDENTITY');
  const response=await fetch(url,{method,redirect:'error',headers:{
   Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)fail('FIRESTORE_READ_UNAVAILABLE');
  return response.json();
 }
 phase='BACKUP';
 const backup=await inspectBackup();
 if(!hasRecentReadyBackup(backup))fail('RECENT_READY_BACKUP_REQUIRED');

 phase='LIVE_RULES';
 async function rulesGet(url){
  const token=(await credential.getAccessToken())?.access_token;
  if(!token)fail('NO_READ_IDENTITY');
  const response=await fetch(url,{method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token}});
  if(!response.ok)fail('LIVE_RULES_READ');
  return response.json();
 }
 const release=await rulesGet(LIVE_RULES_RELEASE);
 if(!RULESET.test(release?.rulesetName||''))fail('RULESET_ID');
 const deployed=await rulesGet('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
 if(deployed?.source?.files?.length!==1||
   !classifyLiveRules(deployed.source.files[0]?.content||'').exactOriginalMainRules)
  fail('UNKNOWN_LIVE_RULES');

 phase='SNAPSHOT';
 const snapshot=await collect(oauthRead,{maxDocuments:10000});
 const original=fingerprint(snapshot);
 const samples=chooseAffectedSamples(snapshot);
 phase='RESTORE';
 const restored=await restoreToLocalEmulator(snapshot,{
  emulatorHost:process.env.FIRESTORE_EMULATOR_HOST});
 if(restored.fieldsAndIdsVerified!==true||restored.productionTouched!==false||
    restored.documentCount!==snapshot.documents.length||
    restored.sourceInventoryFingerprint!==original)
   fail('RESTORE_NOT_VERIFIED');

 phase='CANDIDATE_RULES';
 const env=await initializeTestEnvironment({
  projectId:TEST_PROJECT,firestore:{rules}
 });
 try {
  const mustDeny=async(action)=>{
   try{await action();}
   catch(e){if(e?.code==='permission-denied')return;fail('DENIAL_NOT_VERIFIED');}
   fail('PARTNER_FINANCE_ALLOWED');
  };
  for(const target of samples){
   phase='OWNER_GET_LIST';
   const ownerDb=env.authenticatedContext(target.owner,{
    email:'owner-proof@example.test',email_verified:true}).firestore();
   const partnerDb=env.authenticatedContext(target.partner,{
    email:'partner-proof@example.test',email_verified:true}).firestore();
   for(const [col,id,moneyKey] of [
    ['products',target.productId,'revenue'],
    ['records',target.recordId,'totalRevenue']
   ]){
    const value=await getDoc(doc(ownerDb,col,id));
    if(!value.exists()||!Number.isFinite(value.data()?.[moneyKey]))
      fail('OWNER_MONEY_READ_LOST');
    const ownerList=await getDocsFromServer(query(collection(ownerDb,col),
      where('companyId','==',target.companyId),limit(1)));
    if(ownerList.empty)fail('OWNER_FINANCE_LIST_LOST');
    phase='PARTNER_GET_LIST';
    await mustDeny(()=>getDoc(doc(partnerDb,col,id)));
    await mustDeny(()=>getDocsFromServer(query(collection(partnerDb,col),
      where('companyId','==',target.companyId),limit(1))));
   }
  }
 } finally { await env.cleanup(); }

 phase='STABLE_SOURCE';
 if(fingerprint(await collect(oauthRead,{maxDocuments:10000}))!==original)
  fail('PRODUCTION_INPUT_CHANGED_DURING_AUDIT');
 console.log('PHASE1_LIVE_SHAPE_EMULATOR '+JSON.stringify({
  checkedAgainst:'production-inventory-copied-to-isolated-emulator',
  candidateExactlyReviewed:true,
  allActiveSecondaryContextsChecked:true,
  ownerFinanceGetAndListAllowedInEmulator:true,
  partnerFinanceGetAndListDeniedInEmulator:true,
  originalInventoryStable:true,productionDocumentWrites:0,
  productionRulesWrites:0,liveUserIdTokensTested:false,
  liveCountEntryContinuityTested:false,safeToDeploy:false
 }));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 run().catch(e=>{
  const msg=typeof e?.message==='string'&&/^STOP_PHASE1_EMULATOR_[A-Z0-9_]+$/.test(e.message)?
   e.message:'STOP_PHASE1_EMULATOR_UNVERIFIED';
  console.error(msg);
  process.exitCode=1;
 });
}
