/**
 * Read-only sales archive coverage inventory.
 * A browser-exported history bundle is not a complete Firestore backup:
 * it lacks company/user/team membership/configuration, goals, permissions,
 * and any other collections not explicitly captured at export time.
 *
 * This function must NEVER be used to authorize production data deletion.
 */
export const SALES_HISTORY_COLLECTIONS=Object.freeze([
  "records","products","recordCorrections","teams"
]);
export const NOT_INCLUDED_IN_HISTORY_EXPORT=Object.freeze([
  "companies/{companyId}",
  "companies/{companyId}/members/{uid}",
  "companies/{companyId}/settings/{settingsId}",
  "users/{uid}",
  "goals",
  "revenueGoals",
  "productGroups",
  "invitations",
  "partnerRelations",
  "companies/{companyId}/partnerCustomProducts/{id}",
  "partnerCountRecords",
  "partnerCountCorrections",
  "partnerCountRevisions",
  "partnerCountPublicRevisions",
  "partnerCountDailyClaims",
  "partnerCountIdempotencyKeys",
  "other current or future collections and subcollections"
]);
const refuse=()=>{throw Error("Incomplete sales history export");};
export function makeArchiveCoverage(payload){
 const original=payload?.original;
 if(!original||typeof original!=="object"||Array.isArray(original))refuse();
 const keys=Object.keys(original);
 if(keys.length!==SALES_HISTORY_COLLECTIONS.length||
    SALES_HISTORY_COLLECTIONS.some(k=>!keys.includes(k)||!Array.isArray(original[k])))
   refuse();
 const captured=Object.fromEntries(SALES_HISTORY_COLLECTIONS.map(k=>[k,original[k].length]));
 return {
   scope:"sales_history_4_collections_not_full_company",
   sourceCollections:[...SALES_HISTORY_COLLECTIONS],
   capturedDocumentCounts:captured,
   excludedOrUnverifiedPaths:[...NOT_INCLUDED_IN_HISTORY_EXPORT],
   completeCompanyBackup:false,
   productionDeletionEligible:false,
   sameTimestampAcrossCollections:false
 };
}
export function checkArchiveCoverage(payload){
 const actual=makeArchiveCoverage(payload);
 if(payload.coverage!==undefined&&
    JSON.stringify(payload.coverage)!==JSON.stringify(actual))refuse();
 return actual;
}
