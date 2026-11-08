import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 PROJECT,SOURCE,DESTINATION,BACKUPS_URL,DATABASES_URL,
 summarizeManagedRestorePreflight,inspectManagedRestorePreflight
} from "../tools/production/audit-managed-backup-restore-preflight-readonly.mjs";

const NOW=Date.parse("2026-11-08T08:00:00Z");
const UID="123e4567-e89b-42d3-a456-426614174000";
const backupName="projects/"+PROJECT+"/locations/asia-northeast1/backups/backup01";
const hours=h=>new Date(NOW+h*3600000).toISOString();
const clone=x=>JSON.parse(JSON.stringify(x));
const fixtures=()=>({
 databases:{databases:[{
  name:SOURCE,uid:UID,type:"FIRESTORE_NATIVE",locationId:"asia-northeast1",
  deleteProtectionState:"DELETE_PROTECTION_ENABLED"
 }]},
 backups:{backups:[{
  name:backupName,database:SOURCE,databaseUid:UID,
  state:"READY",snapshotTime:hours(-2),expireTime:hours(100)
 }],unreachable:[]}
});
const summarize=x=>summarizeManagedRestorePreflight({...x,nowMs:NOW});

test("real managed backup UID + location + expiry and separate unused DB ID pass metadata-only",()=>{
 const f=fixtures();
 const report=summarize(f);
 assert.equal(report.project,PROJECT);
 assert.equal(report.readyBackupCount,1);
 assert.equal(report.selectedBackupAgeHours,2);
 assert.equal(report.backupRestoreMetadataPreflightPassed,true);
 assert.equal(report.destinationDatabaseIdUnusedAtAudit,true);
 assert.equal(report.sourceDatabaseUidAndLocationVerified,true);
 assert.equal(report.backupPayloadDownloaded,false);
 assert.equal(report.managedBackupRestored,false);
 assert.equal(report.sourceDocumentWrites,0);
 assert.equal(report.destinationDatabaseCreated,false);
 assert.equal(report.restoreAuthorizationGranted,false);
 assert.equal(report.chargesBoundedOrTrialVerified,false);
 assert.equal(report.fullProductionCutoverApproved,false);
 const serialized=JSON.stringify(report);
 assert(!serialized.includes(UID));
 assert(!serialized.includes(backupName));
 assert(!serialized.includes(DESTINATION));
 assert(!serialized.includes("access_token"));
});

test("stale, expired and future snapshots never claim a current safe backup",()=>{
 for(const key of [
  b=>{b.snapshotTime=hours(-49);},
  b=>{b.expireTime=hours(20);},
  b=>{b.snapshotTime=hours(1);}
 ]){
  const f=fixtures();key(f.backups.backups[0]);
  const report=summarize(f);
  assert.equal(report.backupRestoreMetadataPreflightPassed,false);
  assert.equal(report.managedBackupRestored,false);
 }
});

test("wrong database UID, location, invalid timestamp and missing identity block without writes",()=>{
 const variants=[
  b=>{b.databaseUid="other-db-uid";},
  b=>{b.name=b.name.replace("asia-northeast1","us-central1");},
  b=>{b.expireTime="garbage";},
  b=>{b.snapshotTime="not-a-time";},
  b=>{b.state="AVAILABLE";},
  b=>{b.name="projects/other/locations/asia-northeast1/backups/backup01";},
  b=>{delete b.databaseUid;},
  b=>{b.expireTime=b.snapshotTime;}
 ];
 for(let i=0;i<variants.length;i++){
  const f=fixtures();variants[i](f.backups.backups[0]);
  assert.throws(()=>summarize(f),/STOP_MANAGED_BACKUP_PREFLIGHT_/,String(i));
 }
});

