import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PROJECT,DESTINATION,TARGET,PERMISSIONS,permittedCall,selectBackup,
 inspectBackup,validateRestoredDatabase,isolatedCollector,rehearse} from '../tools/production/rehearse-managed-backup.mjs';
import {fingerprint} from '../tools/readonly-backup/backup.mjs';
import {restoreToLocalEmulator} from '../tools/readonly-backup/restore-emulator.mjs';
import {QUOTE,approveAggregateBudget,aggregateConditionalCost,APPROVED_ESTIMATE_CONFIRMATION} from '../tools/production/review-managed-backup-cloud-shell.mjs';
const API='https://firestore.googleapis.com/v1/';
const SOURCE='projects/'+PROJECT+'/databases/(default)';
const DB=API+'projects/'+PROJECT+'/databases';
const BACKUPS=API+'projects/'+PROJECT+'/locations/-/backups';
const IAM='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':testIamPermissions';
const RULES='https://firebaserules.googleapis.com/v1/projects/'+PROJECT+'/releases/cloud.firestore/'+DESTINATION;
const NOW=Date.parse('2026-11-16T10:00:00Z');
const UID='source-database-uuid-1234',OTHER='restored-database-uuid-5678';
const BACKUP='projects/'+PROJECT+'/locations/asia-northeast1/backups/backup-123';
const OP=TARGET+'/operations/restore-123',DEL=TARGET+'/operations/delete-123';
const sourceMeta={name:SOURCE,uid:UID,type:'FIRESTORE_NATIVE',locationId:'asia-northeast1'};
const backup={name:BACKUP,database:SOURCE,databaseUid:UID,state:'READY',
 snapshotTime:new Date(NOW-3600000).toISOString(),expireTime:new Date(NOW+86400000*6).toISOString()};
const databases={databases:[sourceMeta]},backups={backups:[backup]};
// Independent SYNTHETIC review, never attributed to Google's Backup resource.
const budget={backup:BACKUP,sourceUid:UID,snapshotTime:backup.snapshotTime,
 reviewedAt:new Date(NOW).toISOString(),currency:'JPY',authorizedMaxJpy:500,
 estimatedAdditionalCostJpy:50,sizeUpperBoundBytes:500,maxDocuments:10000,
 capacityEvidenceReviewed:true,pricingAndVerificationCostsReviewed:true};
const restoredMeta=()=>({name:TARGET,uid:OTHER,type:'FIRESTORE_NATIVE',locationId:'asia-northeast1',
 createTime:new Date(NOW).toISOString(),etag:'etag-123',sourceInfo:{backup:{backup:BACKUP},operation:OP},
 deleteProtectionState:'DELETE_PROTECTION_DISABLED'});
