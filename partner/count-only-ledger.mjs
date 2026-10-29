/**
 * STAGING ONLY. Transactional, append-only partner count ledger.
 *
 * This code NEVER initializes Firebase, accesses the network, deploys, or
 * changes any existing sales/finance collection. A future server adapter must
 * provide an authenticated identity + fresh membership/catalog reads and
 * a Firestore-like transactional storage interface.
 *
 * All record versions and public projections are preserved. No delete, even
 * when a correction reduces a reported count or hides a custom product.
 * The current pointer is atomically updated to the new immutable revision.
 * Read consumers MUST follow the current pointer, not scan all revisions.
 */
import {planNewPartnerCount,planPartnerCountCorrection}
  from "./count-only-write-contract.mjs";
import {assertPublicSchema,auditNoFinancialKeys}
  from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const REPLAY=/^[A-Za-z0-9_-]{16,96}$/;
const fail=()=>{throw Error("Count-only transaction refused");};
const valid=x=>typeof x==="string"&&ID.test(x);
// Unambiguous composite key: underscores inside company IDs and generated IDs
// must never cause two companies to share a Firestore document path.
const composite=(...parts)=>parts.map(value=>{
 if(!valid(value))fail();
 return String(value.length)+"-"+value;
}).join("-");
function requiredFunctions(store){
 if(!store||typeof store.ref!=="function"||
    typeof store.runTransaction!=="function")fail();
}
function needsTrustedServer(ctx){
 if(!ctx||!ctx.principal||ctx.principal.serverVerified!==true||
    ctx.principal.tokenVerified!==true||
    ctx.principal.memberActive!==true||
    ctx.principal.userActive!==true||
    ctx.principal.companyActive!==true||
    ctx.principal.companyKind!=="partner"||
    ctx.principal.accessKind!=="partner"||
    ctx.principal.partnerRelationApproved!==true||
    ctx.principal.canSubmit!==true||
    !valid(ctx.principal.companyId)||!valid(ctx.principal.uid)||
    !Array.isArray(ctx.catalog)||typeof ctx.memberName!=="string"||
    typeof ctx.teamName!=="string")fail();
}
function paths(companyId,recordId,version){
 if(!valid(companyId)||!valid(recordId)||
    !Number.isSafeInteger(version)||version<1||version>999999)fail();
 const root=composite(companyId,recordId);
 const suffix=String(version).padStart(6,"0");
 return {
   current:"partnerCountRecords/"+root,
   revision:"partnerCountRevisions/"+root+"_v"+suffix,
   publicRevision:"partnerCountPublicRevisions/"+root+"_v"+suffix,
   corrections:"partnerCountCorrections/",
   idempotency:"partnerCountIdempotencyKeys/"
 };
}
function immutablePublic(plan,companyId,recordId,version){
 if(plan.privateRecord.companyId!==companyId||plan.recordId!==recordId||
    !Number.isSafeInteger(version)||version<1)fail();
 if(plan.publicHeader)assertPublicSchema("publicRecords",[plan.publicHeader]);
 assertPublicSchema("publicRecordLines",plan.publicLines);
 const count=plan.publicLines.reduce((s,l)=>s+l.count,0);
 if(!Number.isSafeInteger(count)||
    (plan.publicHeader&&count!==plan.publicHeader.totalCount)||
    (!plan.publicHeader&&count>0))fail();
 const snapshot={
   companyId,recordId,version,
   header:plan.publicHeader??null,
   lines:plan.publicLines,
   published:plan.publicHeader!==null
 };
 auditNoFinancialKeys(snapshot);
 return snapshot;
}
async function getTrustedContext(loadTrustedContext,tx){
 if(typeof loadTrustedContext!=="function")fail();
 const result=await loadTrustedContext(tx);
 needsTrustedServer(result);
 return result;
}
function noHistoryTouched(plan){
 if(!plan.transactionRequired||!Array.isArray(plan.sourceChanges)||
    plan.sourceChanges.length!==0)fail();
}
function ensureReplayKey(key){
 if(typeof key!=="string"||!REPLAY.test(key))fail();
}
/**
 * Register one new count-only record. Client supplies only the request and
 * idempotency key. A trusted server supplies a minted record ID and verified
 * context; it MUST NOT accept record IDs or principal claims from the browser.
 *
 * tx.get / tx.create / tx.update / store.ref mimic Firestore Admin transaction
 * primitives, but are dependencies supplied by the caller, never initialized.
 */
