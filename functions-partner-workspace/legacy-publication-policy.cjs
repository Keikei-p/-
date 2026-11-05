"use strict";
// Count-only, explicit rollout gate for existing nine category inputs.
// The original saved counts and audit log are never migrated or rewritten.
const {readLinks,validDate}=require("./catalog-count-links.cjs");
const {loadPublication}=require("./catalog-publication.cjs");
const fail=()=>{throw Error("PARTNER_LEGACY_PUBLICATION_POLICY_INVALID");};
function readLegacyGate(doc){
 if(doc==null)return {revision:0,mode:"legacy",effectiveFrom:null};
 if(!doc||typeof doc!=="object"||Array.isArray(doc)||
    !Number.isSafeInteger(doc.revision)||doc.revision!==1||
    doc.mode!=="enforce")fail();
 return {revision:1,mode:"enforce",effectiveFrom:validDate(doc.effectiveFrom)};
}
function activateLegacyGate(existing,effectiveFrom,expectedRevision){
 const current=readLegacyGate(existing);
 if(current.mode!=="legacy"||expectedRevision!==0)fail();
 validDate(effectiveFrom);
 return {revision:1,mode:"enforce",effectiveFrom};
}
function resolveLegacyInputPolicy({gate,publication,links,date,categories}={}){
 validDate(date);
 const g=readLegacyGate(gate);
 const pub=loadPublication(publication);
 const mappings=readLinks(links,categories);
 const active=g.mode==="enforce"&&date>=g.effectiveFrom;
 const blocked=active?mappings.links.filter(link=>
  link.effectiveFrom<=date&&!pub.productIds.includes(link.productId))
  .map(link=>link.category):[];
 // The public result contains only fixed category labels, no unpublished
 // product identifiers, product prices, or original financial data.
 return {mode:!active?(g.mode==="enforce"?"scheduled":"legacy"):"enforce",
  effectiveFrom:g.effectiveFrom,blockedCategories:blocked};
}
function assertLegacyEditAllowed({policy,previous,next,previousCb,nextCb,categories}={}){
 if(!policy||!["legacy","scheduled","enforce"].includes(policy.mode)||
    !Array.isArray(policy.blockedCategories)||!Array.isArray(categories)||
    new Set(categories).size!==categories.length||
    !previous||!next||typeof previous!=="object"||typeof next!=="object")fail();
 if(policy.mode!=="enforce"&&policy.blockedCategories.length)fail();
 for(const key of policy.blockedCategories){
  if(!categories.includes(key)||
   !Number.isSafeInteger(previous[key])||!Number.isSafeInteger(next[key])||
   previous[key]!==next[key])fail();
  if(key==="NURO"){
   // CB revisions also carry historical information. Blocking a product
   // freezes its tier distribution, not only the top-level count.
   if(JSON.stringify(previousCb??null)!==JSON.stringify(nextCb??null))fail();
  }
 }
 return true;
}
module.exports={readLegacyGate,activateLegacyGate,resolveLegacyInputPolicy,assertLegacyEditAllowed};
