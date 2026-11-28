#!/usr/bin/env node
/** Read-only recovery preparation using the operator's existing Cloud Shell identity.
 * Does NOT restore, create/delete databases, grant IAM, read documents or deploy.
 * Reuses the guarded rehearsal inspector; produces evidence, never approval.
 */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PROJECT,rehearse,PERMISSIONS,MAX_APPROVED_RESTORE_BYTES} from './rehearse-managed-backup.mjs';
import {BACKUPS_URL,DATABASES_URL} from './audit-managed-backup-restore-preflight-readonly.mjs';
import {inspectBackup} from './rehearse-managed-backup.mjs';

export const QUOTE=Object.freeze({reviewedDate:'2026-11-24',currency:'JPY',
 restorePerGiB:40.500479999,readPer100000:6.01179,
 storagePerGiBMonth:18.193574999,egressPerGiB:36.387149999,
 source:'https://cloud.google.com/skus?currency=JPY&filter=Cloud%20Firestore%20Tokyo',
 restoreSku:'CF20-1835-1639',readSku:'20AE-F990-C014',
 storageSku:'46BD-4CEB-6B94',egressSku:'C401-C373-C61E'});
const METRIC='firestore.googleapis.com/storage/data_and_index_storage_bytes';
const STOP=code=>{throw Error('STOP_CLOUD_SHELL_BACKUP_REVIEW_'+code)};
export const AGGREGATE_METRIC='firestore.googleapis.com/storage/backups_storage_bytes';
export const AGGREGATE_ESTIMATE_LIMIT=MAX_APPROVED_RESTORE_BYTES;
const MONITORING_SOURCE='https://cloud.google.com/monitoring/api/metrics_gcp_d_h#firestore';
const PRICE_BASE='https://cloudbilling.googleapis.com/v1beta/skus/';
export const APPROVED_ESTIMATE_CONFIRMATION='RESTORE_128MIB_JPY500_TEMPORARY_DATABASE_AND_CLEAN_UP';
const PRICES=Object.freeze([
 ['restorePerGiB',QUOTE.restoreSku,'GiBy',1],
 ['readPer100000',QUOTE.readSku,'count',100000],
 ['storagePerGiBMonth',QUOTE.storageSku,'GiBy.mo',1],
 ['egressPerGiB',QUOTE.egressSku,'GiBy',1]
]);
export const livePriceUrls=()=>PRICES.map(([,sku])=>PRICE_BASE+sku+'/price?currencyCode=JPY');

/** Current public JPY list prices, not an exchange-rate assumption or billing cap. */
export async function reviewLiveQuote({read,now=Date.now()}={}){
 const quote={...QUOTE,reviewedDate:new Date(now).toISOString().slice(0,10),
  reviewedAt:new Date(now).toISOString(),source:'https://cloudbilling.googleapis.com/v1beta/skus'};
 for(const [key,sku,unit,multiplier] of PRICES){
  const value=await read(PRICE_BASE+sku+'/price?currencyCode=JPY');
  const rate=value?.rate,quantity=Number(rate?.unitInfo?.unitQuantity?.value);
  if(value?.name!=='skus/'+sku+'/price'||value.currencyCode!=='JPY'||
     rate?.unitInfo?.unit!==unit||!Number.isFinite(quantity)||quantity<=0||
     !Array.isArray(rate?.tiers)||!rate.tiers.length)STOP('LIVE_PRICE_SHAPE');
  const amounts=rate.tiers.map(t=>{
   const p=t.listPrice,units=Number(p?.units??0),nanos=p?.nanos??0;
   if(p?.currencyCode!=='JPY'||!Number.isSafeInteger(units)||units<0||
      !Number.isInteger(nanos)||nanos<0||nanos>=1e9)STOP('LIVE_PRICE_CURRENCY');
   return (units+nanos/1e9)/quantity*multiplier;
  });
  quote[key]=Math.max(...amounts);
  if(!Number.isFinite(quote[key])||quote[key]<=0)STOP('LIVE_PRICE_RATE');
 }
 return Object.freeze(quote);
}

