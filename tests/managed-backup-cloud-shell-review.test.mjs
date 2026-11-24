import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {capacityUrl,summarizeCapacity,conditionalCost,review,QUOTE,aggregateCapacityUrl,summarizeAggregateCapacity,aggregateConditionalCost,AGGREGATE_METRIC,reviewAggregateBudget} from '../tools/production/review-managed-backup-cloud-shell.mjs';
const SNAP='2026-11-23T07:53:46.403866Z',NOW=Date.parse('2026-11-24T09:00:00Z');
const series=()=>({timeSeries:[{metric:{type:'firestore.googleapis.com/storage/data_and_index_storage_bytes'},
 resource:{type:'firestore.googleapis.com/Database',labels:{database_id:'(default)',location:'asia-northeast1',resource_container:'sales-management-cc116'}},
 points:[{interval:{endTime:'2026-11-23T07:53:00Z'},value:{int64Value:'10000000'}},
 {interval:{endTime:'2026-11-23T07:54:00Z'},value:{int64Value:'10100000'}}]}]});
test('snapshot capacity lookup is fixed to source database, Tokyo and a bounded interval',()=>{
 const u=new URL(capacityUrl(SNAP));assert.equal(u.hostname,'monitoring.googleapis.com');
 assert.equal(u.pathname,'/v3/projects/sales-management-cc116/timeSeries');
 assert.match(u.searchParams.get('filter'),/database_id="\(default\)"/);
 assert.equal(Date.parse(u.searchParams.get('interval.endTime'))-Date.parse(u.searchParams.get('interval.startTime')),1200000);
 assert.equal(u.searchParams.get('pageSize'),'1000');
 assert.throws(()=>capacityUrl('invalid'),/SNAPSHOT_TIME/);
});
test('measured source samples never masquerade as exact or approved backup capacity',()=>{
 const r=summarizeCapacity(series(),SNAP);assert.equal(r.maxObservedBytes,10100000);
 assert.equal(r.exactBackupSizeVerified,false);assert.equal(r.capacityUpperBoundApproved,false);
});
test('foreign databases/projects, missing pages, missing brackets and invalid numbers stop',()=>{
 for(const edit of [x=>x.nextPageToken='more',x=>x.timeSeries.push(x.timeSeries[0]),
  x=>x.timeSeries[0].resource.labels.database_id='foreign',x=>x.timeSeries[0].resource.labels.location='us-central1',
  x=>x.timeSeries[0].resource.labels.resource_container='other',x=>x.timeSeries[0].metric.type='other',
  x=>x.timeSeries[0].points.pop(),x=>x.timeSeries[0].points[0].value.int64Value='NaN',
  x=>x.timeSeries[0].points[0].interval.endTime='2026-11-23T06:00:00Z']){
  const f=series();edit(f);assert.throws(()=>summarizeCapacity(f,SNAP),/STOP_CLOUD_SHELL_/);
 }
});
test('observed live project_id label is accepted only for the exact source project',()=>{
 const f=series(),labels=f.timeSeries[0].resource.labels;
 delete labels.resource_container;labels.project_id='sales-management-cc116';
 assert.equal(summarizeCapacity(f,SNAP).maxObservedBytes,10100000);
 labels.resource_container='projects/sales-management-cc116';
 assert.equal(summarizeCapacity(f,SNAP).capacityUpperBoundApproved,false);
 labels.resource_container='projects/other';
 assert.throws(()=>summarizeCapacity(f,SNAP),/METRIC_SOURCE/);
 labels.resource_container='projects/sales-management-cc116';labels.project_id='other';
 assert.throws(()=>summarizeCapacity(f,SNAP),/METRIC_SOURCE/);
 delete labels.resource_container;
 assert.throws(()=>summarizeCapacity(f,SNAP),/METRIC_SOURCE/);
 delete labels.project_id;
 assert.throws(()=>summarizeCapacity(f,SNAP),/METRIC_SOURCE/);
 labels.project_id=null;
 assert.throws(()=>summarizeCapacity(f,SNAP),/METRIC_SOURCE/);
});
const bounds={sizeUpperBoundBytes:32*1024*1024,maxBillableReads:400000,
 networkUpperBoundBytes:2**30,retentionDays:1,now:NOW};
