#!/usr/bin/env node
/** One manual rehearsal of an existing managed backup; never restores over production.
 * Reuses the immutable GET-only collector and localhost field/ID verifier.
 * No document mutations, Rules changes, deployments, IAM grants or schedules.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collect,fingerprint,canonical,validateSafeCall,PROJECT} from '../readonly-backup/backup.mjs';
import {restoreToLocalEmulator,emulatorBase} from '../readonly-backup/restore-emulator.mjs';
import {summarizeManagedRestorePreflight,BACKUPS_URL,DATABASES_URL,SOURCE}
 from './audit-managed-backup-restore-preflight-readonly.mjs';
export {PROJECT};
export const DESTINATION='nico-backup-rehearsal-20261116';
export const TARGET='projects/'+PROJECT+'/databases/'+DESTINATION;
const API='https://firestore.googleapis.com/v1/';
const DEFAULT_DOCS=SOURCE+'/documents',TARGET_DOCS=TARGET+'/documents';
const RESTORE=DATABASES_URL+':restore';
const RULES='https://firebaserules.googleapis.com/v1/projects/'+PROJECT+
 '/releases/cloud.firestore/'+DESTINATION;
const IAM='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':testIamPermissions';
export const PERMISSIONS=Object.freeze(['datastore.backups.restoreDatabase',
 'datastore.databases.create','datastore.databases.getMetadata','datastore.databases.list',
 'datastore.databases.delete','datastore.entities.get','datastore.entities.list',
 'datastore.backups.get','datastore.backups.list','datastore.operations.get',
 'firebaserules.releases.get']);
const BACKUP=/^projects\/sales-management-cc116\/locations\/asia-northeast1\/backups\/[A-Za-z0-9_-]{3,128}$/;
const OPERATION=new RegExp('^'+TARGET+'/operations/[A-Za-z0-9_-]{1,300}$');
const STOP=code=>{throw Error('STOP_MANAGED_REHEARSAL_'+code)};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>{try{return canonical(a)===canonical(b)}catch{return false}};
const legacyLimit=32*1024*1024;
export const MAX_APPROVED_RESTORE_BYTES=128*1024*1024;
const ESTIMATE_APPROVAL='RESTORE_128MIB_JPY500_TEMPORARY_DATABASE_AND_CLEAN_UP';
const documentRead=(method,url,body)=>typeof url==='string'&&
 (url.startsWith(API+DEFAULT_DOCS+'/')||url===API+DEFAULT_DOCS+':listCollectionIds')&&
 validateSafeCall(method,url,body);
const validUid=x=>typeof x==='string'&&/^[A-Za-z0-9-]{10,80}$/.test(x);

export function permittedCall(method,url,body,{backup,etag,operation}={}){
 if(method==='GET'&&body===undefined){
  if([BACKUPS_URL,DATABASES_URL,API+TARGET,RULES].includes(url))return true;
  if(OPERATION.test(operation||'')&&url===API+operation)return true;
  if(documentRead(method,url,body))return true;
  if(typeof url==='string'&&url.startsWith(API+TARGET_DOCS))
   return documentRead(method,url.replace(API+TARGET_DOCS,API+DEFAULT_DOCS),body);
 }
 if(method==='POST'){
  if(url===IAM&&same(body,{permissions:PERMISSIONS}))return true;
  if(documentRead(method,url,body))return true;
  if(typeof url==='string'&&url.startsWith(API+TARGET_DOCS)&&
     documentRead(method,url.replace(API+TARGET_DOCS,API+DEFAULT_DOCS),body))return true;
  if(url===RESTORE&&BACKUP.test(backup||'')&&same(body,{databaseId:DESTINATION,backup}))return true;
 }
 return method==='DELETE'&&body===undefined&&typeof etag==='string'&&etag.length>0&&
  etag.length<500&&url===API+TARGET+'?etag='+encodeURIComponent(etag);
}
export function selectBackup(databases,backups,now,reviewedBudget){
 const metadata=inspectBackup(databases,backups,now);
 const budget=validateReviewedBudget(reviewedBudget,{...metadata,now});
 return {...metadata,budget};
}

/** Independent reviewed bounds, NEVER fields read from the Backup resource.
 * Legacy callers retain their 32 MiB ceiling. The explicitly approved Cloud
 * Shell aggregate route additionally binds live measurements and public JPY prices.
 * Synthetic lifecycle tests inject a budget; that is not live cost proof.
 */