const clone=x=>structuredClone(x);
function fixture(options={}){
 const calls=[];let created=false,deleted=false,defaultRead=0;
 const backupResponse=clone(backups);
 const send=async(method,url,body)=>{
  calls.push({method,url,body});
  const response=(data,status=200)=>({status,json:async()=>clone(data)});
  if(url===IAM)return response({permissions:options.permissions??PERMISSIONS});
  if(url===DB)return response({databases:[clone(sourceMeta),...(created&&!deleted?[restoredMeta()]:[])]});
  if(url===BACKUPS)return response(backupResponse);
  if(url===RULES)return response({},404);
  if(url===DB+':restore'){
   assert.equal(method,'POST');assert.deepEqual(body,{databaseId:DESTINATION,backup:BACKUP});
   created=true;
   if(options.concurrentConflict)return response({},409);
   if(options.operationFailed)return response({name:OP,done:true,error:{code:6}});
   if(options.missingAcknowledgedUid)return response({name:OP,done:true,response:{name:TARGET}});
   return response({name:options.foreignOperation??OP,done:true,response:restoredMeta()});
  }
  if(url===API+TARGET){
   const m=restoredMeta();if(options.foreignUid&&created)m.sourceInfo.backup.backup='foreign-backup';
   return response(created&&!deleted?m:{},created&&!deleted?200:404);
  }
  if(url===API+TARGET+'?etag=etag-123'){
   assert.equal(method,'DELETE');deleted=true;return response({name:DEL,done:true,response:{}});
  }
  const prefix=[SOURCE,TARGET].find(x=>url.startsWith(API+x+'/documents'));
  if(!prefix)throw Error('Unexpected request must never print sensitive URL');
  const root=API+prefix+'/documents';
  if(url===root+':listCollectionIds'){
   if(prefix===SOURCE)defaultRead++;
   return response({collectionIds:['managedRehearsalTests']});
  }
  if(url.endsWith(':listCollectionIds'))return response({collectionIds:[]});
  assert.equal(method,'GET');
  const count=prefix===TARGET&&options.emptyRestored?0:2;
  return response({documents:Array.from({length:count},(_,i)=>({
   name:prefix+'/documents/managedRehearsalTests/doc'+i,
   fields:{count:{integerValue:options.changedSource&&prefix===SOURCE&&defaultRead>1?'9':String(i)},
    bytes:{bytesValue:'AAEC'},ref:{referenceValue:SOURCE+'/documents/products/retained-reference'}},
   createTime:'2026-11-10T10:00:00Z',updateTime:'2026-11-10T10:00:00Z'
  }))});
 };
 const restore=async snap=>({fieldsAndIdsVerified:true,productionTouched:false,
  documentCount:snap.documents.length,sourceInventoryFingerprint:fingerprint(snap)});
 return {calls,send,restore,get deleted(){return deleted}};
}
const run=(f,extra={})=>rehearse({mode:'rehearse',send:f.send,restore:f.restore,
 emulatorHost:'127.0.0.1:8080',reviewedBudget:budget,now:()=>NOW,pause:async()=>{},...extra});

