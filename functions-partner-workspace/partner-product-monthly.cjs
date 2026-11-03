"use strict";
// Read-only, partner-scoped monthly product totals. Never read financial
// originals, write ledgers, infer missing days, or turn invalid rows into zero.
const {normalizeExtraCounts}=require("./additional-counts.cjs");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const fail=()=>{throw Error("PARTNER_PRODUCT_MONTH_UNVERIFIED");};
const positive=n=>Number.isSafeInteger(n)&&n>=0;
function projectPartnerProductMonth({hubId,cid,month,keys,workDocs=[],extraDocs=[]}={}){
 if(!ID.test(hubId||"")||!ID.test(cid||"")||!MONTH.test(month||"")||
   !Array.isArray(keys)||keys.length!==9||new Set(keys).size!==keys.length||
   keys.some(k=>typeof k!=="string"||!k)||!Array.isArray(workDocs)||
   !Array.isArray(extraDocs)||workDocs.length>2000||extraDocs.length>2000)fail();
 const counts=Object.fromEntries(keys.map(k=>[k,0]));
 const privateCounts=Object.create(null),additionalCounts=Object.create(null);
 let primaryTotalCount=0,privateTotalCount=0,additionalTotalCount=0;
 const seenWork=new Set(),seenExtra=new Set();
 const verifyDoc=(doc,seen)=>{
  const x=doc?.data?.();
  if(!x||typeof x!=="object"||!ID.test(x.staffId||"")||
    typeof x.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||
    !x.date.startsWith(month+"-")||doc.id!==x.date+"__"+x.staffId||
    x.companyId!==cid||x.hubCompanyId!==hubId||
    !positive(x.version)||x.version<1||seen.has(doc.id))fail();
  seen.add(doc.id);return x;
 };
 const add=(target,id,n)=>{
  if(!positive(n)||n>9999||!ID.test(id)||["__proto__","constructor","prototype"].includes(id))fail();
  target[id]=(target[id]||0)+n;
  if(!positive(target[id]))fail();
 };
 for(const doc of workDocs){
  const x=verifyDoc(doc,seenWork),values=x.counts;
  if(!values||typeof values!=="object"||Array.isArray(values)||
    Object.keys(values).length!==keys.length)fail();
  let subtotal=0;
  for(const k of keys){
   const n=values[k];if(!positive(n)||n>9999)fail();
   counts[k]+=n;subtotal+=n;
   if(!positive(counts[k])||!positive(subtotal))fail();
  }
  if(x.totalCount!==subtotal)fail();
  primaryTotalCount+=subtotal;
  const extra=x.privateCounts??{};
  if(!extra||typeof extra!=="object"||Array.isArray(extra)||
    Object.keys(extra).length>100)fail();
  let individualPrivate=0;
  for(const [id,n] of Object.entries(extra)){
   add(privateCounts,id,n);individualPrivate+=n;
   if(!positive(individualPrivate))fail();
  }
  if((x.privateTotalCount??0)!==individualPrivate)fail();
  privateTotalCount+=individualPrivate;
  if(!positive(primaryTotalCount)||!positive(privateTotalCount))fail();
 }
 for(const doc of extraDocs){
  const x=verifyDoc(doc,seenExtra);
  const normalized=normalizeExtraCounts(x.counts);
  if(x.totalCount!==normalized.total)fail();
  for(const [id,n] of Object.entries(normalized.counts))add(additionalCounts,id,n);
  additionalTotalCount+=normalized.total;
  if(!positive(additionalTotalCount))fail();
 }
 const totalCount=primaryTotalCount+privateTotalCount+additionalTotalCount;
 if(!positive(totalCount))fail();
 return {categories:[...keys],counts,
  privateCounts:Object.fromEntries(Object.entries(privateCounts)),
  additionalCounts:Object.fromEntries(Object.entries(additionalCounts)),
  primaryTotalCount,privateTotalCount,additionalTotalCount,totalCount,
  verifiedWorkRows:workDocs.length,verifiedExtraRows:extraDocs.length,
  // A missing report is NOT a confirmed zero. Show saved entries only.
  complete:false};
}
module.exports={projectPartnerProductMonth};
