"use strict";
/**
 * Opt-in SB light / Air count separation.
 *
 * The original "SB光・AIR" figure is a compatibility checksum, NOT an
 * additional sale. Historical figures that have no verified attribution
 * stay in "旧未分類" until an authorised, explicitly versioned correction.
 *
 * Pure functions: no Firestore, prices, user records or live writes.
 */
const LEGACY="SB光・AIR";
const LIGHT="SB光";
const AIR="SB AIR";
const UNCLASSIFIED="旧未分類";
const PARTS=Object.freeze([LIGHT,AIR,UNCLASSIFIED]);
const MAX_ROW=9999;
const safe=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const equalKeys=x=>Object.keys(x).sort().join("|")===PARTS.slice().sort().join("|");
const add=(a,b)=>{const sum=a+b;if(!Number.isSafeInteger(sum))throw Error("SB_SPLIT_OVERFLOW");return sum};
function breakdown(combined,raw,{max=MAX_ROW}={}){
 if(!safe(combined,max))throw Error("SB_SPLIT_LEGACY_INVALID");
 if(raw===undefined||raw===null)
  return {[LIGHT]:0,[AIR]:0,[UNCLASSIFIED]:combined};
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!equalKeys(raw))
  throw Error("SB_SPLIT_SCHEMA_INVALID");
 let total=0;
 const result={};
 for(const part of PARTS){
  if(!safe(raw[part],max))throw Error("SB_SPLIT_PART_INVALID");
  result[part]=raw[part];total=add(total,raw[part]);
 }
 if(total!==combined)throw Error("SB_SPLIT_TOTAL_MISMATCH");
 return result;
}
function nextBreakdown({previousLegacy,previousRaw,nextLegacy,requestedRaw}){
 // A missing breakdown is an intentional request from a LEGACY client.
 // Do not let a stale/old tab overwrite an already-classified document.
 const hadSplit=previousRaw!==undefined&&previousRaw!==null;
 if(requestedRaw===undefined||requestedRaw===null){
  if(hadSplit){
   if(previousLegacy!==nextLegacy)
    throw Error("SB_SPLIT_OLD_CLIENT_MUST_REFRESH");
   return breakdown(previousLegacy,previousRaw);
  }
  // Old clients that write to old documents stay fully compatible.
  return null;
 }
 return breakdown(nextLegacy,requestedRaw);
}
function aggregateBreakdown({previousAggregate,previousRaw,priorLegacy,priorRaw,nextLegacy,nextRaw}){
 const current=breakdown(previousAggregate,previousRaw,{max:Number.MAX_SAFE_INTEGER});
 const oldEntry=breakdown(priorLegacy,priorRaw);
 const newEntry=breakdown(nextLegacy,nextRaw);
 const result={},values=[];
 for(const part of PARTS){
  const n=current[part]-oldEntry[part]+newEntry[part];
  if(!safe(n,Number.MAX_SAFE_INTEGER))
   throw Error("SB_SPLIT_AGGREGATE_UNDERFLOW");
  result[part]=n;values.push(n);
 }
 if(values.reduce(add,0)!==previousAggregate-priorLegacy+nextLegacy)
  throw Error("SB_SPLIT_AGGREGATE_MISMATCH");
 return result;
}
module.exports=Object.freeze({
 LEGACY,LIGHT,AIR,UNCLASSIFIED,PARTS,breakdown,nextBreakdown,aggregateBreakdown
});
