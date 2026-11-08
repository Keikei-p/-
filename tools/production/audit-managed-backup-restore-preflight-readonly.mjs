#!/usr/bin/env node
/**
 * GET ONLY — managed backup restore PREFLIGHT, never the restore itself.
 * Checks READY backup metadata against current production DB UID, location,
 * snapshot recency, expiry and an unused named isolated destination.
 * NO Firestore document reads/writes, POST, IAM, billing or database create.
 * Metadata is NOT proof the backup payload can actually be restored.
 */
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const PROJECT="sales-management-cc116";
export const SOURCE="projects/"+PROJECT+"/databases/(default)";
export const DESTINATION="nico-restore-verification-20261108";
export const BACKUPS_URL="https://firestore.googleapis.com/v1/projects/"+PROJECT+
 "/locations/-/backups";
export const DATABASES_URL="https://firestore.googleapis.com/v1/projects/"+PROJECT+
 "/databases";
const STOP=code=>{throw Error("STOP_MANAGED_BACKUP_PREFLIGHT_"+code);};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const toTime=x=>typeof x==="string"&&TIME.test(x)&&Number.isFinite(Date.parse(x))
 ?Date.parse(x):NaN;
const BACKUP_NAME=/^projects\/sales-management-cc116\/locations\/([a-z0-9-]{2,48})\/backups\/([a-zA-Z0-9_-]{3,128})$/;
const DEST_ID=/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/;
const recent=48*60*60*1000,expiryBuffer=24*60*60*1000;
function validateDatabases(body,destination){
 if(!object(body)||!Array.isArray(body.databases)||
    body.databases.length>100||
    (body.nextPageToken!==undefined&&body.nextPageToken!==""))
   STOP("DATABASE_INVENTORY_INCOMPLETE");
 if(!DEST_ID.test(destination)||destination==="default")STOP("DESTINATION_ID");
 const seen=new Set();
 for(const db of body.databases){
  if(!object(db)||typeof db.name!=="string"||
     !db.name.startsWith("projects/"+PROJECT+"/databases/")||
     seen.has(db.name))STOP("DATABASE_INVENTORY_UNVERIFIED");
  seen.add(db.name);
 }
 const current=body.databases.find(db=>db.name===SOURCE);
 if(!current||typeof current.uid!=="string"||
    !/^[A-Za-z0-9-]{10,80}$/.test(current.uid)||
    current.type!=="FIRESTORE_NATIVE"||
    typeof current.locationId!=="string"||current.locationId.length<2||
    current.deleteTime)STOP("SOURCE_DATABASE_UNVERIFIED");
 return {current,destinationFree:!seen.has("projects/"+PROJECT+"/databases/"+destination)};
}
export function summarizeManagedRestorePreflight({
 backups,databases,nowMs,destination=DESTINATION
}={}){
 if(!Number.isFinite(nowMs)||nowMs<=0||nowMs>4102444800000)STOP("CLOCK");
 const {current,destinationFree}=validateDatabases(databases,destination);
 if(!object(backups)||!Array.isArray(backups.backups)||
    backups.backups.length>1000||
    !Array.isArray(backups.unreachable??[])||
    (backups.unreachable??[]).length>0||
    (backups.nextPageToken!==undefined&&backups.nextPageToken!==""))
   STOP("BACKUP_INVENTORY_INCOMPLETE");
 const seen=new Set(),ready=[];
 for(const b of backups.backups){
  if(!object(b)||typeof b.name!=="string"||
     !BACKUP_NAME.test(b.name)||seen.has(b.name)||
     typeof b.database!=="string"||
     !b.database.startsWith("projects/"+PROJECT+"/databases/"))
   STOP("BACKUP_IDENTITY_UNVERIFIED");
  seen.add(b.name);
  if(b.database!==SOURCE)continue;
  const location=BACKUP_NAME.exec(b.name)[1];
  if(typeof b.databaseUid!=="string"||
     b.databaseUid!==current.uid||
     location!==current.locationId)STOP("SOURCE_UID_OR_LOCATION_MISMATCH");
  if(!["READY","CREATING","NOT_AVAILABLE"].includes(b.state))STOP("STATE_UNVERIFIED");
  if(b.state==="READY"){
   const snapshot=toTime(b.snapshotTime),expiry=toTime(b.expireTime);
   if(!Number.isFinite(snapshot)||!Number.isFinite(expiry)||
      expiry<=snapshot)STOP("READY_TIMESTAMPS_UNVERIFIED");
   ready.push({snapshot,expiry});
  }
 }
 const usable=ready.filter(x=>x.snapshot<=nowMs&&
   nowMs-x.snapshot<=recent&&x.expiry>nowMs+expiryBuffer);
 const latest=usable.reduce((prev,item)=>
  !prev||item.snapshot>prev.snapshot?item:prev,null);
 return Object.freeze({
  project:PROJECT,mode:"GET_ONLY_NO_RESTORE",
  managedBackupMetadataComplete:true,
  sourceDatabaseUidAndLocationVerified:true,
  readyBackupCount:ready.length,
  recentUnexpiredReadyBackupAvailable:Boolean(latest),
  destinationDatabaseIdUnusedAtAudit:destinationFree,
  selectedBackupAgeHours:latest?
   Math.round((nowMs-latest.snapshot)/3600000*10)/10:null,
  backupRestoreMetadataPreflightPassed:Boolean(latest)&&destinationFree,
  backupPayloadDownloaded:false,managedBackupRestored:false,
  sourceDocumentWrites:0,destinationDatabaseCreated:false,
  chargesBoundedOrTrialVerified:false,restoreAuthorizationGranted:false,
  fullProductionCutoverApproved:false
 });
}
export async function inspectManagedRestorePreflight({read,nowMs=Date.now()}={}){
 if(typeof read!=="function")STOP("TRANSPORT");
 const json=async url=>{
  if(url!==DATABASES_URL&&url!==BACKUPS_URL)STOP("ENDPOINT");
  let response;
  try{response=await read(url)}catch{STOP("GET_FAILED");}
  if(response?.status!==200)STOP("GET_UNVERIFIED");
  try{return await response.json()}catch{STOP("JSON_INVALID");}
 };
 const [databases,backups]=await Promise.all([json(DATABASES_URL),json(BACKUPS_URL)]);
 return summarizeManagedRestorePreflight({databases,backups,nowMs});
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"))
      .projects.default!==PROJECT)STOP("UNAPPROVED_RUNTIME");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 let provider;
 try{provider=require("firebase-admin/app").applicationDefault();}
 catch{STOP("AUTH_DEPENDENCY");}
 const read=async url=>{
  if(url!==DATABASES_URL&&url!==BACKUPS_URL)STOP("NON_GET_ENDPOINT");
  let token;
  try{token=(await provider.getAccessToken())?.access_token;}
  catch{STOP("TOKEN_UNAVAILABLE");}
  if(typeof token!=="string"||!token)STOP("MISSING_TOKEN");
  return fetch(url,{method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:"Bearer "+token}});
 };
 const result=await inspectManagedRestorePreflight({read});
 console.log("NICO_MANAGED_BACKUP_RESTORE_PREFLIGHT "+JSON.stringify(result));
 if(!result.backupRestoreMetadataPreflightPassed)
  console.log("BLOCK_RESTORE_METADATA_OR_DESTINATION_UNVERIFIED");
 console.log("NO_PRODUCTION_OR_DESTINATION_WRITES_NO_RESTORE");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  const known=/^STOP_MANAGED_BACKUP_PREFLIGHT_[A-Z_]+$/.test(e?.message||"");
  const errorType=e instanceof TypeError?"TYPE_ERROR":
   e instanceof ReferenceError?"REFERENCE_ERROR":
   e instanceof SyntaxError?"SYNTAX_ERROR":"OTHER_ERROR";
  // Never print an API response body, token, database UID, backup ID, or
  // untrusted exception.message/stack. Only a source line NUMBER is exposed.
  const sourceLine=(typeof e?.stack==="string"?
    e.stack.split("\n").find(x=>x.includes("audit-managed-backup-restore-preflight-readonly.mjs:")):"")||"";
  const match=sourceLine.match(/audit-managed-backup-restore-preflight-readonly\.mjs:(\d+):\d+/);
  console.error(known?e.message:
   "STOP_MANAGED_BACKUP_PREFLIGHT_UNEXPECTED_"+errorType);
  if(!known&&match)console.error("NICO_PREFLIGHT_AUDIT_SOURCE_LINE="+match[1]);
  process.exitCode=1;
 });