export function validateReviewedBudget(budget,{selected,current,now}){
 if(!obj(budget))STOP('RESTORE_CAPACITY_AND_COST_EVIDENCE_REQUIRED');
 const checkedAt=Date.parse(budget.reviewedAt);
 if(budget.backup!==selected.name||budget.sourceUid!==current.uid||
    budget.snapshotTime!==selected.snapshotTime||!Number.isFinite(checkedAt)||
    checkedAt>now||now-checkedAt>3600000||checkedAt<Date.parse(selected.snapshotTime)||
    budget.currency!=='JPY'||budget.capacityEvidenceReviewed!==true||
    budget.pricingAndVerificationCostsReviewed!==true||
    !Number.isFinite(budget.estimatedAdditionalCostJpy)||budget.estimatedAdditionalCostJpy<=0||
    !Number.isFinite(budget.authorizedMaxJpy)||budget.authorizedMaxJpy<=0||
    budget.authorizedMaxJpy>500||budget.estimatedAdditionalCostJpy>budget.authorizedMaxJpy)
  STOP('RESTORE_CAPACITY_AND_COST_EVIDENCE_INVALID');
 const estimated=budget.capacityEvidenceKind==='owner-approved-aggregate-estimate-v1';
 if(!Number.isSafeInteger(budget.sizeUpperBoundBytes)||budget.sizeUpperBoundBytes<1||
    budget.sizeUpperBoundBytes>(estimated?MAX_APPROVED_RESTORE_BYTES:legacyLimit))STOP('BACKUP_SIZE_BUDGET');
 if(estimated){
  const a=budget.capacityEvidence,q=budget.pricingEvidence?.quote,c=budget.pricingEvidence?.cost;
  const at=Date.parse(q?.reviewedAt),sample=Date.parse(a?.latestSample);
  const rates=['restorePerGiB','readPer100000','storagePerGiBMonth','egressPerGiB'];
  if(budget.estimateApproval!==ESTIMATE_APPROVAL||budget.sizeUpperBoundBytes!==MAX_APPROVED_RESTORE_BYTES||
     budget.maxBillableReads!==400000||budget.networkUpperBoundBytes!==2**30||budget.retentionDays!==2||
     budget.exactBackupSizeVerified!==false||budget.hardBillingCapVerified!==false||
     a?.metric!=='firestore.googleapis.com/storage/backups_storage_bytes'||
     !Number.isInteger(a.samples)||a.samples<2||!Number.isSafeInteger(a.maxObservedAllBackupBytes)||
     a.maxObservedAllBackupBytes<1||a.maxObservedAllBackupBytes>MAX_APPROVED_RESTORE_BYTES||
     a.estimateCapacityCeilingBytes!==MAX_APPROVED_RESTORE_BYTES||a.exactBackupSizeVerified!==false||
     a.exactBackupDocumentCountVerified!==false||!Number.isFinite(sample)||sample>now||now-sample>600000||
     sample<Date.parse(selected.snapshotTime)+600000||
     q?.source!=='https://cloudbilling.googleapis.com/v1beta/skus'||q.currency!=='JPY'||
     !Number.isFinite(at)||at>now||now-at>3600000||
     q.reviewedDate!==new Date(now).toISOString().slice(0,10)||
     rates.some(k=>!Number.isFinite(q[k])||q[k]<=0))STOP('APPROVED_ESTIMATE_EVIDENCE');
  const gib=Math.ceil(MAX_APPROVED_RESTORE_BYTES/2**30);
  const expected=Math.ceil((gib*q.restorePerGiB+4*q.readPer100000+
   gib*q.storagePerGiBMonth/28*2+q.egressPerGiB)*1.1*2);
  if(c?.currency!=='JPY'||c.authorizedLimit!==500||c.includingTaxAndMargin!==expected||
     budget.estimatedAdditionalCostJpy!==expected)STOP('APPROVED_ESTIMATE_COST_DRIFT');
 }
 if(!Number.isSafeInteger(budget.maxDocuments)||budget.maxDocuments<1||
    budget.maxDocuments>10000)STOP('BACKUP_DOCUMENT_COUNT_BUDGET');
 return Object.freeze({...budget});
}
/** Metadata inspection must not claim that unsupported Backup.stats is pending. */
export function inspectBackup(databases,backups,now){
 const report=summarizeManagedRestorePreflight({databases,backups,nowMs:now,destination:DESTINATION});
 if(!report.backupRestoreMetadataPreflightPassed)STOP('NO_RECENT_BACKUP_OR_DESTINATION_OCCUPIED');
 const current=databases.databases.find(x=>x.name===SOURCE);
 if(current.locationId!=='asia-northeast1')STOP('SOURCE_LOCATION');
 if(current.databaseEdition!=null&&current.databaseEdition!=='STANDARD')STOP('UNREVIEWED_DATABASE_EDITION');
 const selected=backups.backups.filter(x=>x.database===SOURCE&&x.databaseUid===current.uid&&
  x.state==='READY'&&Date.parse(x.snapshotTime)<=now&&now-Date.parse(x.snapshotTime)<=48*3600000&&
  Date.parse(x.expireTime)>now+24*3600000)
  .sort((a,b)=>Date.parse(b.snapshotTime)-Date.parse(a.snapshotTime))[0];
 if(!BACKUP.test(selected?.name||''))STOP('BACKUP_NAME');
 return {selected,current,report};
}

