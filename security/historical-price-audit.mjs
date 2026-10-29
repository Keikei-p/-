/**
 * STAGING / OFFLINE ONLY: read-only historical sales reconciliation.
 *
 * This exports financial details and MUST NEVER be called from partner/member
 * UI or a public endpoint. A trusted server must independently authorize
 * an INTERNAL company owner before passing any original documents here.
 *
 * No network, Firebase, writes, deletions, repricing, or imports.
 * Catalog rate changes are warnings, NOT proof a historic sale was wrong.
 */
const ID=/^[A-Za-z0-9_:-]{1,150}$/;
const day=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const deny=code=>{throw Error("historic_price_audit_"+code);};
const safeInt=(n,label)=>{if(!Number.isSafeInteger(n)||n<0)deny(label);return n;};
const add=(x,y,label)=>{const v=x+y;if(!Number.isSafeInteger(v)||v<0)deny(label);return v;};
const mul=(x,y,label)=>{const v=x*y;if(!Number.isSafeInteger(v)||v<0)deny(label);return v;};
const validId=x=>typeof x==="string"&&ID.test(x);
function validDay(x){
 if(typeof x!=="string"||!day.test(x))return false;
 const [y,m,d]=x.split("-").map(Number);
 const check=new Date(0);check.setUTCHours(0,0,0,0);check.setUTCFullYear(y,m-1,d);
 return check.getUTCFullYear()===y&&check.getUTCMonth()+1===m&&check.getUTCDate()===d;
}
const strictArray=x=>Array.isArray(x)&&x.length<=250000;
function rateMap(products,companyId){
 const map=new Map();
 for(const product of products){
   if(!product||product.companyId!==companyId||!validId(product.id)||map.has(product.id))
     deny("catalog_scope");
   const plans=new Map(),entries=product.pricingOptions;
   if(entries!==undefined&&!Array.isArray(entries))deny("catalog_prices");
   if(Array.isArray(entries)){
     for(const p of entries){
       if(!p||!Number.isSafeInteger(p.cashback)||p.cashback<0||plans.has(p.cashback))
         deny("ambiguous_cashback");
       plans.set(p.cashback,safeInt(p.revenuePerUnit,"catalog_unit"));
     }
   }else if(product.revenue!==undefined && product.revenue!==null){
     // Plain legacy rates are only unambiguous when no nonzero CB variants.
     if(product.cashbackOptions?.some(x=>Number(x)>0)) {
       map.set(product.id,{plans:null});continue;
     }
     plans.set(0,safeInt(product.revenue,"catalog_unit"));
   }
   map.set(product.id,{plans:plans.size?plans:null});
 }
 return map;
}
/**
 * Produces owner-only nonfinal diagnostic findings from already-loaded records.
 * This does NOT prove all live documents were included, or authorize corrections.
 */
export function auditHistoricPrices({companyId,records,products,maxFindings=500}={}){
 if(!validId(companyId)||!strictArray(records)||!strictArray(products)||
    !Number.isSafeInteger(maxFindings)||maxFindings<1||maxFindings>5000)
   deny("arguments");
 const catalog=rateMap(products,companyId),seen=new Set();
 const findings=[];
 let totalStoredLineAmount=0,checkedRecords=0,unresolvedRates=0,rateDrifts=0,
   mismatchedTotals=0,sourceRows=0;
 const issue=(kind,record,detail={})=>{
   if(findings.length<maxFindings) findings.push({
     kind,recordId:record.id,recordDate:record.date,teamId:record.teamId,...detail
   });
 };
 for(const record of records){
   if(!record||record.companyId!==companyId||!validId(record.id)||
      !validId(record.uid)||!validId(record.teamId)||!validDay(record.date)||
      seen.has(record.id))deny("record_scope");
   seen.add(record.id);checkedRecords++;
   if(!record.results||typeof record.results!=="object")deny("results");
   const entries=Array.isArray(record.results)?record.results:
     Object.values(record.results);
   let count=0,amount=0;
   for(const row of entries){
     if(!row||typeof row!=="object"||Array.isArray(row))deny("line");
     const n=safeInt(row.count,"count");
     // No silently treating a missing historical price as zero.
     if(row.revenuePerUnit===null||row.revenuePerUnit===undefined||
       row.revenuePerUnit==="")deny("missing_saved_unit");
     const old=safeInt(row.revenuePerUnit,"saved_unit");
     count=add(count,n,"count_overflow");
     amount=add(amount,mul(n,old,"amount_overflow"),"amount_overflow");
     if(n===0)continue;
     sourceRows++;
     const product=catalog.get(row.productId);
     if(!product||!product.plans){
       unresolvedRates++;issue("PRODUCT_OR_PLAN_UNVERIFIED",record,{productId:row.productId||null});
       continue;
     }
     const cb=row.cashback===undefined||row.cashback===null
       ? (product.plans.size===1?[...product.plans.keys()][0]:null)
       : row.cashback;
     if(!Number.isSafeInteger(cb)||cb<0||!product.plans.has(cb)){
       unresolvedRates++;issue("CASHBACK_NOT_VERIFIED",record,{productId:row.productId,cashback:cb});
       continue;
     }
     const expected=product.plans.get(cb);
     if(expected!==old){
       rateDrifts++;
       issue("SAVED_VS_CURRENT_RATE_DIFFERENCE",record,{
         productId:row.productId,cashback:cb,quantity:n,
         savedUnit:old,currentCatalogUnit:expected,
         savedLineAmount:mul(n,old,"amount_overflow"),
         currentCatalogLineAmount:mul(n,expected,"amount_overflow")
       });
     }
   }
   totalStoredLineAmount=add(totalStoredLineAmount,amount,"total_overflow");
   if(record.totalCount===undefined||record.totalRevenue===undefined||
     record.totalCount!==count||record.totalRevenue!==amount){
     mismatchedTotals++;
     issue("STORED_TOTAL_MISMATCH_OR_MISSING",record,{
       savedTotalCount:record.totalCount??null,savedTotalRevenue:record.totalRevenue??null,
       derivedCount:count,derivedSavedRevenue:amount
     });
   }
 }
 return {
   status:"OWNER_ONLY_OFFLINE_REVIEW_NOT_CERTIFIED",
   sourceCoverageVerified:false,productionDataChanged:false,correctionAuthorized:false,
   companyId,checkedRecords,sourceRows,totalStoredLineAmount,
   rateDrifts,unresolvedRates,mismatchedTotals,
   findings,findingsTruncated:rateDrifts+unresolvedRates+mismatchedTotals>findings.length
 };
}
