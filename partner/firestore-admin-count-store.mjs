/**
 * STAGING ONLY — restricted Firebase Admin transaction adapter for the
 * append-only partner count ledger. This file does not import/initialize the
 * Admin SDK, connect to Firestore or expose an HTTP endpoint.
 *
 * The caller supplies an already-authenticated Admin Firestore instance.
 * Only partnerCount* collections can be mutated. Trusted membership/catalog
 * documents may be read (never written) in the SAME transaction through
 * getTrustedDocument(). No delete/batch/collection/raw transaction escape.
 *
 * Never expose this adapter to a browser or treat it as a substitute for
 * Firebase token verification, fresh role checks or production rules cutover.
 */
import {auditNoFinancialKeys} from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const WRITE_ROOTS=new Set([
 "partnerCountRecords","partnerCountRevisions",
 "partnerCountPublicRevisions","partnerCountCorrections",
 "partnerCountIdempotencyKeys","partnerCountDailyClaims"
]);
const TRUSTED_READ=[
 /^users\/[A-Za-z0-9_:-]{1,128}$/,
 /^companies\/[A-Za-z0-9_:-]{1,128}$/,
 /^companies\/[A-Za-z0-9_:-]{1,128}\/members\/[A-Za-z0-9_:-]{1,128}$/,
 /^teams\/[A-Za-z0-9_:-]{1,128}$/,
 /^partnerRelations\/[A-Za-z0-9_:-]{1,128}$/,
 /^products\/[A-Za-z0-9_:-]{1,128}$/,
 /^partnerCustomProducts\/[A-Za-z0-9_:-]{1,128}$/,
 /^publicProducts\/[A-Za-z0-9_:-]{1,128}$/,
 /^partnerCountCatalog\/[A-Za-z0-9_:-]{1,128}$/
];
const deny=()=>{throw Error("Partner count adapter refused");};
const good=x=>typeof x==="string"&&ID.test(x);
function writable(path){
 if(typeof path!=="string")deny();
 const parts=path.split("/");
 if(parts.length!==2||!WRITE_ROOTS.has(parts[0])||!good(parts[1]))deny();
 return parts[0];
}
function trusted(path){
 if(typeof path!=="string"||!TRUSTED_READ.some(pattern=>pattern.test(path)))deny();
}
function payload(data){
 if(!data||typeof data!=="object"||Array.isArray(data))deny();
 // Even server-side count collections must never accidentally inherit
 // revenue/CB/price fields from an existing raw Firestore record.
 auditNoFinancialKeys(data);
 return data;
}
export function makePartnerCountAdminStore(db){
 if(!db||typeof db.doc!=="function"||
    typeof db.runTransaction!=="function")deny();
 const refs=new WeakMap();
 const ref=path=>{
  const root=writable(path);
  const result=db.doc(path);
  if(!result||typeof result!=="object")deny();
  refs.set(result,root);
  return result;
 };
 function allowedRef(value){
  if(!value||typeof value!=="object"||!refs.has(value))deny();
  return refs.get(value);
 }
 return Object.freeze({
  ref,
  async runTransaction(task){
   if(typeof task!=="function")deny();
   return db.runTransaction(async raw=>{
    if(!raw||typeof raw.get!=="function"||
       typeof raw.create!=="function"||typeof raw.update!=="function")deny();
    const safeTx=Object.freeze({
     get(documentRef){
      allowedRef(documentRef);
      return raw.get(documentRef);
     },
     getTrustedDocument(path){
      trusted(path);
      return raw.get(db.doc(path));
     },
     create(documentRef,data){
      allowedRef(documentRef);
      return raw.create(documentRef,payload(data));
     },
     update(documentRef,data){
      if(allowedRef(documentRef)!=="partnerCountRecords")deny();
      payload(data);
      if(!Number.isSafeInteger(data.revision)||
         data.revision<2||data.revision!==data.latestPublicRevision)deny();
      return raw.update(documentRef,data);
     }
    });
    return task(safeTx);
   });
  }
 });
}
