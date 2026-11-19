"use strict";
/**
 * A shared app needs NO separate per-product/per-partner visibility toggle.
 *
 * Auth, hub affiliation, partner relation, count entry validation and
 * immutable saved-team attribution remain verified by service.cjs.
 * This pure function only chooses count categories, NEVER changes the
 * saved ledger. Existing Owner-review mode remains untouched unless the
 * server's NEW, independent, default-OFF feature flag is explicitly enabled.
 */
const {KEYS}=require("./shared-count-standings.cjs");
const stop=()=>{throw Error("UNIFIED_COUNT_CATEGORY_POLICY_UNVERIFIED");};
const id=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
function getCountRankingCategories({mode="legacy",hubId,partnerId,legacyCategories}={}){
 if(!id(hubId)||!id(partnerId)||hubId===partnerId||!["legacy","unified"].includes(mode))stop();
 if(mode==="legacy"){
  if(!Array.isArray(legacyCategories)||legacyCategories.length>KEYS.length||
   new Set(legacyCategories).size!==legacyCategories.length||
   legacyCategories.some(x=>!KEYS.includes(x)))stop();
  return Object.freeze([...legacyCategories]);
 }
 // EXACT original 9-key partner count ledger, including historical combined
 // 光・AIR. No name-based remapping, synthetic zero reports, or financial SKUs.
 // All partners in one verified hub have the SAME categories.
 if(legacyCategories!==undefined)stop();
 return Object.freeze([...KEYS]);
}
module.exports={getCountRankingCategories};