export function capacityUrl(snapshotTime){
 const t=Date.parse(snapshotTime);if(!Number.isFinite(t))STOP('SNAPSHOT_TIME');
 const u=new URL('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/timeSeries');
 u.searchParams.set('filter','metric.type="'+METRIC+'" AND resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="(default)" AND resource.labels.location="asia-northeast1"');
 u.searchParams.set('interval.startTime',new Date(t-600000).toISOString());
 u.searchParams.set('interval.endTime',new Date(t+600000).toISOString());
 u.searchParams.set('view','FULL');u.searchParams.set('pageSize','1000');
 return u.href;
}

export function summarizeCapacity(data,snapshotTime){
 const t=Date.parse(snapshotTime),series=data?.timeSeries;
 if(!Number.isFinite(t)||data.nextPageToken||!Array.isArray(series)||series.length!==1)STOP('INCOMPLETE_METRIC');
 const s=series[0],labels=s.resource?.labels;
 // Live Firestore Monitoring responses may use project_id instead of the
 // descriptor's resource_container. Require at least one exact identity;
 // when both are returned, neither may contradict the source project.
 const hasProject=labels!=null&&Object.hasOwn(labels,'project_id');
 const hasContainer=labels!=null&&Object.hasOwn(labels,'resource_container');
 const sourceProjectVerified=(hasProject||hasContainer)&&
  (!hasProject||labels.project_id===PROJECT)&&
  (!hasContainer||[PROJECT,'projects/'+PROJECT,'projects/904932511564'].includes(labels.resource_container));
 if(s.metric?.type!==METRIC||s.resource?.type!=='firestore.googleapis.com/Database'||
    labels?.database_id!=='(default)'||labels.location!=='asia-northeast1'||
    !sourceProjectVerified)STOP('METRIC_SOURCE');
 if(!Array.isArray(s.points)||!s.points.length)STOP('MISSING_POINTS');
 const points=s.points.map(p=>{
  const at=Date.parse(p.interval?.endTime),raw=p.value?.int64Value;
  if(!Number.isFinite(at)||Math.abs(at-t)>600000||typeof raw!=='string'||!/^\d+$/.test(raw)||
     !Number.isSafeInteger(Number(raw))||Number(raw)<1)STOP('INVALID_POINT');
  return {at,bytes:Number(raw)};
 });
 const before=points.filter(p=>p.at<=t).sort((a,b)=>b.at-a.at)[0];
 const after=points.filter(p=>p.at>=t).sort((a,b)=>a.at-b.at)[0];
 if(!before||!after||t-before.at>120000||after.at-t>120000)STOP('SNAPSHOT_NOT_BRACKETED');
 return {metric:METRIC,snapshotTime,samples:points.length,
  sampleBefore:new Date(before.at).toISOString(),sampleAfter:new Date(after.at).toISOString(),
  minObservedBytes:Math.min(...points.map(p=>p.bytes)),maxObservedBytes:Math.max(...points.map(p=>p.bytes)),
  exactBackupSizeVerified:false,capacityUpperBoundApproved:false};
}

/** A conditional estimate is not permission to restore and cannot become
 * reviewedBudget: no invented Backup.stats or automatic size extrapolation.
 * The 32 MiB and 10,000-document guard of the existing runner stays intact.
 */
export function conditionalCost({sizeUpperBoundBytes,maxBillableReads,networkUpperBoundBytes,
 retentionDays=1,now=Date.now()}={}){
 if(new Date(now).toISOString().slice(0,10)!==QUOTE.reviewedDate)STOP('STALE_QUOTE');
 for(const value of [sizeUpperBoundBytes,maxBillableReads,networkUpperBoundBytes])
  if(!Number.isSafeInteger(value)||value<1)STOP('UNREVIEWED_COST_BOUNDS');
 if(sizeUpperBoundBytes>32*1024*1024||!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>1)
  STOP('EXISTING_BUDGET_GUARD');
 const gib=sizeUpperBoundBytes/2**30;
 const parts={restore:gib*QUOTE.restorePerGiB,
  reads:maxBillableReads/100000*QUOTE.readPer100000,
  storage:gib*QUOTE.storagePerGiBMonth/28*retentionDays,
  network:networkUpperBoundBytes/2**30*QUOTE.egressPerGiB,
  databaseCreateAndDelete:0};
 const includingTaxAndMargin=Math.ceil(Object.values(parts).reduce((a,b)=>a+b,0)*1.1*2);
 if(includingTaxAndMargin>500)STOP('COST_EXCEEDS_500_JPY');
 return {currency:'JPY',parts,includingTaxAndMargin,authorizedLimit:500,
  conditionalOnIndependentlyVerifiedBounds:true,releaseApproved:false};
}