// Entirely fictional evidence. This does not certify a live quote or restore.
function approvedFixture(){
 const quote={...QUOTE,reviewedDate:new Date(NOW).toISOString().slice(0,10),
  reviewedAt:new Date(NOW).toISOString(),source:'https://cloudbilling.googleapis.com/v1beta/skus'};
 const review={project:PROJECT,mode:'cloud-shell-aggregate-budget-readonly',
  backupSnapshotTime:backup.snapshotTime,missingPermissions:[],quote,
  capacity:{metric:'firestore.googleapis.com/storage/data_and_index_storage_bytes',snapshotTime:backup.snapshotTime,maxObservedBytes:10000000},
  aggregate:{metric:'firestore.googleapis.com/storage/backups_storage_bytes',samples:2,
   latestSample:new Date(NOW-60000).toISOString(),maxObservedAllBackupBytes:65000000,
   estimateCapacityCeilingBytes:128*1024*1024,exactBackupSizeVerified:false,exactBackupDocumentCountVerified:false},
  estimatedCost:aggregateConditionalCost(NOW,quote)};
 return {review,databases,backups,confirmation:APPROVED_ESTIMATE_CONFIRMATION,now:NOW};
}
test('128 MiB approval binds the current backup and reviewed JPY cost without claiming 32 MiB or exact size',async()=>{
 const b=approveAggregateBudget(approvedFixture()),f=fixture();
 assert.equal(b.sizeUpperBoundBytes,128*1024*1024);
 assert.equal(b.pricingEvidence.cost.parts.restore,b.pricingEvidence.quote.restorePerGiB);
 assert.equal(b.pricingEvidence.cost.estimateRoundedUpToWholeGiB,true);
 assert.deepEqual(selectBackup(databases,backups,NOW,b).budget,b);
 const result=await run(f,{reviewedBudget:b,send:async(...args)=>{
  const response=await f.send(...args);
  return new Response(JSON.stringify(await response.json()),{status:response.status});
 }});
 assert.equal(result.managedBackupRestored,true);assert.equal(result.temporaryDatabaseDeleted,true);
 assert.equal(result.approvedAggregate128MiBEstimate,true);assert.equal(result.backupSizeWithin32MiB,false);
 assert.equal(result.exactBackupSizeVerified,false);assert.equal(result.hardBillingCapVerified,false);
 assert(result.executionUsage.readUnitsUpperBound>0);assert(result.executionUsage.networkBytesUpperBound>0);
 assert(result.executionUsage.estimatedAdditionalCostJpy<=500);
});
test('128 MiB cannot bypass authorization, evidence freshness, cost binding, source binding or the legacy ceiling',()=>{
 assert.throws(()=>approveAggregateBudget({...approvedFixture(),confirmation:''}),/EXPLICIT_ESTIMATE_APPROVAL/);
 const good=approveAggregateBudget(approvedFixture());
 for(const edit of [x=>x.estimateApproval='',x=>x.capacityEvidence.latestSample=new Date(NOW-700000).toISOString(),
  x=>x.pricingEvidence.quote.reviewedAt=new Date(NOW-3600001).toISOString(),
  x=>x.estimatedAdditionalCostJpy=1,x=>x.sourceUid='foreign',x=>x.sizeUpperBoundBytes++,
  x=>x.maxBillableReads=800000,x=>x.networkUpperBoundBytes++,x=>x.retentionDays=3]){
  const b=clone(good);edit(b);assert.throws(()=>selectBackup(databases,backups,NOW,b),/STOP_MANAGED_/);
 }
 assert.throws(()=>selectBackup(databases,backups,NOW,{...budget,sizeUpperBoundBytes:128*1024*1024}),/BACKUP_SIZE_BUDGET/);
 const enterprise=clone(databases);enterprise.databases[0].databaseEdition='ENTERPRISE';
 assert.throws(()=>selectBackup(enterprise,backups,NOW,good),/UNREVIEWED_DATABASE_EDITION/);
 const f=approvedFixture();f.review.estimatedCost.includingTaxAndMargin=1;
 assert.throws(()=>approveAggregateBudget(f),/COST_DRIFT/);
 const expensive=approvedFixture();expensive.review.quote.restorePerGiB=100000;
 assert.throws(()=>approveAggregateBudget(expensive),/COST_EXCEEDS_500/);
});
test('the paid CLI cannot borrow the GitHub gate or run outside the exact Cloud Shell project',()=>{
 const entry=fileURLToPath(new URL('../tools/production/rehearse-managed-backup.mjs',import.meta.url));
 for(const patch of [{CLOUD_SHELL:'false',DEVSHELL_PROJECT_ID:PROJECT},
  {CLOUD_SHELL:'true',DEVSHELL_PROJECT_ID:'foreign-project'}]){
  const r=spawnSync(process.execPath,[entry,'rehearse-approved-aggregate','a'.repeat(40),APPROVED_ESTIMATE_CONFIRMATION],
   {encoding:'utf8',env:{...process.env,...patch}});
  assert.equal(r.status,1);assert.match(r.stderr,/STOP_MANAGED_REHEARSAL_MANUAL_CLOUD_SHELL_GATE/);
 }
});
test('verification deadline still permits cleanup of this proven owned temporary database',async()=>{
 const f=fixture(),b=approveAggregateBudget(approvedFixture());let clock=NOW;
 await assert.rejects(run(f,{reviewedBudget:b,now:()=>clock,restore:async snap=>{
  const result=await f.restore(snap);clock+=46*60000;return result;
 }}),/EXECUTION_BUDGET/);
 assert.equal(f.deleted,true);
 assert(!f.calls.some(x=>x.method==='DELETE'&&x.url.includes('(default)')));
});

