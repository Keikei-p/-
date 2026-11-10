"use strict";
// Sanitizes count-only ranking responses for partner access. This must not
// mutate Firestore documents, aggregate inputs or owner response objects.
// Tier identifiers such as "60000" encode cashback amounts and must never
// leave shared ranking APIs for partners, even without an explicit price field.
const BLOCKED=new Set(["cbCounts","previousCbCounts"]);
function redactCashbackTiers(value){
 if(Array.isArray(value))return value.map(redactCashbackTiers);
 if(value&&typeof value==="object"){
  const clean={};
  for(const [key,entry] of Object.entries(value)){
   if(BLOCKED.has(key))continue;
   clean[key]=redactCashbackTiers(entry);
  }
  return clean;
 }
 return value;
}
module.exports={redactCashbackTiers};
