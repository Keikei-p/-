"use strict";
// The original nine partner buckets, sales prices and all audit versions are
// intentionally outside this module. Dynamic products use NEW separate docs.
const {validId}=require("./catalog-publication.cjs");
const fail=()=>{throw Error("PARTNER_ADDITIONAL_COUNTS_INVALID");};
function normalizeExtraCounts(input,{limit=100}={}){
 if(!input||typeof input!=="object"||Array.isArray(input)||
   Object.keys(input).length>limit)fail();
 let total=0;const counts=Object.create(null);
 for(const [id,value] of Object.entries(input)){
  if(!validId(id)||!Number.isSafeInteger(value)||value<0||value>9999)fail();
  counts[id]=value;total+=value;
 }
 if(!Number.isSafeInteger(total)||total>999900)fail();
 return {counts:Object.fromEntries(Object.entries(counts)),total};
}
function applyExtraCounts({previous={},changes={},allowedIds=[],blockedLegacyIds=[]}={}){
 const former=normalizeExtraCounts(previous);
 const patch=normalizeExtraCounts(changes);
 if(!Array.isArray(allowedIds)||!Array.isArray(blockedLegacyIds)||
    allowedIds.some(x=>!validId(x))||blockedLegacyIds.some(x=>!validId(x)))fail();
 const approved=new Set(allowedIds),blocked=new Set(blockedLegacyIds);
 // Only currently active/published unlinked products may be newly adjusted.
 for(const id of Object.keys(patch.counts)){
  if(!approved.has(id)||blocked.has(id))fail();
 }
 const combined=normalizeExtraCounts({...former.counts,...patch.counts});
 const legacyIntersection=Object.keys(combined.counts).filter(id=>blocked.has(id));
 // Even a retired or formerly approved product MUST NOT acquire a fixed-category
 // mapping while it has dynamic counts: mapping is immutable and collision-prone.
 if(legacyIntersection.length)fail();
 return combined;
}
function projectedExtraRead(saved,{visibleIds=[]}={}){
 const state=normalizeExtraCounts(saved||{});
 if(!Array.isArray(visibleIds)||visibleIds.some(id=>!validId(id)))fail();
 const visible=new Set(visibleIds);
 let archivedTotal=0;
 const counts={};
 for(const [id,value] of Object.entries(state.counts)){
  if(visible.has(id))counts[id]=value;
  else archivedTotal+=value;
 }
 return {counts,archivedTotal,totalCount:state.total};
}
module.exports={normalizeExtraCounts,applyExtraCounts,projectedExtraRead};