/** New Owner-approved estimate route. The aggregate metric is delayed and
 * does not give a document count. It must NEVER manufacture reviewedBudget
 * or certify a hard billing cap. The paid lifecycle remains separate.
 */
export function aggregateCapacityUrl(now){
 if(!Number.isFinite(now))STOP('AGGREGATE_TIME');
 const u=new URL('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/timeSeries');
 u.searchParams.set('filter','metric.type="'+AGGREGATE_METRIC+'" AND resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="(default)" AND resource.labels.location="asia-northeast1"');
 u.searchParams.set('interval.startTime',new Date(now-20*60000).toISOString());
 u.searchParams.set('interval.endTime',new Date(now).toISOString());
 u.searchParams.set('view','FULL');u.searchParams.set('pageSize','1000');
 return u.href;
}
export function summarizeAggregateCapacity(data,{now,snapshotTime,sourceObservedBytes}={}){
 const snapshot=Date.parse(snapshotTime),series=data?.timeSeries;
 if(!Number.isFinite(now)||!Number.isFinite(snapshot)||now-snapshot<15*60000||
    data.nextPageToken||!Array.isArray(series)||series.length!==1||
    !Number.isSafeInteger(sourceObservedBytes)||sourceObservedBytes<1)STOP('AGGREGATE_INCOMPLETE');
 const s=series[0],labels=s.resource?.labels;
 const hasProject=labels!=null&&Object.hasOwn(labels,'project_id');
 const hasContainer=labels!=null&&Object.hasOwn(labels,'resource_container');
 if(s.metric?.type!==AGGREGATE_METRIC||s.resource?.type!=='firestore.googleapis.com/Database'||
    labels?.database_id!=='(default)'||labels.location!=='asia-northeast1'||
    !(hasProject||hasContainer)||(hasProject&&labels.project_id!==PROJECT)||
    (hasContainer&&![PROJECT,'projects/'+PROJECT,'projects/904932511564'].includes(labels.resource_container)))STOP('AGGREGATE_SOURCE');
 if(!Array.isArray(s.points)||s.points.length<2||s.points.length>1000)STOP('AGGREGATE_POINTS');
 const points=s.points.map(p=>{
  const at=Date.parse(p.interval?.endTime),v=p.value?.int64Value;
  if(!Number.isFinite(at)||at<now-20*60000||at>now||
     typeof v!=='string'||!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)STOP('AGGREGATE_POINT');
  return {at,bytes:Number(v)};
 }).sort((a,b)=>a.at-b.at);
 if(new Set(points.map(p=>p.at)).size!==points.length)STOP('AGGREGATE_DUPLICATE');
 const after=points.filter(p=>p.at>=snapshot+10*60000);
 if(after.length<2||now-after.at(-1).at>10*60000)STOP('AGGREGATE_STALE');
 const maximum=Math.max(...after.map(p=>p.bytes));
 // Reject even a downward outlier below sampled source storage; never
 // equate total backup storage to one exact backup or invent its stats.
 if(after.some(p=>p.bytes<sourceObservedBytes))STOP('AGGREGATE_UNDER_SOURCE');
 if(maximum>AGGREGATE_ESTIMATE_LIMIT)STOP('AGGREGATE_ESTIMATE_LIMIT');
 return {metric:AGGREGATE_METRIC,source:MONITORING_SOURCE,samples:after.length,
  latestSample:new Date(after.at(-1).at).toISOString(),maxObservedAllBackupBytes:maximum,
  estimateCapacityCeilingBytes:AGGREGATE_ESTIMATE_LIMIT,exactBackupSizeVerified:false,
  exactBackupDocumentCountVerified:false,capacityUpperBoundApproved:false};
}
export function aggregateConditionalCost(now,quote=QUOTE){
 if(new Date(now).toISOString().slice(0,10)!==quote.reviewedDate)STOP('STALE_QUOTE');
 if(quote.currency!=='JPY'||PRICES.some(([key])=>!Number.isFinite(quote[key])||quote[key]<=0))STOP('LIVE_PRICE_RATE');
 // Round the estimate up to a whole GiB; this does not enlarge the approved
 // 128 MiB capacity ceiling or assert that Google bills a one-GiB minimum.
 const gib=Math.ceil(AGGREGATE_ESTIMATE_LIMIT/2**30);
 // Three bounded traversals (before, isolated restore, after). Existing
 // collector permits at most 80,400 requests and 30,500 references per
 // traversal; 400,000 read units is a planning allowance, not a runtime
 // billable-read meter. Allow two billing days at the day boundary.
 const parts={restore:gib*quote.restorePerGiB,reads:4*quote.readPer100000,
  storage:gib*quote.storagePerGiBMonth/28*2,network:quote.egressPerGiB,
  databaseCreateAndDelete:0};
 const includingTaxAndMargin=Math.ceil(Object.values(parts).reduce((a,b)=>a+b,0)*1.1*2);
 if(includingTaxAndMargin>500)STOP('COST_EXCEEDS_500_JPY');
 return {currency:'JPY',parts,includingTaxAndMargin,authorizedLimit:500,
  assumedMaximumReads:400000,assumedNetworkBytes:2**30,assumedRetentionDays:2,
  maxCollectorDocuments:10000,conditionalOnExecutionBounds:true,
  estimateRoundedUpToWholeGiB:true,
  hardBillingCapVerified:false,releaseApproved:false};
}
export async function reviewAggregateBudget({read,inspect,now=Date.now(),quote=QUOTE}={}){
 const base=await review({read,inspect,now});
 if(base.missingPermissions.length)STOP('AGGREGATE_MISSING_IAM');
 const aggregate=summarizeAggregateCapacity(await read(aggregateCapacityUrl(now)),{
  now,snapshotTime:base.backupSnapshotTime,sourceObservedBytes:base.capacity.maxObservedBytes});
 return {...base,mode:'cloud-shell-aggregate-budget-readonly',aggregate,
  estimatedCost:aggregateConditionalCost(now,quote),quote,paidRestoreAuthorized:false,
  restoreCapacityAndCostVerified:false,managedBackupRestored:false};
}

