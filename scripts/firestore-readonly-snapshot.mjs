/**
 * DRAFT / READ ONLY: immutable Firestore document snapshot encoder.
 * Recurses every exposed root collection and subcollection, including
 * descendants of missing parent documents. Never calls Firestore writes.
 *
 * This is a FIRESTORE-DOCUMENTS snapshot, NOT an all-Firebase backup:
 * Firebase Auth accounts, Cloud Storage, Rules, Indexes, Secrets and Hosting
 * are excluded. It NEVER authorizes deletion of a live record.
 */
import {createHash} from "node:crypto";
const NAME=/^[^/]{1,1500}$/;
const MAX_DEPTH=80;
const reject=(message)=>{throw Error("Backup inventory refused: "+message);};
const validSegment=s=>typeof s==="string"&&NAME.test(s)&&s!=="."&&s!=="..";
const isPlain=x=>x!==null&&typeof x==="object"&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const denyDelete=()=>false;
export function encodeFirestoreValue(v,depth=0,seen=new WeakSet()){
 if(depth>90)reject("value nesting limit");
 if(v===null)return {t:"null"};
 if(typeof v==="string")return {t:"string",v};
 if(typeof v==="boolean")return {t:"boolean",v};
 if(typeof v==="number"){
  if(Number.isSafeInteger(v))return {t:"integer",v};
  if(Number.isFinite(v))return {t:"double",v};
  if(Number.isNaN(v))return {t:"doubleSpecial",v:"NaN"};
  if(v===Infinity||v===-Infinity)return {t:"doubleSpecial",v:v>0?"Infinity":"-Infinity"};
  reject("unsupported numeric value");
 }
 if(typeof v==="bigint"||typeof v==="symbol"||typeof v==="function"||
    typeof v==="undefined")reject("unsupported Firestore field type");
 if(seen.has(v))reject("cyclic field value");
 seen.add(v);
 try{
  if(Buffer.isBuffer(v)||v instanceof Uint8Array)
    return {t:"bytes",v:Buffer.from(v).toString("base64")};
  if(v instanceof Date){
   if(!Number.isFinite(v.getTime()))reject("invalid date");
   return {t:"date",v:v.toISOString()};
  }
  const ctor=v?.constructor?.name;
  if(ctor==="Timestamp"&&Number.isSafeInteger(v.seconds)&&
     Number.isInteger(v.nanoseconds)&&v.nanoseconds>=0&&v.nanoseconds<1000000000)
   return {t:"timestamp",seconds:v.seconds,nanoseconds:v.nanoseconds};
  if(ctor==="GeoPoint"&&typeof v.latitude==="number"&&typeof v.longitude==="number"&&
     Number.isFinite(v.latitude)&&Number.isFinite(v.longitude)&&
     Math.abs(v.latitude)<=90&&Math.abs(v.longitude)<=180)
   return {t:"geopoint",latitude:v.latitude,longitude:v.longitude};
  if(ctor==="DocumentReference"&&typeof v.path==="string"&&
     validDocumentPath(v.path))return {t:"reference",path:v.path};
  if(Array.isArray(v))
    return {t:"array",items:v.map(item=>encodeFirestoreValue(item,depth+1,seen))};
  if(isPlain(v)){
   const keys=Object.keys(v).sort();
   return {t:"map",entries:keys.map(k=>{
    if(typeof k!=="string"||Buffer.byteLength(k,"utf8")>1500)reject("invalid Firestore field key");
    return [k,encodeFirestoreValue(v[k],depth+1,seen)];
   })};
  }
  reject("unknown Firestore special type");
 }finally{seen.delete(v);}
}
export function validDocumentPath(path){
 return typeof path==="string"&&path.length<=4096&&
  path.split("/").length%2===0&&path.split("/").length>=2&&
  path.split("/").length<=MAX_DEPTH&&path.split("/").every(validSegment);
}
function validCollectionPath(path){
 return typeof path==="string"&&path.length<=4096&&
  path.split("/").length%2===1&&path.split("/").length<=MAX_DEPTH-1&&
  path.split("/").every(validSegment);
}
const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
function ensureList(value,label){
 if(!Array.isArray(value)||value.some(x=>typeof x!=="string")||
   new Set(value).size!==value.length)reject("invalid or duplicate "+label);
 return value;
}
export async function captureReadOnlyFirestore({
 reader,projectId,now=()=>new Date().toISOString(),
 maxDocuments=20000,maxBytes=100*1024*1024
}={}){
 if(!reader||["listRootCollections","listDocuments","getDocument","listSubcollections"]
    .some(name=>typeof reader[name]!=="function")||
   projectId!=="sales-management-cc116"||
   !Number.isSafeInteger(maxDocuments)||maxDocuments<1||maxDocuments>250000||
   !Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1000000000)
  reject("missing trusted read-only adapter or invalid limits");
 const documents=[],visitedCollections=new Set(),visitedDocs=new Set();
 let bytes=0,readCount=0;
 async function walk(collectionPath,depth){
  if(!validCollectionPath(collectionPath)||depth>MAX_DEPTH)reject("invalid collection path");
  if(visitedCollections.has(collectionPath))reject("collection revisited");
  visitedCollections.add(collectionPath);
  const docIds=ensureList(await reader.listDocuments(collectionPath),"document listing");
  for(const docId of docIds){
   if(!validSegment(docId))reject("invalid document ID");
   const path=collectionPath+"/"+docId;
   if(!validDocumentPath(path)||visitedDocs.has(path))reject("repeated document");
   visitedDocs.add(path);
   if(readCount>=maxDocuments)reject("backup read budget reached");
   const snap=await reader.getDocument(path);
   readCount++;
   if(!snap||typeof snap.exists!=="boolean")reject("missing document response");
   if(snap.exists){
    if(!isPlain(snap.data))reject("invalid document fields");
    const item={path,fields:encodeFirestoreValue(snap.data)};
    bytes+=Buffer.byteLength(JSON.stringify(item),"utf8");
    if(bytes>maxBytes||documents.length>=maxDocuments)reject("backup size/reads budget reached");
    documents.push(item);
   }
   const sub=ensureList(await reader.listSubcollections(path),"subcollection listing");
   for(const name of sub){
    if(!validSegment(name))reject("invalid nested collection name");
    await walk(path+"/"+name,depth+2);
   }
  }
 }
 const roots=ensureList(await reader.listRootCollections(),"root collection listing");
 for(const root of roots){
  if(!validSegment(root))reject("invalid root collection");
  await walk(root,1);
 }
 documents.sort((a,b)=>a.path.localeCompare(b.path,"en"));
 const payload={
  schemaVersion:1,projectId,
  capturedAt:now(),coverage:"firestore_document_data_only",
  completeFirebaseBackup:false,productionDeletionEligible:denyDelete(),
  missingServices:["Firebase Authentication users","Cloud Storage files",
   "Security Rules","Firestore indexes","Hosting","Secrets"],
  scannedCollections:visitedCollections.size,scannedDocumentReferences:readCount,
  documents
 };
 if(typeof payload.capturedAt!=="string"||!Number.isFinite(Date.parse(payload.capturedAt)))
  reject("invalid capture time");
 if(Buffer.byteLength(JSON.stringify(payload),"utf8")>maxBytes)
   reject("backup output size budget reached");
 return {
  kind:"firestore-readonly-project-snapshot",version:1,algorithm:"SHA-256",
  checksum:sha(JSON.stringify(payload)),payload
 };
}
export function verifyReadOnlyFirestore(snapshot){
 if(!snapshot||snapshot.kind!=="firestore-readonly-project-snapshot"||
    snapshot.version!==1||snapshot.algorithm!=="SHA-256"||
    typeof snapshot.checksum!=="string"||
    snapshot.checksum!==sha(JSON.stringify(snapshot.payload)))reject("checksum mismatch");
 const p=snapshot.payload;
 if(p.schemaVersion!==1||p.projectId!=="sales-management-cc116"||
    p.coverage!=="firestore_document_data_only"||
    p.completeFirebaseBackup!==false||p.productionDeletionEligible!==false||
    !Array.isArray(p.missingServices)||
    !p.missingServices.includes("Firebase Authentication users")||
    !Number.isSafeInteger(p.scannedCollections)||
    !Number.isSafeInteger(p.scannedDocumentReferences)||
    !Array.isArray(p.documents)||p.documents.length>p.scannedDocumentReferences)
  reject("snapshot scope is invalid");
 const seen=new Set();
 for(const d of p.documents){
  if(!validDocumentPath(d?.path)||seen.has(d.path)||!d.fields||
     d.fields.t!=="map")reject("duplicate/invalid snapshot path");
  seen.add(d.path);
 }
 return {projectId:p.projectId,documentCount:p.documents.length,
  scannedDocumentReferences:p.scannedDocumentReferences,
  scannedCollections:p.scannedCollections,
  checksum:snapshot.checksum,fullFirebaseBackup:false,
  deletionAllowed:false};
}
