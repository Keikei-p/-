// Read-only metadata inventory. Never fetch backup payloads or write Firestore.
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const PROJECT="sales-management-cc116";
const DATABASE="projects/"+PROJECT+"/databases/(default)";
const ENDPOINT="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/locations/-/backups";

export function summarizeBackups(body){
 if(!body||typeof body!=="object"||!Array.isArray(body.backups||[]))
  throw Error("STOP_BACKUP_RESPONSE_MALFORMED");
 if(!Array.isArray(body.unreachable||[]))
  throw Error("STOP_BACKUP_UNREACHABLE_RESPONSE");
 const all=(body.backups||[]).filter(b=>b?.database===DATABASE);
 const ready=all.filter(b=>b.state==="READY"&&
  typeof b.snapshotTime==="string"&&!Number.isNaN(Date.parse(b.snapshotTime)));
 if((body.unreachable||[]).length>0)
  throw Error("STOP_BACKUP_LOCATIONS_UNREACHABLE");
 if(body.nextPageToken)throw Error("STOP_BACKUP_INVENTORY_INCOMPLETE");
 const now=Date.now(),hour=3600000;
 const recent=ready.filter(b=>{
  const snapshot=Date.parse(b.snapshotTime),expiry=Date.parse(b.expireTime);
  return Number.isFinite(snapshot)&&Number.isFinite(expiry)&&
   snapshot<=now&&now-snapshot<=48*hour&&expiry>now+24*hour;
 });
 return Object.freeze({managedBackupsFound:all.length,readyBackups:ready.length,
  latestReadySnapshot:ready.map(b=>b.snapshotTime).sort().at(-1)||null,
  recentReadyWithin48hAndExpiryBuffer:recent.length,
  // Backup v1 exposes identity/state/timestamps, not size or document count.
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.locations.backups
  backupApiProvidesSizeAndDocumentCount:false,
  restoreCapacityAndCostVerified:false,
  // The metadata summary does not check source UID, IAM or restore payload.
  actualRestoreVerified:false,allFirestoreDocumentsAudited:false});
}
export async function inspect({request=fetch,getToken}={}){
 if(!getToken){
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {applicationDefault}=require("firebase-admin/app");
  getToken=async()=>(await applicationDefault().getAccessToken()).access_token;
 }
 const token=await getToken();
 if(!token||typeof token!=="string")throw Error("STOP_NO_BACKUP_AUDIT_IDENTITY");
 const r=await request(ENDPOINT,{
  method:"GET",redirect:"error",headers:{Authorization:"Bearer "+token}
 });
 if(!r.ok)throw Error("STOP_BACKUP_LIST_HTTP_"+r.status);
 const body=await r.json();
 // A second Backup GET has the same schema; it cannot recover nonexistent
 // stats. Capacity/cost needs separate evidence before any restore is allowed.
 return summarizeBackups(body);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const summary=await inspect();
  console.log("NICO_FIRESTORE_MANAGED_BACKUP_READ_ONLY "+JSON.stringify(summary));
  if(summary.readyBackups===0){
   console.error("STOP_NO_READY_MANAGED_BACKUP; other backup formats not checked");
   process.exitCode=2;
  }
 }catch(e){
  const code=e?.message||"";
  console.error(/^STOP_[A-Z0-9_]+$/.test(code)?code:"STOP_BACKUP_AUDIT_UNVERIFIED");
  process.exitCode=2;
 }
}