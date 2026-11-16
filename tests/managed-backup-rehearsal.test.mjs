import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROJECT,DESTINATION,TARGET,PERMISSIONS,permittedCall,selectBackup,
 validateRestoredDatabase,isolatedCollector,rehearse} from '../tools/production/rehearse-managed-backup.mjs';
import {fingerprint} from '../tools/readonly-backup/backup.mjs';
import {restoreToLocalEmulator} from '../tools/readonly-backup/restore-emulator.mjs';
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
 snapshotTime:new Date(NOW-3600000).toISOString(),expireTime:new Date(NOW+86400000*6).toISOString(),
 stats:{documentCount:'2',sizeBytes:'500'}};
const databases={databases:[sourceMeta]},backups={backups:[backup]};
const restoredMeta=()=>({name:TARGET,uid:OTHER,type:'FIRESTORE_NATIVE',locationId:'asia-northeast1',
 createTime:new Date(NOW).toISOString(),etag:'etag-123',sourceInfo:{backup:{backup:BACKUP},operation:OP},
 deleteProtectionState:'DELETE_PROTECTION_DISABLED'});
const clone=x=>structuredClone(x);
function fixture(options={}){
 const calls=[];let created=false,deleted=false,defaultRead=0;
 const send=async(method,url,body)=>{
  calls.push({method,url,body});
  const response=(data,status=200)=>({status,json:async()=>clone(data)});
  if(url===IAM)return response({permissions:options.permissions??PERMISSIONS});
  if(url===DB)return response({databases:[clone(sourceMeta),...(created&&!deleted?[restoredMeta()]:[])]});
  if(url===BACKUPS)return response(backups);
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
  const count=prefix===TARGET&&options.countMismatch?1:2;
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
 emulatorHost:'127.0.0.1:8080',now:()=>NOW,pause:async()=>{},...extra});

test('latest verified backup has bounded document/byte budget and an unused isolated destination',()=>{
 const selected=selectBackup(databases,backups,NOW);
 assert.equal(selected.selected.name,BACKUP);
 for(const change of [
  b=>b.stats.sizeBytes=String(33*1024*1024),b=>b.stats.documentCount='10001',
  b=>delete b.stats,b=>b.stats.sizeBytes='NaN',b=>b.databaseUid='wrong-uid',
  b=>b.snapshotTime=new Date(NOW-49*3600000).toISOString(),
  b=>b.name=b.name.replace('asia-northeast1','us-central1')
 ]){
  const f=clone(backups);change(f.backups[0]);
  assert.throws(()=>selectBackup(databases,f,NOW),/STOP_MANAGED_/);
 }
 assert.throws(()=>selectBackup({databases:[sourceMeta,restoredMeta()]},backups,NOW),/DESTINATION_OCCUPIED/);
});

test('backup budget failure reasons remain separate and fail closed',()=>{
 const a=clone(backups);a.backups[0].stats.sizeBytes=String(33*1024*1024);
 assert.throws(()=>selectBackup(databases,a,NOW),/STOP_MANAGED_REHEARSAL_BACKUP_SIZE_BUDGET/);
 const b=clone(backups);b.backups[0].stats.documentCount='10001';
 assert.throws(()=>selectBackup(databases,b,NOW),/STOP_MANAGED_REHEARSAL_BACKUP_DOCUMENT_COUNT_BUDGET/);
 const c=clone(backups);delete c.backups[0].stats;
 assert.throws(()=>selectBackup(databases,c,NOW),/STOP_MANAGED_REHEARSAL_BACKUP_STATS_INVALID/);
 const d=clone(backups);d.backups[0].stats.sizeBytes='NaN';
 assert.throws(()=>selectBackup(databases,d,NOW),/STOP_MANAGED_REHEARSAL_BACKUP_STATS_INVALID/);
});
test('fallback uses only a fresh READY backup with verified stats, never a larger backup',()=>{
 const newer=clone(backup);newer.name=newer.name.replace('backup-123','backup-456');
 newer.snapshotTime=new Date(NOW-1800000).toISOString();delete newer.stats;
 const chosen=selectBackup(databases,{backups:[newer,clone(backup)]},NOW);
 assert.equal(chosen.selected.name,BACKUP);
 const old=clone(backup);old.snapshotTime=new Date(NOW-49*3600000).toISOString();
 assert.throws(()=>selectBackup(databases,{backups:[newer,old]},NOW),/BACKUP_STATS_INVALID/);
 const over=clone(newer);over.stats={documentCount:'2',sizeBytes:String(33*1024*1024)};
 assert.throws(()=>selectBackup(databases,{backups:[over,clone(backup)]},NOW),/BACKUP_SIZE_BUDGET/);
 const malformed=clone(backup);malformed.stats={documentCount:'x',sizeBytes:'500'};
 assert.throws(()=>selectBackup(databases,{backups:[newer,malformed]},NOW),/BACKUP_STATS_INVALID/);
 const badLatest=clone(newer);badLatest.stats={documentCount:'x',sizeBytes:'500'};
 assert.throws(()=>selectBackup(databases,{backups:[badLatest,clone(backup)]},NOW),/BACKUP_STATS_INVALID/);
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

test('missing cleanup permission blocks before restoring a database or reading documents',async()=>{
 const f=fixture({permissions:PERMISSIONS.filter(x=>x!=='datastore.databases.delete')});
 await assert.rejects(run(f),/MISSING_RESTORE_OR_CLEANUP_PERMISSION/);
 assert(!f.calls.some(x=>x.url.endsWith(':restore')||x.url.includes('/documents')));
});

test('real managed operation, all fields/IDs, original invariants and temporary cleanup are separately proven',async()=>{
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

test('source changes and missing backup documents fail, then still clean up only this verified temporary DB',async()=>{
 for(const o of [{changedSource:true},{countMismatch:true}]){
  const f=fixture(o);await assert.rejects(run(f),/SOURCE_CHANGED|COUNT_MISMATCH/);assert(f.deleted);
 }
 const f=fixture();
 await assert.rejects(run(f,{restore:async()=>{throw Error('secret document data')}}),/secret document data/);
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
});
