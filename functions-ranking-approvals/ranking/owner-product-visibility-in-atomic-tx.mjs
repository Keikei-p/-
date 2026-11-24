/**
 * STAGING ONLY / NO DEPLOY.
 * Connect the real, server-owned rankingProductVisibility document and
 * product catalog to the existing atomic count loader's SAME transaction.
 * No HTTP route, production Function or financial collection is touched.
 */
import {createOwnerProductVisibilityStore}
 from "./owner-product-visibility-firestore.mjs";

export function createAtomicOwnerPublicationReader({db,FieldValue,verifyCountViewer,includeHistoricalGroups=false}={}){
 const store=createOwnerProductVisibilityStore({db,FieldValue,verifyCountViewer,includeHistoricalGroups});
 return async ({tx,context}={})=>store.readForRankingInTransaction({
  tx,context,mappingsReviewed:true,requireReadTime:true
 });
}


/**
 * Server-only count ranking authorization proof without a manual product
 * visibility, public catalog or reviewed SKU mapping document.
 *
 * This is NOT an Owner settings read or a grant of finance permissions.
 * It proves the SAME read-only transaction still sees the authenticated
 * company's active owner and, for a partner, its current count-sharing
 * relation. Personal-name publishing remains separately restricted.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const fail=()=>{throw Error("ZERO_SETUP_COUNT_PUBLICATION_UNVERIFIED");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
function dateOf(readTime){
 if(!Number.isSafeInteger(readTime?.seconds)||
    !Number.isSafeInteger(readTime?.nanoseconds)||
    readTime.nanoseconds<0||readTime.nanoseconds>=1e9||
    typeof readTime.toDate!=="function")fail();
 const d=readTime.toDate();
 if(!(d instanceof Date)||!Number.isFinite(d.getTime()))fail();
 return d.toISOString();
}
export function createZeroSetupCountPublicationReader({db,verifyCountViewer}={}){
 if(!db||typeof db.collection!=="function"||
    typeof verifyCountViewer!=="function")fail();
 return async ({tx,context}={})=>{
  if(!tx||typeof tx.get!=="function"||
     context?.serverVerified!==true||
     !id(context.viewerUid)||!id(context.viewerCompanyId)||
     !id(context.hubCompanyId)||
     !["hub_owner","partner_owner"].includes(context.role)||
     !Array.isArray(context.approvedCompanyIds)||
     context.approvedCompanyIds.length<1||
     context.approvedCompanyIds.length>30||
     new Set(context.approvedCompanyIds).size!==context.approvedCompanyIds.length||
     !context.approvedCompanyIds.every(id)||
     !context.approvedCompanyIds.includes(context.hubCompanyId)||
     !context.approvedCompanyIds.includes(context.viewerCompanyId)||
     (context.role==="hub_owner")!==
        (context.hubCompanyId===context.viewerCompanyId)||
     context.activeCountSharingVerified!==true)fail();
  // This must use the SAME supplied transaction as original count reads;
  // client assertions, previous cached sessions and browser roles are NOT proof.
  await verifyCountViewer({tx,context});
  const company=companyId=>db.collection("companies").doc(companyId);
  const partner=context.role==="partner_owner";
  const refs=[
   company(context.hubCompanyId),
   ...(partner?[
    company(context.viewerCompanyId),
    db.collection("partnerRelations").doc(context.viewerCompanyId)
   ]:[])
  ];
  const snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
  if(snaps.some(s=>s?.exists!==true||
     typeof s.data!=="function"))fail();
  const t=snaps[0].readTime,instant=dateOf(t);
  for(const snap of snaps){
   const readTime=snap.readTime;
   if(readTime?.seconds!==t.seconds||
      readTime?.nanoseconds!==t.nanoseconds)fail();
  }
  const hub=snaps[0].data();
  if(!hub||!id(hub.ownerUid)||hub.active===false||
     (hub.companyKind!=null&&
      !["internal","direct"].includes(hub.companyKind)))fail();
  if(partner){
   const partnerCompany=snaps[1].data(),relation=snaps[2].data();
   if(!partnerCompany||partnerCompany.companyKind!=="partner"||
      partnerCompany.active!==true||
      partnerCompany.hubCompanyId!==context.hubCompanyId||
      !relation||relation.hubCompanyId!==context.hubCompanyId||
      relation.partnerCompanyId!==context.viewerCompanyId||
      relation.active!==true||
      relation.countSharingApproved!==true)fail();
  }
  return Object.freeze({
   serverVerified:true,zeroSetupVerified:true,
   ownerSettingsRead:false,ownerUidVerified:true,
   productMappingsReviewed:false,revision:1,
   hubCompanyId:context.hubCompanyId,snapshotReadTime:instant
  });
 };
}