test('JPY calculation includes restore, reads, temporary storage, network, tax and margin without approval',()=>{
 const r=conditionalCost(bounds);assert.equal(QUOTE.currency,'JPY');assert.equal(r.releaseApproved,false);
 assert.equal(r.conditionalOnIndependentlyVerifiedBounds,true);
 assert.equal(r.includingTaxAndMargin,136);assert(r.includingTaxAndMargin<500);
 assert(r.parts.restore>0&&r.parts.reads>0&&r.parts.storage>0&&r.parts.network>0);
});
test('unknown bounds, stale quotes and over-budget estimates cannot authorize a restore',()=>{
 for(const patch of [{maxBillableReads:undefined},{networkUpperBoundBytes:NaN},{sizeUpperBoundBytes:33*1024*1024},
  {retentionDays:2},{now:Date.parse('2026-11-25T09:00:00Z')},{networkUpperBoundBytes:100*2**30}])
  assert.throws(()=>conditionalCost({...bounds,...patch}),/STOP_CLOUD_SHELL_/);
});
test('real adapter orchestration reads only source metadata and the matching metric, preserving stop conditions',async()=>{
 const calls=[],source='projects/sales-management-cc116/databases/(default)',uid='source-database-uuid-1234';
 const proof={mode:'inspect',backupSnapshotTime:SNAP,missingPermissions:[],managedBackupRestored:false,
  sourceDocumentWrites:0,sourceRulesWrites:0,deployments:0};
 const read=async url=>{calls.push(url);
  if(url.endsWith('/databases'))return {databases:[{name:source,uid,type:'FIRESTORE_NATIVE',locationId:'asia-northeast1'}]};
  if(url.endsWith('/backups'))return {backups:[{name:'projects/sales-management-cc116/locations/asia-northeast1/backups/backup-synthetic',
   database:source,databaseUid:uid,state:'READY',snapshotTime:SNAP,expireTime:'2026-11-30T07:53:46Z'}]};
  assert.equal(url,capacityUrl(SNAP));return series();};
 const r=await review({read,inspect:async()=>proof,now:NOW});
 assert.equal(calls.length,3);assert.equal(r.restoreCapacityAndCostVerified,false);
 assert.equal(r.managedBackupRestored,false);assert.equal(r.capacity.exactBackupSizeVerified,false);
 assert(!JSON.stringify(r).includes(uid));assert(!JSON.stringify(r).includes('backup-synthetic'));
 await assert.rejects(review({read,inspect:async()=>({...proof,backupSnapshotTime:'different'}),now:NOW}),/INSPECT_CONTRACT/);
 await assert.rejects(review({read,inspect:async()=>({...proof,missingPermissions:['roles/owner']}),now:NOW}),/INSPECT_CONTRACT/);
});
test('Cloud Shell adapter is inspection only and cannot invoke the paid lifecycle',()=>{
 const source=readFileSync(new URL('../tools/production/review-managed-backup-cloud-shell.mjs',import.meta.url),'utf8');
 assert.match(source,/CLOUD_SHELL!=='true'/);assert.match(source,/DEVSHELL_PROJECT_ID!==PROJECT/);
 assert.match(source,/rev-parse','HEAD/);assert.match(source,/mode:'inspect'/);
 assert.doesNotMatch(source,/mode:'rehearse'|add-iam-policy-binding|setIamPolicy|firebase deploy|writeFile/);
 assert.match(source,/RESTORE_CAPACITY|restoreCapacityAndCostVerified:false/);
 assert.match(source,/REDACTED/);
});
const aggregateFixture=()=>({timeSeries:[{metric:{type:AGGREGATE_METRIC},resource:{
 type:'firestore.googleapis.com/Database',labels:{project_id:'sales-management-cc116',database_id:'(default)',location:'asia-northeast1'}},
 points:[{interval:{endTime:'2026-11-24T08:55:00Z'},value:{int64Value:'65137541'}},
 {interval:{endTime:'2026-11-24T08:54:00Z'},value:{int64Value:'65137541'}}]}]});