test('latest recent READY backup requires an independent reviewed budget and unused destination',()=>{
 assert.equal(selectBackup(databases,backups,NOW,budget).selected.name,BACKUP);
 for(const change of [b=>b.databaseUid='wrong-uid',
  b=>b.snapshotTime=new Date(NOW-49*3600000).toISOString(),
  b=>b.name=b.name.replace('asia-northeast1','us-central1')]){
  const f=clone(backups);change(f.backups[0]);
  assert.throws(()=>selectBackup(databases,f,NOW,budget),/STOP_MANAGED_/);
 }
 assert.throws(()=>selectBackup({databases:[sourceMeta,restoredMeta()]},backups,NOW,budget),/DESTINATION_OCCUPIED/);
});
test('invented Backup.stats cannot replace capacity, JPY costs and authorization evidence',()=>{
 const fake=clone(backups);fake.backups[0].stats={documentCount:'2',sizeBytes:'500'};
 assert.throws(()=>selectBackup(databases,fake,NOW),/CAPACITY_AND_COST_EVIDENCE_REQUIRED/);
 for(const edit of [x=>x.backup='other',x=>x.sourceUid='other',x=>x.snapshotTime='other',
  x=>x.reviewedAt=new Date(NOW-3600001).toISOString(),x=>x.reviewedAt=new Date(NOW+1).toISOString(),
  x=>x.currency='USD',x=>x.authorizedMaxJpy=501,x=>x.estimatedAdditionalCostJpy=501,
  x=>x.capacityEvidenceReviewed=false,x=>x.pricingAndVerificationCostsReviewed=false,
  x=>x.estimatedAdditionalCostJpy=NaN,x=>x.sizeUpperBoundBytes=0,
  x=>x.sizeUpperBoundBytes=33*1024*1024,x=>x.maxDocuments=10001]){
  const b=clone(budget);edit(b);
  assert.throws(()=>selectBackup(databases,backups,NOW,b),/STOP_MANAGED_REHEARSAL_/);
 }
});
test('a different latest backup invalidates a prior cost review instead of silently falling back',()=>{
 const newer={...backup,name:BACKUP+'-new',snapshotTime:new Date(NOW-1800000).toISOString()};
 assert.throws(()=>selectBackup(databases,{backups:[newer,backup]},NOW,budget),/COST_EVIDENCE_INVALID/);
 assert.equal(inspectBackup(databases,{backups:[newer,backup]},NOW).selected.name,newer.name);
});

test('transport rejects production deletes, document writes, foreign backups and destinations',()=>{
 for(const [method,url,body] of [
  ['DELETE',API+SOURCE],['PATCH',API+SOURCE+'/documents/records/r1',{fields:{}}],
  ['POST',DB+':restore',{databaseId:'(default)',backup:BACKUP}],
  ['POST',DB+':restore',{databaseId:DESTINATION,backup:BACKUP,extra:true}],
  ['POST',DB+':restore',{databaseId:DESTINATION,backup:BACKUP.replace(PROJECT,'other')}],
  ['GET','https://example.com/anything'],['POST',API+TARGET+'/documents:commit',{writes:[]}],
  ['GET',API+SOURCE+'/operations/foreign'],['GET',API+SOURCE+'/documentsx'],
  ['GET',API+TARGET+'/documentsx'],['POST',API+SOURCE+'/documentsx:listCollectionIds',{}]
 ])assert.equal(permittedCall(method,url,body,{backup:BACKUP,etag:'etag-123',operation:OP}),false,method+' '+url);
 assert.equal(permittedCall('POST',DB+':restore',{databaseId:DESTINATION,backup:BACKUP},{backup:BACKUP}),true);
 assert.equal(permittedCall('DELETE',API+TARGET+'?etag=etag-123',undefined,{etag:'etag-123'}),true);
 assert.equal(permittedCall('DELETE',API+TARGET+'?etag=other',undefined,{etag:'etag-123'}),false);
 assert.equal(permittedCall('POST',IAM,{permissions:[...PERMISSIONS,'owner']}),false);
});

