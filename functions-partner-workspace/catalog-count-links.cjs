"use strict";
// Catalog-to-legacy-count mapping is a NEW, isolated settings document.
// This is deliberately not a migration: existing entries, summaries, audit
// versions, sales records and price schedules must never be rewritten.
const {validId}=require("./catalog-publication.cjs");
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const fail=()=>{throw Error("PARTNER_CATEGORY_LINK_INVALID");};
const validDate=value=>{
 if(typeof value!=="string"||!DATE.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z"))||
  new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)fail();
 return value;
};
function readLinks(doc,categories){
 if(!Array.isArray(categories)||categories.length!==new Set(categories).size||
    categories.some(x=>typeof x!=="string"||!x))fail();
 if(doc==null)return {revision:0,links:[]};
 if(!doc||typeof doc!=="object"||Array.isArray(doc)||
    !Number.isSafeInteger(doc.revision)||doc.revision<1||
    !Array.isArray(doc.links)||doc.links.length>categories.length)fail();
 const ids=new Set(),cats=new Set();
 const links=doc.links.map(x=>{
  if(!x||typeof x!=="object"||Array.isArray(x)||
     Object.keys(x).sort().join("|")!=="category|effectiveFrom|productId"||
     !validId(x.productId)||!categories.includes(x.category)||
     ids.has(x.productId)||cats.has(x.category))fail();
  validDate(x.effectiveFrom);
  ids.add(x.productId);cats.add(x.category);
  return {productId:x.productId,category:x.category,effectiveFrom:x.effectiveFrom};
 });
 return {revision:doc.revision,links};
}
function addLink({existing,productId,category,effectiveFrom,expectedRevision,
  publishedIds,categories}){
 if(!validId(productId)||!Array.isArray(publishedIds)||!publishedIds.includes(productId)||
    !Array.isArray(categories)||!categories.includes(category)||
    !Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail();
 validDate(effectiveFrom);
 const state=readLinks(existing,categories);
 if(state.revision!==expectedRevision||
    state.links.some(x=>x.productId===productId||x.category===category))fail();
 // Immutable effective date: changing linkage later could silently reattribute
 // historical quantities. Existing links cannot be reassigned or deleted.
 return {revision:state.revision+1,
  links:[...state.links,{productId,category,effectiveFrom}]
   .sort((a,b)=>a.category.localeCompare(b.category))};
}
function projectLinks(existing,{categories,publishedIds,audience,date}){
 if(!["hub","partner"].includes(audience)||!Array.isArray(publishedIds))fail();
 if(date!=null)validDate(date);
 const state=readLinks(existing,categories);
 const published=new Set(publishedIds);
 // Owner may view all historic links; partners receive only current published
 // identifiers and only on/after their effective date.
 return {revision:state.revision,links:state.links.filter(x=>
    audience==="hub" || published.has(x.productId)&&(date==null||date>=x.effectiveFrom))
  .map(x=>({...x}))};
}
module.exports={readLinks,addLink,projectLinks,validDate};
