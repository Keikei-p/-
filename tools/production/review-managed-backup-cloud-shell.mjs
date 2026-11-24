#!/usr/bin/env node
/** Read-only recovery preparation using the operator's existing Cloud Shell identity.
 * Does NOT restore, create/delete databases, grant IAM, read documents or deploy.
 * Reuses the guarded rehearsal inspector; produces evidence, never approval.
 */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PROJECT,rehearse,PERMISSIONS} from './rehearse-managed-backup.mjs';
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
 if(process.argv.length!==3||!/^[a-f0-9]{40}$/.test(sha||'')||
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
  if(![DATABASES_URL,BACKUPS_URL].includes(url)&&
     !url.startsWith('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/timeSeries?'))STOP('GET_SCOPE');
  const r=await send('GET',url);if(r.status!==200)STOP('HTTP_'+r.status);
  return r.json();
 };
 const output=await review({read,inspect:()=>rehearse({mode:'inspect',send})});
 console.log('NICO_CLOUD_SHELL_BACKUP_REVIEW '+JSON.stringify(output));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(/^STOP_(?:CLOUD_SHELL_BACKUP_REVIEW|MANAGED_REHEARSAL|MANAGED_BACKUP_PREFLIGHT)_[A-Z0-9_]+$/.test(e?.message||'')?
  e.message:'STOP_CLOUD_SHELL_BACKUP_REVIEW_REDACTED');process.exitCode=1;});