test('inspect performs no restore, deletion, document reads or Rules mutation',async()=>{
 const f=fixture({permissions:[]});
 const result=await run(f,{mode:'inspect'});
 assert.deepEqual(result.missingPermissions,PERMISSIONS);
 assert.equal(result.managedBackupRestored,false);
 assert.equal(result.temporaryDatabaseCreated,false);
 assert(f.calls.every(x=>x.method==='GET'||x.url===IAM));
 assert(!f.calls.some(x=>x.url.includes('/documents')));
});

test('inspect reports independent cost evidence missing without pretending stats will materialize',async()=>{
 const f=fixture({permissions:[]});
 const proof=await run(f,{mode:'inspect',reviewedBudget:undefined});
 assert.equal(proof.backupApiProvidesSizeAndDocumentCount,false);
 assert.equal(proof.restoreCapacityAndCostVerified,false);
 assert.equal(proof.restoreBlockedByMissingCapacityAndCostEvidence,true);
 assert.equal(proof.backupSizeWithin32MiB,false);
 assert.deepEqual(proof.missingPermissions,PERMISSIONS);
 assert.equal(proof.managedBackupRestored,false);
 assert(!f.calls.some(x=>x.url===DB+':restore'||x.method==='DELETE'||x.url.includes('/documents')));
 for(const value of [UID,OTHER,BACKUP,'etag-123'])assert(!JSON.stringify(proof).includes(value));
});
test('without an independent reviewed cost provider, restore stops before reads or writes',async()=>{
 const f=fixture();
 await assert.rejects(run(f,{reviewedBudget:undefined}),/CAPACITY_AND_COST_EVIDENCE_REQUIRED/);
 assert(!f.calls.some(x=>x.url===DB+':restore'||x.method==='DELETE'||x.url.includes('/documents')));
});
test('over-budget independent review stops even with every IAM permission',async()=>{
 const f=fixture();
 await assert.rejects(run(f,{reviewedBudget:{...budget,estimatedAdditionalCostJpy:501}}),/COST_EVIDENCE_INVALID/);
 assert(!f.calls.some(x=>x.url===DB+':restore'||x.method==='DELETE'||x.url.includes('/documents')));
});

test('missing cleanup permission blocks before restoring a database or reading documents',async()=>{
 const f=fixture({permissions:PERMISSIONS.filter(x=>x!=='datastore.databases.delete')});
 await assert.rejects(run(f),/MISSING_RESTORE_OR_CLEANUP_PERMISSION/);
 assert(!f.calls.some(x=>x.url.endsWith(':restore')||x.url.includes('/documents')));
});

test('synthetic managed operation separately verifies fields/IDs, invariants and owned cleanup',async()=>{
 const f=fixture(),result=await run(f);
 assert.equal(result.managedBackupRestored,true);
 assert.equal(result.temporaryDatabaseDeleted,true);
 assert.equal(result.productionSnapshotUnchanged,true);
 assert.equal(result.restoredFieldsAndIdsVerified,true);
 assert.equal(result.backupMatchesCurrentDocumentFields,true);
 assert.equal(result.fullCutoverApproved,false);
 assert.equal(result.sourceDocumentWrites,0);
 assert(f.deleted);
 const output=JSON.stringify(result);
 for(const privateValue of [UID,OTHER,BACKUP,'retained-reference','AAEC','etag-123'])
  assert(!output.includes(privateValue));
});

test('source changes and empty restored inventories fail, then clean up only this verified temporary DB',async()=>{
 for(const o of [{changedSource:true},{emptyRestored:true}]){
  const f=fixture(o);await assert.rejects(run(f),/SOURCE_CHANGED|No documents found; refusing an empty backup/);assert(f.deleted);
 }
 const f=fixture();
 await assert.rejects(run(f,{restore:async()=>{throw Error('secret document data')}}),/secret document data/);
 assert(f.deleted);
});