/** Explicit operator approval connects independently read evidence to the existing
 * lifecycle. Neither a metric nor this read-only reviewer grants approval itself. */
export function approveAggregateBudget({review,databases,backups,confirmation,now=Date.now()}={}){
 if(confirmation!==APPROVED_ESTIMATE_CONFIRMATION)STOP('EXPLICIT_ESTIMATE_APPROVAL_REQUIRED');
 const {selected,current}=inspectBackup(databases,backups,now);
 const a=review?.aggregate,c=review?.capacity,q=review?.quote;
 const checked=Date.parse(q?.reviewedAt),latest=Date.parse(a?.latestSample);
 if(review?.project!==PROJECT||review.mode!=='cloud-shell-aggregate-budget-readonly'||
    review.backupSnapshotTime!==selected.snapshotTime||review.missingPermissions?.length!==0||
    !Number.isFinite(checked)||checked>now||now-checked>3600000||
    q.source!=='https://cloudbilling.googleapis.com/v1beta/skus'||
    a?.metric!==AGGREGATE_METRIC||!Number.isInteger(a.samples)||a.samples<2||!Number.isFinite(latest)||
    latest>now||now-latest>600000||latest<Date.parse(selected.snapshotTime)+600000||
    a.estimateCapacityCeilingBytes!==AGGREGATE_ESTIMATE_LIMIT||
    c?.metric!==METRIC||c.snapshotTime!==selected.snapshotTime||
    !Number.isSafeInteger(c.maxObservedBytes)||c.maxObservedBytes<1||
    !Number.isSafeInteger(a.maxObservedAllBackupBytes)||
    a.maxObservedAllBackupBytes<c.maxObservedBytes||a.maxObservedAllBackupBytes>AGGREGATE_ESTIMATE_LIMIT||
    a.exactBackupSizeVerified!==false||a.exactBackupDocumentCountVerified!==false)
  STOP('APPROVED_ESTIMATE_EVIDENCE');
 const cost=aggregateConditionalCost(now,q);
 if(JSON.stringify(cost)!==JSON.stringify(review.estimatedCost))STOP('APPROVED_ESTIMATE_COST_DRIFT');
 return Object.freeze({backup:selected.name,sourceUid:current.uid,snapshotTime:selected.snapshotTime,
  reviewedAt:new Date(now).toISOString(),currency:'JPY',authorizedMaxJpy:500,
  estimatedAdditionalCostJpy:cost.includingTaxAndMargin,capacityEvidenceReviewed:true,
  pricingAndVerificationCostsReviewed:true,sizeUpperBoundBytes:AGGREGATE_ESTIMATE_LIMIT,maxDocuments:10000,
  capacityEvidenceKind:'owner-approved-aggregate-estimate-v1',capacityEvidence:a,pricingEvidence:{quote:q,cost},
  estimateApproval:APPROVED_ESTIMATE_CONFIRMATION,
  maxBillableReads:400000,networkUpperBoundBytes:2**30,retentionDays:2,
  exactBackupSizeVerified:false,hardBillingCapVerified:false});
}