export async function stageNewPartnerCount({
 store,loadTrustedContext,mintRecordId,request,idempotencyKey
}={}){
 requiredFunctions(store);
 ensureReplayKey(idempotencyKey);
 if(typeof mintRecordId!=="function")fail();
 return store.runTransaction(async tx=>{
   const {principal,catalog,memberName,teamName}
     =await getTrustedContext(loadTrustedContext,tx);
   const key=composite(principal.companyId,principal.uid,idempotencyKey);
   if(!valid(principal.companyId)||!valid(principal.uid)||
      key.length>400)fail();
   const idemRef=store.ref("partnerCountIdempotencyKeys/"+key);
   const already=await tx.get(idemRef);
   const requestJson=JSON.stringify(request);
   if(already.exists){
     const old=already.data();
     if(old.companyId!==principal.companyId||old.uid!==principal.uid||
        old.requestJson!==requestJson||!valid(old.recordId))fail();
     return {status:"already_registered",recordId:old.recordId,
       version:old.version};
   }
   const recordId=await mintRecordId();
   if(!valid(recordId)||!recordId.startsWith("pc_"))fail();
   const plan=planNewPartnerCount({
     principal,catalog,request,serverRecordId:recordId,memberName,teamName
   });
   noHistoryTouched(plan);
   const p=paths(principal.companyId,recordId,1);
   const currentRef=store.ref(p.current);
   const current=await tx.get(currentRef);
   if(current.exists)fail();
   const publication=immutablePublic(plan,principal.companyId,recordId,1);
   tx.create(currentRef,{...plan.privateRecord,revision:1,
     latestPublicRevision:1});
   tx.create(store.ref(p.revision),{...plan.privateRecord,
     immutableVersion:1});
   tx.create(store.ref(p.publicRevision),publication);
   tx.create(idemRef,{companyId:principal.companyId,uid:principal.uid,
     requestJson,recordId,version:1});
   return {status:"registered",recordId,version:1,
     ownCount:plan.privateRecord.totalCount,
     sharedCount:plan.privateRecord.sharedCount};
 });
}
/**
 * Atomic compare-and-swap correction:
 * - read latest revision first inside the transaction
 * - compare old version; never overwrite under a stale reader
 * - append immutable correction + new full private/public revision
 * - update only the current pointer inside the NEW partner-only collection
 * - do not delete any historical revision or current public record
 */