export function validateRestoredDatabase(db,{backup,sourceUid,started,operation,uid}={}){
 if(!obj(db)||db.name!==TARGET||!validUid(db.uid)||db.uid===sourceUid||
    (uid!==undefined&&db.uid!==uid)||db.type!=='FIRESTORE_NATIVE'||
    db.locationId!=='asia-northeast1'||db.deleteTime||
    db.sourceInfo?.backup?.backup!==backup||
    (db.sourceInfo.operation!==undefined&&db.sourceInfo.operation!==operation)||
    !Number.isFinite(Date.parse(db.createTime))||Date.parse(db.createTime)<started-1000||
    typeof db.etag!=='string'||!db.etag||db.etag.length>499)
  STOP('RESTORED_DATABASE_PROVENANCE');
 return db;
}
export function isolatedCollector(request){
 return async(method,url,body)=>{
  if(!validateSafeCall(method,url,body))STOP('COLLECTOR_ENDPOINT');
  const actual=url.replace(API+DEFAULT_DOCS,API+TARGET_DOCS);
  const data=await request(method,actual,body);
  if(Array.isArray(data?.documents))return {...data,documents:data.documents.map(doc=>{
   if(typeof doc.name!=='string'||!doc.name.startsWith(TARGET_DOCS+'/'))STOP('COLLECTOR_FOREIGN_DOCUMENT');
   // Only the wire resource name is adapted to reuse the existing collector.
   // Field values (including references) and create/update metadata stay exact.
   return {...doc,name:DEFAULT_DOCS+doc.name.slice(TARGET_DOCS.length)};
  })};
  return data;
 };
}

