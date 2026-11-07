/**
 * STAGING ONLY / NO DEPLOY. Exact-scope cache invalidation after confirmed
 * owner correction. The owner page must inject the live in-memory cache and
 * callbacks which reset its monthly rank state/cancel active rank requests,
 * then request new data. Nothing touches Firestore or financial originals.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONTH=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const fail=code=>{throw Error("OWNER_RANKING_CACHE_"+code)};
function validDate(x){
 return typeof x==="string"&&DATE.test(x)&&
  !Number.isNaN(Date.parse(x+"T00:00:00Z"))&&
  new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
}
const exact=(x,fields)=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===fields.slice().sort().join("|");
/**
 * getActiveScope() => { uid, hubCompanyId }
 * resetVisibleMonth(month): synchronous! Must set partnerRankingState to
 * incomplete AND bump partnerRankingRequestGeneration to ignore in-flight
 * prior snapshots. A caller must never clear a different company/month.
 */
export function makeVerifiedPartnerRankingInvalidator({
 dailyCache,getActiveScope,resetVisibleMonth,requestRefresh
}={}){
 if(!(dailyCache instanceof Map)||
    typeof getActiveScope!=="function"||
    typeof resetVisibleMonth!=="function"||
    typeof requestRefresh!=="function")
  fail("DEPENDENCIES");
 return async function invalidate(receipt){
  if(!exact(receipt,["date","month","partnerCompanyId","version"])||
     !validDate(receipt.date)||!MONTH.test(receipt.month)||
     receipt.date.slice(0,7)!==receipt.month||
     !ID.test(receipt.partnerCompanyId||"")||
     !Number.isSafeInteger(receipt.version)||receipt.version<2||
     receipt.version>999)
   fail("RECEIPT_UNVERIFIED");
  const scope=getActiveScope();
  if(!exact(scope,["uid","hubCompanyId"])||
     !ID.test(scope.uid||"")||!ID.test(scope.hubCompanyId||"")||
     receipt.partnerCompanyId===scope.hubCompanyId)
   fail("SCOPE_UNVERIFIED");
  const rankKey=scope.uid+"|"+scope.hubCompanyId+"|"+receipt.month;
  const dayKey=rankKey+"|"+receipt.date;
  // Per-day keys contain mixed legacy+staff totals; there is no way to
  // surgically update one partner without re-reading the whole day.
  dailyCache.delete(dayKey);
  // Reset before refreshing, so a cached monthly ranking cannot continue
  // to masquerade as current after the server has accepted a correction.
  resetVisibleMonth(receipt.month);
  const after=getActiveScope();
  if(!exact(after,["uid","hubCompanyId"])||
     after.uid!==scope.uid||after.hubCompanyId!==scope.hubCompanyId)
   fail("SESSION_CHANGED");
  await requestRefresh(receipt.month);
  const finalScope=getActiveScope();
  if(!exact(finalScope,["uid","hubCompanyId"])||
     finalScope.uid!==scope.uid||finalScope.hubCompanyId!==scope.hubCompanyId)
   fail("SESSION_CHANGED");
  return Object.freeze({month:receipt.month,date:receipt.date,
   invalidated:true,rankingRecheckRequested:true});
 };
}