test('an incomplete local restore fails field/ID verification and still cleans up',async()=>{
 const f=fixture();
 await assert.rejects(run(f,{restore:async()=>({fieldsAndIdsVerified:true,
  productionTouched:false,documentCount:1,sourceInventoryFingerprint:'incomplete'})}),/FIELDS_AND_IDS_NOT_VERIFIED/);
 assert(f.deleted);
});

test('concurrent or unverified restored database provenance is never deleted',async()=>{
 for(const option of [{concurrentConflict:true},{operationFailed:true},{missingAcknowledgedUid:true}]){
  const race=fixture(option);
  await assert.rejects(run(race),/CLEANUP_REQUIRES_OPERATOR/);
  assert(!race.calls.some(x=>x.method==='DELETE'));
 }
 const f=fixture({foreignUid:true});
 await assert.rejects(run(f),/CLEANUP_REQUIRES_OPERATOR/);
 assert(!f.calls.some(x=>x.method==='DELETE'));
 const db=restoredMeta(),criteria={backup:BACKUP,sourceUid:UID,started:NOW,operation:OP,uid:OTHER};
 assert.equal(validateRestoredDatabase(db,criteria).uid,OTHER);
 for(const change of [x=>x.name=SOURCE,x=>x.uid=UID,x=>x.uid='someone-else-uuid',
  x=>x.etag='',x=>x.sourceInfo.backup.backup='wrong',x=>x.createTime='2025-01-01T00:00:00Z']){
  const copy=clone(db);change(copy);assert.throws(()=>validateRestoredDatabase(copy,criteria),/PROVENANCE/);
 }
});

test('collector remaps only names and rejects foreign documents; typed references remain unchanged',async()=>{
 const f=fixture();const result=await isolatedCollector(async()=>({documents:[{
  name:TARGET+'/documents/items/i1',fields:{r:{referenceValue:TARGET+'/documents/items/i2'}}
 }]}))('GET',API+SOURCE+'/documents/items?pageSize=100');
 assert.equal(result.documents[0].name,SOURCE+'/documents/items/i1');
 assert.equal(result.documents[0].fields.r.referenceValue,TARGET+'/documents/items/i2');
 await assert.rejects(isolatedCollector(async()=>({documents:[{name:SOURCE+'/documents/items/i1'}]}))(
  'GET',API+SOURCE+'/documents/items'),/FOREIGN_DOCUMENT/);
});

test('local cloud-backup rehearsal uses the actual existing emulator field/ID verifier',{
 skip:!process.env.FIRESTORE_EMULATOR_HOST
},async()=>{
 const f=fixture();
 const result=await run(f,{restore:restoreToLocalEmulator,emulatorHost:process.env.FIRESTORE_EMULATOR_HOST});
 assert.equal(result.restoredFieldsAndIdsVerified,true);
 assert.equal(result.temporaryDatabaseDeleted,true);
});

test('workflow is manual for cloud calls; credentials and private data never enter artifacts',()=>{
 const wf=readFileSync(new URL('../.github/workflows/nico-managed-backup-rehearsal-manual.yml',import.meta.url),'utf8');
 assert.match(wf,/github.event_name == 'workflow_dispatch'/);
 assert.match(wf,/inputs.reviewed_main_sha == github.sha/);
 assert.match(wf,/needs.offline.result == 'success'/);
 assert.match(wf,/contents: read/);
 assert.match(wf,/RESTORE_TEMPORARY_DATABASE_AND_CLEAN_UP/);
 assert.doesNotMatch(wf,/upload-artifact|firebase deploy|roles\/owner|roles\/editor/);
 assert.match(wf,/rm -f/);
 assert(wf.includes('6d3f165791188394d473417414e34208cd56bae6|9eca5c49957d370bbf092b9783dfa0e97f1a735a'));
 assert.match(wf,/STOP_UNREVIEWED_RULES/);
});