export async function rehearse({mode='inspect',send,restore=restoreToLocalEmulator,
 emulatorHost,reviewedBudget,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),log=()=>{}}={}){
 if(!['inspect','rehearse'].includes(mode)||typeof send!=='function')STOP('MODE_OR_TRANSPORT');
 if(mode==='rehearse')emulatorBase(emulatorHost,'demo-sales-restore');
 let selected,operation,createdUid,cleanupEtag,started;
 let executionBudget,cleanupPhase=false;
 const executionStart=now(),usage={requests:0,readUnitsUpperBound:0,responseBytes:0,networkBytesUpperBound:0};
 const call=async(method,url,body,options={})=>{
  if(!permittedCall(method,url,body,{backup:selected?.name,operation,...options}))STOP('UNAPPROVED_ENDPOINT');
  const bounded=executionBudget?.capacityEvidenceKind==='owner-approved-aggregate-estimate-v1';
  if(bounded&&!cleanupPhase&&(now()-executionStart>45*60000||
     usage.readUnitsUpperBound>=executionBudget.maxBillableReads-1000||
     usage.networkBytesUpperBound>=executionBudget.networkUpperBoundBytes-1048576))STOP('EXECUTION_BUDGET');
  const response=await send(method,url,body);usage.requests++;
  if(bounded)usage.networkBytesUpperBound+=4096+Buffer.byteLength(JSON.stringify(body??{}));
  if(response?.status===404&&options.allow404===true)return null;
  if(response?.status!==200)STOP('HTTP_'+(Number.isInteger(response?.status)?response.status:'UNKNOWN'));
  let data;
  try{
   if(bounded&&typeof response.arrayBuffer==='function'){
    const bytes=Buffer.from(await response.arrayBuffer());usage.responseBytes+=bytes.length;
    usage.networkBytesUpperBound+=Math.ceil(bytes.length*1.1);
    data=JSON.parse(bytes.toString('utf8'));
   }else{
    data=await response.json();
    if(bounded){const bytes=Buffer.byteLength(JSON.stringify(data));usage.responseBytes+=bytes;usage.networkBytesUpperBound+=Math.ceil(bytes*1.1);}
   }
  }catch{STOP('RESPONSE_JSON');}
  if(bounded){
   usage.readUnitsUpperBound+=1+(Array.isArray(data?.documents)?data.documents.length:0);
   if(!cleanupPhase&&(usage.readUnitsUpperBound>executionBudget.maxBillableReads-1000||
      usage.networkBytesUpperBound>executionBudget.networkUpperBoundBytes-1048576))STOP('EXECUTION_BUDGET');
   if(usage.readUnitsUpperBound>executionBudget.maxBillableReads||
      usage.networkBytesUpperBound>executionBudget.networkUpperBoundBytes)STOP('CLEANUP_EXECUTION_BUDGET');
  }
  if(!obj(data))STOP('RESPONSE_SHAPE');return data;
 };
 const read=async(requireBudget=true)=>{
  const databases=await call('GET',DATABASES_URL);
  const backups=await call('GET',BACKUPS_URL);
  return requireBudget?selectBackup(databases,backups,now(),reviewedBudget):
   inspectBackup(databases,backups,now());
 };
 const permissions=await call('POST',IAM,{permissions:PERMISSIONS});
 if(!Array.isArray(permissions.permissions??[])||
    (permissions.permissions??[]).some(x=>typeof x!=='string'))STOP('IAM_RESPONSE');
 const missingPermissions=PERMISSIONS.filter(x=>!permissions.permissions?.includes(x));
 const initial=await read(mode!=='inspect');selected=initial.selected;
 executionBudget=initial.budget;
 if(await call('GET',RULES,undefined,{allow404:true})!==null)STOP('DESTINATION_RULES_ALREADY_EXIST');
 const budgetVerified=mode==='rehearse';
 const proof={project:PROJECT,mode,backupSnapshotTime:selected.snapshotTime,
  backupApiProvidesSizeAndDocumentCount:false,
  backupSizeWithin32MiB:budgetVerified&&initial.budget.sizeUpperBoundBytes<=legacyLimit,
  approvedAggregate128MiBEstimate:budgetVerified&&initial.budget.capacityEvidenceKind==='owner-approved-aggregate-estimate-v1',
  exactBackupSizeVerified:false,hardBillingCapVerified:false,
  restoreCapacityAndCostVerified:budgetVerified,
  restoreBlockedByMissingCapacityAndCostEvidence:!budgetVerified,
  missingPermissions,sourceDocumentWrites:0,sourceRulesWrites:0,deployments:0,
  managedBackupRestored:false,temporaryDatabaseCreated:false,temporaryDatabaseDeleted:false,
  sourceTraversalIsAtomic:false,authOrStorageRestored:false,fullCutoverApproved:false};
 if(mode==='inspect')return proof;
 if(missingPermissions.length)STOP('EXISTING_IDENTITY_MISSING_RESTORE_OR_CLEANUP_PERMISSION');
 const maxDocuments=initial.budget.maxDocuments;
 const snapshot=()=>collect((method,url,body)=>call(method,url,body),{maxDocuments});
 const before=await snapshot(),original=fingerprint(before);
 // Recheck UID/backup/unused destination after the potentially long source scan.
 const fresh=await read();
 if(fresh.current.uid!==initial.current.uid||fresh.selected.name!==selected.name)STOP('SOURCE_OR_BACKUP_CHANGED');
 started=now();
 const wait=async(op,maxPolls=108)=>{
  if(!obj(op)||!OPERATION.test(op.name||''))STOP('OPERATION_SCOPE');
  operation=op.name;
  for(let attempt=0;attempt<maxPolls;attempt++){
   if(op.error)STOP('CLOUD_OPERATION_FAILED');
   if(op.done===true)return op;
   await pause(10000);
   op=await call('GET',API+operation);
   if(op.name!==operation)STOP('OPERATION_IDENTITY');
  }
  STOP('OPERATION_TIMEOUT_NO_AUTOMATIC_RETRY');
 };
 let result,failure,attempted=false;
 try{
  attempted=true;
  const completed=await wait(await call('POST',RESTORE,{databaseId:DESTINATION,backup:selected.name}));
  // Only a successful response to OUR restore operation proves ownership.
  // An occupied-target race or lost response must never authorize cleanup.
  if(completed.response?.name!==TARGET||!validUid(completed.response?.uid)||
     completed.response.uid===initial.current.uid)STOP('RESTORE_OWNERSHIP_UNPROVEN');
  createdUid=completed.response.uid;
  const criteria={backup:selected.name,sourceUid:initial.current.uid,started,operation};
  const db=validateRestoredDatabase(await call('GET',API+TARGET),{...criteria,uid:createdUid});
  cleanupEtag=db.etag;
  log({temporaryDatabaseCreated:true,cleanupPending:true,sourceDocumentWrites:0});
  if(await call('GET',RULES,undefined,{allow404:true})!==null)STOP('DESTINATION_CLIENT_RULES_PRESENT');
  const restored=await collect(isolatedCollector((m,u,b)=>call(m,u,b)),{maxDocuments});
  const isolated=await restore(restored,{emulatorHost,maxDocuments});
  if(isolated.fieldsAndIdsVerified!==true||isolated.productionTouched!==false||
     isolated.documentCount!==restored.documents.length||
     isolated.sourceInventoryFingerprint!==fingerprint(restored))STOP('FIELDS_AND_IDS_NOT_VERIFIED');
  if(fingerprint(await snapshot())!==original)STOP('SOURCE_CHANGED_DURING_REHEARSAL');
  const sourceMeta=await call('GET',DATABASES_URL);
  if(sourceMeta.nextPageToken||!Array.isArray(sourceMeta.databases)||
     sourceMeta.databases.filter(x=>x.name===SOURCE).length!==1||
     sourceMeta.databases.find(x=>x.name===SOURCE).uid!==initial.current.uid)
   STOP('SOURCE_DATABASE_REPLACED');
  const fields=s=>s.documents.map(x=>({path:x.path,fields:x.value.fields}));
  result={...proof,managedBackupRestored:true,temporaryDatabaseCreated:true,
   restoredFieldsAndIdsVerified:true,productionSnapshotUnchanged:true,
   sourceDocumentCount:before.documents.length,sourceInventoryFingerprint:original,
   restoredDocumentCount:restored.documents.length,
   backupMatchesCurrentDocumentFields:same(fields(before),fields(restored)),
   // A backup may predate legitimate changes; never "repair" or overwrite them.
   productionDataReplacedOrReclassified:false};
  log({verificationBeforeCleanup:{...result}});
 }catch(e){failure=e;log({verificationFailed:true,
  stopReason:/^STOP_MANAGED_REHEARSAL_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'REDACTED_VERIFICATION_FAILURE'});}
 finally{
  cleanupPhase=true;
  if(attempted){
   try{
    const latest=await call('GET',API+TARGET,undefined,{allow404:true});
    if(latest===null){if(createdUid)STOP('TEMPORARY_DATABASE_DISAPPEARED');}
    else{
     if(!createdUid)STOP('RESTORE_OWNERSHIP_UNPROVEN');
     const db=validateRestoredDatabase(latest,{backup:selected.name,sourceUid:initial.current.uid,
      started,operation,uid:createdUid});
     // Never disable a delete-protection policy set by another operator.
     if(db.deleteProtectionState==='DELETE_PROTECTION_ENABLED')STOP('TEMPORARY_DELETE_PROTECTED');
     cleanupEtag=db.etag;
     const deletion=await call('DELETE',API+TARGET+'?etag='+encodeURIComponent(cleanupEtag),undefined,{etag:cleanupEtag});
     if(deletion.error)STOP('TEMPORARY_DELETE_FAILED');
     // A deleted database's operation endpoint can disappear with it. The
     // authoritative postcondition is 404 for OUR fixed, UID/etag-verified DB,
     // not continued availability of its operation resource. Never re-delete.
     let absent=false;
     for(let attempt=0;attempt<108;attempt++){
      const remaining=await call('GET',API+TARGET,undefined,{allow404:true});
      if(remaining===null){absent=true;break;}
      validateRestoredDatabase(remaining,{backup:selected.name,sourceUid:initial.current.uid,
       started,operation,uid:createdUid});
      await pause(10000);
     }
     if(!absent)STOP('TEMPORARY_CLEANUP_NOT_CONFIRMED');
     if(result)result.temporaryDatabaseDeleted=true;
     log({temporaryDatabaseDeleted:true,sourceDocumentWrites:0});
    }
   }catch(e){
    log({temporaryDatabaseCleanupRequired:true,sourceDocumentWrites:0,
     stopReason:/^STOP_MANAGED_REHEARSAL_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'REDACTED_CLEANUP_FAILURE'});
    STOP('TEMPORARY_CLEANUP_REQUIRES_OPERATOR');
   }
  }
 }
 if(failure)throw failure;
 if(!result?.temporaryDatabaseDeleted)STOP('CLEANUP_UNPROVEN');
 if(executionBudget.capacityEvidenceKind==='owner-approved-aggregate-estimate-v1')
  result.executionUsage={...usage,elapsedMs:now()-executionStart,
   estimatedAdditionalCostJpy:executionBudget.estimatedAdditionalCostJpy,authorizedMaxJpy:500};
 return result;
}