test("unreachable locations and incomplete or duplicate backup inventory must fail closed",()=>{
 const scenarios=[
  f=>{f.backups.unreachable=["asia-northeast1"];},
  f=>{f.backups.nextPageToken="unread-page";},
  f=>{f.backups.backups.push(clone(f.backups.backups[0]));},
  f=>{f.backups.backups={};},
  f=>{f.databases.nextPageToken="more";},
  f=>{f.databases.databases.push(clone(f.databases.databases[0]));},
  f=>{f.databases.databases[0].uid="";},
  f=>{f.databases.databases[0].type="DATASTORE_MODE";},
  f=>{f.databases.databases[0].deleteTime=hours(-1);},
  f=>{f.databases.databases[0].name="projects/other/databases/(default)";}
 ];
 for(let i=0;i<scenarios.length;i++){
  const f=fixtures();scenarios[i](f);
  assert.throws(()=>summarize(f),/STOP_MANAGED_BACKUP_PREFLIGHT_/,String(i));
 }
});

test("target database already occupied or wrong name prevents restore metadata approval",()=>{
 const f=fixtures();
 f.databases.databases.push({
  name:"projects/"+PROJECT+"/databases/"+DESTINATION,
  uid:"another-uuid",type:"FIRESTORE_NATIVE",locationId:"asia-northeast1"
 });
 assert.equal(summarize(f).destinationDatabaseIdUnusedAtAudit,false);
 assert.equal(summarize(f).backupRestoreMetadataPreflightPassed,false);
 const fresh=fixtures();
 for(const dest of ["(default)","Default","prod_restore","a","a".repeat(64),"../sales"]){
  assert.throws(()=>summarizeManagedRestorePreflight({
   ...fresh,nowMs:NOW,destination:dest
  }),/DESTINATION_ID/,dest);
 }
});

test("metadata fetch touches exactly two allowlisted Firestore URLs by GET",async()=>{
 const f=fixtures(),called=[];
 const report=await inspectManagedRestorePreflight({nowMs:NOW,read:async url=>{
  called.push(url);
  assert([BACKUPS_URL,DATABASES_URL].includes(url));
  return {status:200,json:async()=>url===BACKUPS_URL?f.backups:f.databases};
 }});
 assert.equal(report.backupRestoreMetadataPreflightPassed,true);
 assert.deepEqual(called.sort(),[BACKUPS_URL,DATABASES_URL].sort());
 for(const err of [
  async()=>{throw Error("secret-token");},
  async()=>({status:403}),
  async()=>({status:404}),
  async()=>({status:200,json:async()=>{throw Error("secret-json");}})
 ]){
  await assert.rejects(inspectManagedRestorePreflight({nowMs:NOW,read:err}),
   /STOP_MANAGED_BACKUP_PREFLIGHT_/);
 }
});

test("GET-only source and no cloud create/delete/restore operation in the audit",()=>{
 const text=readFileSync(new URL(
  "../tools/production/audit-managed-backup-restore-preflight-readonly.mjs",
  import.meta.url),"utf8");
 assert.match(text,/method:"GET"/);
 assert.match(text,/STOP_MANAGED_BACKUP_PREFLIGHT_UNEXPECTED_/);
 assert.match(text,/NICO_PREFLIGHT_AUDIT_SOURCE_LINE=/);
 assert.doesNotMatch(text,/console\\.error\\((?:e\\.stack|e\\.message|response)/);
 assert.match(text,/destinationDatabaseCreated:false/);
 assert.match(text,/managedBackupRestored:false/);
 assert.match(text,/restoreAuthorizationGranted:false/);
 assert.match(text,/fullProductionCutoverApproved:false/);
 assert.doesNotMatch(text,/fetch\s*\(\s*["']https:\/\/[^"']+\/databases:restore/);
 assert.doesNotMatch(text,/method\s*:\s*"(?:POST|PUT|PATCH|DELETE)"/);
 assert.doesNotMatch(text,/\.set\s*\(|\.update\s*\(|\.delete\s*\(|firebase deploy|gcloud firestore databases restore/);
});
