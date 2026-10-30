/**
 * Owner-only sales archive request budget (pure and side-effect free).
 *
 * A Firestore query can read more than its first 2,000 documents. Instead of
 * silently truncating an annual report or consuming an unbounded read quota,
 * count the four allowed collections SERVER-SIDE before fetching documents.
 *
 * A count preflight does not give a common, frozen snapshot. If saved counts
 * differ at collection time, fail closed and do NOT certify a PDF/CSV.
 */
export const ARCHIVE_COLLECTIONS=Object.freeze([
  "records","products","recordCorrections","teams"
]);
export const MAX_ARCHIVE_DOCUMENTS=10000;
const deny=()=>{throw Error("営業履歴の取得量を安全に確認できません。期間を月単位に分けるか、管理者に相談してください。");};
const validate=(counts,maxDocuments)=>{
 if(!Array.isArray(counts)||counts.length!==ARCHIVE_COLLECTIONS.length ||
    !Number.isSafeInteger(maxDocuments)||maxDocuments<1||
    maxDocuments>MAX_ARCHIVE_DOCUMENTS)deny();
 const clean=counts.map(n=>{
  if(!Number.isSafeInteger(n)||n<0)deny();
  return n;
 });
 const total=clean.reduce((sum,n)=>sum+n,0);
 if(!Number.isSafeInteger(total)||total>maxDocuments)deny();
 return {counts:clean,total};
};
export function checkArchivePreflightCounts(counts,maxDocuments=MAX_ARCHIVE_DOCUMENTS){
 const result=validate(counts,maxDocuments);
 return Object.freeze({sourceCounts:Object.freeze(result.counts),
  documentCount:result.total,verifiedWithinBudget:true});
}
export function assertArchiveQueryCountsMatch(preflight,snapshots){
 if(!preflight||preflight.verifiedWithinBudget!==true ||
    !Array.isArray(snapshots)||snapshots.length!==ARCHIVE_COLLECTIONS.length)
  deny();
 const expected=validate(preflight.sourceCounts,MAX_ARCHIVE_DOCUMENTS).counts;
 const received=snapshots.map(snapshot=>{
  if(!snapshot||typeof snapshot.size!=="number"||
     !Number.isSafeInteger(snapshot.size)||snapshot.size<0 ||
     snapshot.metadata?.fromCache===true)deny();
  return snapshot.size;
 });
 if(expected.some((n,i)=>n!==received[i]))deny();
 return true;
}