async function cloudShellMain(){
 const env=process.env,[, ,mode,sha,confirmation]=process.argv;
 if(mode!=='rehearse-approved-aggregate'||process.argv.length!==5||
    confirmation!==ESTIMATE_APPROVAL||env.CLOUD_SHELL!=='true'||env.DEVSHELL_PROJECT_ID!==PROJECT||
    !/^[a-f0-9]{40}$/.test(sha||''))STOP('MANUAL_CLOUD_SHELL_GATE');
 const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
 if(run('git',['rev-parse','HEAD'])!==sha||run('gcloud',['config','get-value','project'])!==PROJECT)STOP('CHECKOUT_OR_PROJECT');
 run('git',['diff','--exit-code','HEAD','--','tools/production','tools/readonly-backup']);
 if(JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8')).projects.default!==PROJECT)STOP('PROJECT');
 emulatorBase(env.FIRESTORE_EMULATOR_HOST,'demo-sales-restore');
 const {reviewLiveQuote,reviewAggregateBudget,approveAggregateBudget,livePriceUrls}=
  await import('./review-managed-backup-cloud-shell.mjs');
 let token,lastTokenRead=0;
 const send=async(method,url,body)=>{
  if(!token||Date.now()-lastTokenRead>60000){token=run('gcloud',['auth','print-access-token']);lastTokenRead=Date.now();}
  if(!token)STOP('IDENTITY');
  return fetch(url,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 };
 let databases,backups;
 const read=async url=>{
  if(![DATABASES_URL,BACKUPS_URL,...livePriceUrls()].includes(url)&&
     !url.startsWith('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/timeSeries?'))STOP('EVIDENCE_GET_SCOPE');
  const r=await send('GET',url);
  if(r.status!==200)STOP('EVIDENCE_HTTP_'+r.status);
  const data=await r.json();
  if(url===DATABASES_URL)databases=data;if(url===BACKUPS_URL)backups=data;
  return data;
 };
 const quote=await reviewLiveQuote({read});
 const review=await reviewAggregateBudget({read,quote,inspect:()=>rehearse({mode:'inspect',send})});
 const remaining=Number(env.NICO_REMAINING_REHEARSAL_BUDGET_JPY??500);
 if(!Number.isInteger(remaining)||remaining<1||remaining>500)STOP('REMAINING_COST_BUDGET');
 const reviewedBudget={...approveAggregateBudget({review,databases,backups,confirmation}),authorizedMaxJpy:remaining};
 if(reviewedBudget.estimatedAdditionalCostJpy>remaining)STOP('CUMULATIVE_COST_BUDGET');
 console.log('NICO_MANAGED_REHEARSAL_ESTIMATE '+JSON.stringify({
  backupSnapshotTime:review.backupSnapshotTime,capacity:review.capacity,aggregate:review.aggregate,
  quote,estimatedCost:review.estimatedCost,missingPermissions:review.missingPermissions,
  exactBackupSizeVerified:false,hardBillingCapVerified:false,authorizedMaxJpy:500}));
 const output=await rehearse({mode:'rehearse',send,reviewedBudget,emulatorHost:env.FIRESTORE_EMULATOR_HOST,
  log:x=>console.log('NICO_MANAGED_REHEARSAL_CHECK '+JSON.stringify(x))});
 console.log('NICO_MANAGED_REHEARSAL_RESULT '+JSON.stringify(output));
}

async function main(){
 const mode=process.argv[2],env=process.env;
 if(process.argv.length!==3||!['inspect','rehearse'].includes(mode)||
    env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='Keikei-p/-'||
    env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')||env.NICO_REVIEWED_MAIN!==env.GITHUB_SHA||
    env.FIREBASE_PROJECT_ID!==PROJECT||!env.GOOGLE_APPLICATION_CREDENTIALS||
    env.NICO_BACKUP_REHEARSAL_CONFIRMATION!==(mode==='inspect'?'INSPECT_ONLY':'RESTORE_TEMPORARY_DATABASE_AND_CLEAN_UP'))
  STOP('MANUAL_RUNTIME_GATE');
 if(JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8')).projects.default!==PROJECT)STOP('PROJECT');
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const credential=require('firebase-admin/app').applicationDefault();
 const send=async(method,url,body)=>{
  const token=(await credential.getAccessToken()).access_token;
  if(!token)STOP('IDENTITY');
  return fetch(url,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 };
 const output=await rehearse({mode,send,emulatorHost:env.FIRESTORE_EMULATOR_HOST,
  log:x=>console.log('NICO_MANAGED_REHEARSAL_CHECK '+JSON.stringify(x))});
 console.log('NICO_MANAGED_REHEARSAL_RESULT '+JSON.stringify(output));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 (process.argv[2]==='rehearse-approved-aggregate'?cloudShellMain():main()).catch(e=>{
  console.error(/^STOP_(?:MANAGED_(?:REHEARSAL|BACKUP_PREFLIGHT)|CLOUD_SHELL_BACKUP_REVIEW)_[A-Z0-9_]+$/.test(e?.message||'')?
   e.message:'STOP_MANAGED_REHEARSAL_REDACTED_FAILURE');process.exitCode=1;
 });
