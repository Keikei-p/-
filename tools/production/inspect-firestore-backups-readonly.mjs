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
 const isSafeInt=x=>typeof x==="string"&&/^\d+$/.test(x)&&
  Number.isSafeInteger(Number(x))&&Number(x)>0;
 const hasStats=b=>b.stats!==undefined&&b.stats!==null;
 const validStats=b=>hasStats(b)&&isSafeInt(b.stats.documentCount)&&
  isSafeInt(b.stats.sizeBytes);
 const recent=ready.filter(b=>{
  const snapshot=Date.parse(b.snapshotTime),expiry=Date.parse(b.expireTime);
  return Number.isFinite(snapshot)&&Number.isFinite(expiry)&&
   snapshot<=now&&now-snapshot<=48*hour&&expiry>now+24*hour;
 });
 const underBudget=b=>validStats(b)&&Number(b.stats.documentCount)<=10000&&
  Number(b.stats.sizeBytes)<=32*1024*1024;
 return Object.freeze({managedBackupsFound:all.length,readyBackups:ready.length,
  latestReadySnapshot:ready.map(b=>b.snapshotTime).sort().at(-1)||null,
  readyMissingStats:ready.filter(b=>!hasStats(b)).length,
  readyMalformedStats:ready.filter(b=>hasStats(b)&&!validStats(b)).length,
  readyWithValidStats:ready.filter(validStats).length,
  recentReadyWithin48hAndExpiryBuffer:recent.length,
  recentReadyWithValidStats:recent.filter(validStats).length,
  recentReadyWithinAuditBudget:recent.filter(underBudget).length,
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
 // Fail closed on incomplete or partially unreachable backup inventories.
 summarizeBackups(body);
 const now=Date.now(),hour=3600000;
 const validName=name=>typeof name==="string"&&
  /^projects\/sales-management-cc116\/locations\/[a-z0-9-]+\/backups\/[A-Za-z0-9_-]+$/.test(name);
 const candidates=body.backups.filter(b=>b.database===DATABASE&&b.state==="READY"&&
  (b.stats===undefined||b.stats===null)&&validName(b.name)&&
  typeof b.databaseUid==="string"&&b.databaseUid.length>0&&
  Number.isFinite(Date.parse(b.snapshotTime))&&
  Date.parse(b.snapshotTime)<=now&&now-Date.parse(b.snapshotTime)<=48*hour&&
  Date.parse(b.expireTime)>now+24*hour)
  .sort((a,b)=>Date.parse(b.snapshotTime)-Date.parse(a.snapshotTime)).slice(0,2);
 let recovered=0,denied=0;
 for(const candidate of candidates){
  // Metadata GET only; never access document content or restoration endpoints.
  const detailResponse=await request("https://firestore.googleapis.com/v1/"+candidate.name,{
   method:"GET",redirect:"error",headers:{Authorization:"Bearer "+token}
  });
  if(!detailResponse.ok){denied++;continue;}
  const detail=await detailResponse.json();
  if(detail?.name!==candidate.name||detail?.database!==candidate.database||
    detail?.databaseUid!==candidate.databaseUid||
    detail?.state!=="READY"||detail?.snapshotTime!==candidate.snapshotTime||
    detail?.expireTime!==candidate.expireTime)
   throw Error("STOP_BACKUP_DETAIL_MISMATCH");
  if(detail.stats!==undefined&&detail.stats!==null){
   candidate.stats=detail.stats;recovered++;
  }
 }
 return Object.freeze({...summarizeBackups(body),
  detailGetsAttempted:candidates.length,detailStatsRecovered:recovered,
  detailGetsDenied:denied});
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