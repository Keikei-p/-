/**
 * STAGING ONLY / NO DEPLOY. A single read-only Firestore transaction for
 * canonical count sources AND owner publication settings.
 *
 * Both callbacks must use ONLY the supplied tx for every Firestore read;
 * callers must never pass browser-supplied counts, mappings or approvals.
 * This adapter does not implement the still-missing production source readers.
 * A matching timestamp is an additional fence, not a substitute for a
 * complete source loader, real-account E2E, or production finance Rules.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const TIME=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const fail=()=>{throw Error("OWNER_RANK_ATOMIC_SNAPSHOT_UNVERIFIED");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
 a.length===b.length&&new Set(a).size===a.length&&
 a.every(x=>id(x)&&b.includes(x));
export function createStagedAtomicOwnerCountLoader({
 db,loadCountsInTransaction,loadPublicationInTransaction
}={}){
 if(!db||typeof db.runTransaction!=="function"||
    typeof loadCountsInTransaction!=="function"||
    typeof loadPublicationInTransaction!=="function")fail();
 return async function loadAtomic({month,context}={}){
  if(!MONTH.test(month||"")||!context||context.serverVerified!==true||
     !id(context.hubCompanyId)||!id(context.viewerUid)||
     !Array.isArray(context.approvedCompanyIds)||
     new Set(context.approvedCompanyIds).size!==context.approvedCompanyIds.length||
     !context.approvedCompanyIds.every(id)||
     !context.approvedCompanyIds.includes(context.hubCompanyId)||
     context.approvedCompanyIds.length<1||
     context.approvedCompanyIds.length>30)fail();
  return db.runTransaction(async tx=>{
   // Both callbacks are trusted backend implementations and MUST use tx.
   const [input,publication]=await Promise.all([
    loadCountsInTransaction({tx,month,context}),
    loadPublicationInTransaction({tx,context})
   ]);
   if(!input||!publication||input.hubCompanyId!==context.hubCompanyId||
      !sameSet(input.approvedCompanyIds,context.approvedCompanyIds)||
      !Array.isArray(input.sources)||
      input.sources.length!==context.approvedCompanyIds.length||
      !Array.isArray(input.productGroups)||input.mappingsReviewed!==true||
      input.period?.kind!=="month"||input.period.day!==month+"-01"||
      typeof input.period.asOf!=="string"||
      input.period.asOf.slice(0,7)!==month||
      publication.serverVerified!==true||
      publication.ownerSettingsRead!==true||
      publication.ownerUidVerified!==true||
      publication.productMappingsReviewed!==true||
      publication.hubCompanyId!==context.hubCompanyId||
      !Number.isSafeInteger(publication.revision)||publication.revision<1)
    fail();
   const time=input.snapshotReadTime;
   if(typeof time!=="string"||!TIME.test(time)||
      !Number.isFinite(Date.parse(time))||
      publication.snapshotReadTime!==time||
      input.sources.some(s=>!s||s.readTime!==time)||
      !sameSet(input.sources.map(s=>s.companyId),
       context.approvedCompanyIds))fail();
   // Never cache the transaction result. No raw counts are returned to a
   // client by this loader; the separate handler builds a count-only view.
   return {input,publication};
  },{readOnly:true});
 };
}