export async function stageCorrectPartnerCount({
 store,loadTrustedContext,request,recordId,expectedVersion,correctionId
}={}){
 requiredFunctions(store);
 if(!valid(recordId)||!valid(correctionId)||
    !Number.isSafeInteger(expectedVersion)||expectedVersion<1)fail();
 return store.runTransaction(async tx=>{
   const {principal,catalog,memberName,teamName}
     =await getTrustedContext(loadTrustedContext,tx);
   const p=paths(principal.companyId,recordId,expectedVersion+1);
   const currentRef=store.ref(p.current);
   const previousSnap=await tx.get(currentRef);
   if(!previousSnap.exists)fail();
   const previous=previousSnap.data();
   if(previous.version!==expectedVersion||
      previous.latestPublicRevision!==expectedVersion)fail();
   const plan=planPartnerCountCorrection({
     principal,catalog,request,serverRecordId:recordId,
     memberName,teamName,
     previous,expectedVersion,correctionId
   });
   noHistoryTouched(plan);
   const publicRevision=immutablePublic(plan,principal.companyId,
     recordId,expectedVersion+1);
   const correctionRef=store.ref(p.corrections+
     composite(principal.companyId,correctionId));
   // Read in advance so a replay fails without changing the pointer.
   const correctionSnap=await tx.get(correctionRef);
   if(correctionSnap.exists)fail();
   tx.create(correctionRef,plan.immutableCorrection);
   tx.create(store.ref(p.revision),{...plan.privateRecord,
     immutableVersion:expectedVersion+1});
   tx.create(store.ref(p.publicRevision),publicRevision);
   tx.update(currentRef,{...plan.privateRecord,
     revision:expectedVersion+1,latestPublicRevision:expectedVersion+1});
   return {status:"corrected",recordId,
     version:expectedVersion+1,
     ownCount:plan.privateRecord.totalCount,
     sharedCount:plan.privateRecord.sharedCount};
 });
}
/**
 * Public reader helper: get current pointer and matching immutable
 * projection in one transaction. Never return the private record itself.
 */
export async function readCurrentPartnerPublication({
 store,companyId,recordId,loadAuthorizedReader
}={}){
 requiredFunctions(store);
 if(!valid(companyId)||!valid(recordId)||
    typeof loadAuthorizedReader!=="function")fail();
 return store.runTransaction(async tx=>{
   // Re-check a fresh server-verified reader relationship on every read.
   // A browser-provided companyId or permit cannot authorize this method.
   const reader=await loadAuthorizedReader(tx);
   if(!reader||reader.serverVerified!==true||
      reader.tokenVerified!==true||
      reader.active!==true||
      !Array.isArray(reader.allowedCompanyIds)||
      !reader.allowedCompanyIds.includes(companyId)||
      (reader.canViewAllTeams!==true&&
        (!Array.isArray(reader.allowedTeamIds)||
         !reader.allowedTeamIds.every(valid))))fail();
   const head=await tx.get(store.ref(paths(companyId,recordId,1).current));
   if(!head.exists)fail();
   const h=head.data();
   if(h.companyId!==companyId||h.sourceId!==recordId||
      h.version!==h.latestPublicRevision||
      (reader.canViewAllTeams!==true&&
       !reader.allowedTeamIds.includes(h.teamId)))fail();
   const p=paths(companyId,recordId,h.latestPublicRevision);
   const snapshot=await tx.get(store.ref(p.publicRevision));
   if(!snapshot.exists)fail();
   const publicData=snapshot.data();
   if(publicData.companyId!==companyId||
      publicData.recordId!==recordId||
      publicData.version!==h.version||
      !Array.isArray(publicData.lines)||
      publicData.published!==(publicData.header!==null))fail();
   if(publicData.header)assertPublicSchema("publicRecords",[publicData.header]);
   assertPublicSchema("publicRecordLines",publicData.lines);
   // Do not trust a projection just because its schema is money-free.
   // Its identity and totals must match the current authorized record.
   if(publicData.header&&(
     publicData.header.companyId!==companyId||
     publicData.header.sourceId!==recordId||
     publicData.header.uid!==h.uid||
     publicData.header.teamId!==h.teamId||
     publicData.header.date!==h.date))fail();
   let total=0;
   for(const line of publicData.lines){
     if(line.companyId!==companyId||line.recordId!==recordId||
       line.uid!==h.uid||line.teamId!==h.teamId||line.date!==h.date)fail();
     total+=line.count;
     if(!Number.isSafeInteger(total))fail();
   }
   if(total!==h.sharedCount||
      (publicData.header?publicData.header.totalCount!==total:total!==0)||
      (publicData.published!==Boolean(publicData.header)))fail();
   auditNoFinancialKeys(publicData);
   return {version:h.version,published:publicData.published,
     header:publicData.header,lines:publicData.lines};
 });
}