const aggregateInput={now:NOW,snapshotTime:SNAP,sourceObservedBytes:10100000};
test('aggregate estimate checks exact source, post-backup fresh measurements and budget ceiling',()=>{
 const u=new URL(aggregateCapacityUrl(NOW));
 assert.match(u.searchParams.get('filter'),/storage\/backups_storage_bytes/);
 const r=summarizeAggregateCapacity(aggregateFixture(),aggregateInput);
 assert.equal(r.maxObservedAllBackupBytes,65137541);
 assert.equal(r.estimateCapacityCeilingBytes,128*1024*1024);
 assert.equal(r.exactBackupSizeVerified,false);
 assert.equal(r.exactBackupDocumentCountVerified,false);
 assert.equal(r.capacityUpperBoundApproved,false);
 const c=aggregateConditionalCost(NOW);
 assert(c.includingTaxAndMargin<500);assert.equal(c.hardBillingCapVerified,false);
 assert.equal(c.releaseApproved,false);
 assert.throws(()=>aggregateConditionalCost(NOW+86400000),/STALE_QUOTE/);
});
test('aggregate missing, foreign, stale, contradictory, or over-ceiling data never becomes a cost approval',()=>{
 for(const edit of [x=>x.nextPageToken='more',x=>x.timeSeries.push(x.timeSeries[0]),
 x=>x.timeSeries[0].resource.labels.project_id='other',
 x=>x.timeSeries[0].resource.labels.resource_container='other',
 x=>x.timeSeries[0].resource.labels.database_id='wrong',
 x=>x.timeSeries[0].points[0].value.int64Value='134217729',
 x=>x.timeSeries[0].points[0].value.int64Value='100',
 x=>x.timeSeries[0].points[0].value.int64Value='NaN',
 x=>x.timeSeries[0].points.pop(),
 x=>x.timeSeries[0].points.forEach(p=>p.interval.endTime='2026-11-24T08:40:00Z')]){
  const f=aggregateFixture();edit(f);
  assert.throws(()=>summarizeAggregateCapacity(f,aggregateInput),/STOP_CLOUD_SHELL_/);
 }
});
test('new aggregate route only reads metadata and metrics; no authorization, no restore',async()=>{
 const source='projects/sales-management-cc116/databases/(default)',uid='source-database-uuid-1234';
 const proof={mode:'inspect',backupSnapshotTime:SNAP,missingPermissions:[],managedBackupRestored:false,
 sourceDocumentWrites:0,sourceRulesWrites:0,deployments:0};
 const calls=[];
 const read=async url=>{
  calls.push(url);
  if(url.endsWith('/databases'))return {databases:[{name:source,uid,type:'FIRESTORE_NATIVE',locationId:'asia-northeast1'}]};
  if(url.endsWith('/backups'))return {backups:[{name:'projects/sales-management-cc116/locations/asia-northeast1/backups/backup-synthetic',
   database:source,databaseUid:uid,state:'READY',snapshotTime:SNAP,expireTime:'2026-11-30T07:53:46Z'}]};
  if(url===capacityUrl(SNAP))return series();
  assert.equal(url,aggregateCapacityUrl(NOW));return aggregateFixture();
 };
 const result=await reviewAggregateBudget({read,inspect:async()=>proof,now:NOW});
 assert.equal(calls.length,4);assert.equal(result.paidRestoreAuthorized,false);
 assert.equal(result.restoreCapacityAndCostVerified,false);assert.equal(result.managedBackupRestored,false);
 assert.equal(result.temporaryDatabaseCreated,false);assert.equal(result.sourceDocumentWrites,0);
 assert(!JSON.stringify(result).includes(uid));
 await assert.rejects(reviewAggregateBudget({read,inspect:async()=>({...proof,missingPermissions:['datastore.databases.delete']}),now:NOW}),/AGGREGATE_MISSING_IAM/);
});