export async function review({read,inspect,now=Date.now()}={}){
 if(typeof read!=='function'||typeof inspect!=='function')STOP('TRANSPORT');
 const databases=await read(DATABASES_URL),backups=await read(BACKUPS_URL);
 const metadata=inspectBackup(databases,backups,now);
 const permissions=await inspect();
 if(permissions.mode!=='inspect'||permissions.backupSnapshotTime!==metadata.selected.snapshotTime||
    !Array.isArray(permissions.missingPermissions)||new Set(permissions.missingPermissions).size!==permissions.missingPermissions.length||
    permissions.missingPermissions.some(p=>!PERMISSIONS.includes(p))||permissions.managedBackupRestored!==false||
    permissions.sourceDocumentWrites!==0||permissions.sourceRulesWrites!==0||permissions.deployments!==0)
  STOP('INSPECT_CONTRACT');
 const capacity=summarizeCapacity(await read(capacityUrl(metadata.selected.snapshotTime)),metadata.selected.snapshotTime);
 return {project:PROJECT,mode:'cloud-shell-readonly-review',
  backupSnapshotTime:metadata.selected.snapshotTime,missingPermissions:permissions.missingPermissions,
  capacity,quote:QUOTE,restoreCapacityAndCostVerified:false,managedBackupRestored:false,
  temporaryDatabaseCreated:false,temporaryDatabaseDeleted:false,sourceDocumentWrites:0,deployments:0};
}

async function main(){
 const sha=process.argv[2];
 const aggregate=process.argv.length===4&&process.argv[3]==='--aggregate-budget';
 if((process.argv.length!==3&&!aggregate)||!/^[a-f0-9]{40}$/.test(sha||'')||
    process.env.CLOUD_SHELL!=='true'||process.env.DEVSHELL_PROJECT_ID!==PROJECT)STOP('CLOUD_SHELL_ONLY');
 const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
 if(run('git',['rev-parse','HEAD'])!==sha||run('gcloud',['config','get-value','project'])!==PROJECT)STOP('CHECKOUT_OR_PROJECT');
 run('git',['diff','--exit-code','HEAD','--','tools/production','tools/readonly-backup']);
 const token=run('gcloud',['auth','print-access-token']); // Never printed, persisted or sent outside Google APIs.
 if(!token)STOP('IDENTITY');
 const send=async(method,url,body)=>fetch(url,{method,redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const read=async url=>{
  if(![DATABASES_URL,BACKUPS_URL,...livePriceUrls()].includes(url)&&
     !url.startsWith('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/timeSeries?'))STOP('GET_SCOPE');
  const r=await send('GET',url);if(r.status!==200)STOP('HTTP_'+r.status);
  return r.json();
 };
 const quote=aggregate?await reviewLiveQuote({read}):QUOTE;
 const output=await (aggregate?reviewAggregateBudget:review)({read,quote,inspect:()=>rehearse({mode:'inspect',send})});
 console.log('NICO_CLOUD_SHELL_BACKUP_REVIEW '+JSON.stringify(output));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(/^STOP_(?:CLOUD_SHELL_BACKUP_REVIEW|MANAGED_REHEARSAL|MANAGED_BACKUP_PREFLIGHT)_[A-Z0-9_]+$/.test(e?.message||'')?
  e.message:'STOP_CLOUD_SHELL_BACKUP_REVIEW_REDACTED');process.exitCode=1;});
