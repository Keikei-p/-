"use strict";
// Opt-in partner nine-category policy. No migration or price/revenue projection.
// The absence of an explicit per-company gate preserves EVERY existing input.
const {readLinks,validDate}=require("./catalog-count-links.cjs");
const {loadPublication}=require("./catalog-publication.cjs");
const fail=()=>{throw Error("PARTNER_LEGACY_GATE_INVALID");};
function readLegacyGate(doc){
 if(doc==null)return {revision:0,mode:"legacy",effectiveFrom:null};
 if(!doc||typeof doc!=="object"||Array.isArray(doc)||
    doc.revision!==1||doc.mode!=="enforce")fail();
 return {revision:1,mode:"enforce",effectiveFrom:validDate(doc.effectiveFrom)};
}
function nextDay(today){
 validDate(today);
 return new Date(Date.parse(today+"T00:00:00Z")+86400000).toISOString().slice(0,10);
}
function activateLegacyGate(current,effectiveFrom,expectedRevision){
 if(readLegacyGate(current).revision!==0||expectedRevision!==0)fail();
 return {revision:1,mode:"enforce",effectiveFrom:validDate(effectiveFrom)};
}
function resolveLegacyPolicy({gate,publication,links,date,categories}={}){
 validDate(date);
 const g=readLegacyGate(gate);
 if(g.mode!=="enforce"||date<g.effectiveFrom)
  return {mode:g.mode==="legacy"?"legacy":"scheduled",
   effectiveFrom:g.effectiveFrom,blockedCategories:[]};
 const pub=loadPublication(publication),mapping=readLinks(links,categories);
 const published=new Set(pub.productIds);
 const blocked=mapping.links.filter(x=>x.effectiveFrom<=date&&!published.has(x.productId))
  .map(x=>x.category);
 return {mode:"enforce",effectiveFrom:g.effectiveFrom,blockedCategories:blocked};
}
function assertUnchangedBlocked({policy,previous,next,categories}={}){
 if(!policy||!Array.isArray(policy.blockedCategories)||
    !["legacy","scheduled","enforce"].includes(policy.mode)||
    !Array.isArray(categories)||!previous||!next)fail();
 if(policy.mode!=="enforce"&&policy.blockedCategories.length)fail();
 const set=new Set();
 for(const key of policy.blockedCategories){
  if(set.has(key)||!categories.includes(key)||
     !Number.isSafeInteger(previous[key])||!Number.isSafeInteger(next[key])||
     previous[key]!==next[key])fail();
  set.add(key);
 }
 return true;
}
module.exports={readLegacyGate,nextDay,activateLegacyGate,resolveLegacyPolicy,assertUnchangedBlocked};
