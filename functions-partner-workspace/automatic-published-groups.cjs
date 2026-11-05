"use strict";
// Additional published products appear automatically in the EXISTING shared
// product leaderboard. Do not create sales records, change categories, or
// derive links from display names. All inputs are already server redacted.
const crypto=require("node:crypto");
const {validId,nameOnly}=require("./catalog-publication.cjs");
const {decodeGroups}=require("./shared-ranking-groups.cjs");
const fail=()=>{throw Error("PUBLISHED_RANK_GROUPS_UNVERIFIED");};
const MAX_VISIBLE_GROUPS=100;
function readVisibleRankingGroups(raw,visibleIds,categories){
 if(!Array.isArray(visibleIds)||visibleIds.some(id=>!validId(id))||
  new Set(visibleIds).size!==visibleIds.length)fail();
 // Existing Owner-saved groups can contain IDs of products which were
 // unpublished later. Validate the immutable saved config without mutating it,
 // then hide EVERY group referencing an unpublished or retired product.
 const declared=[];
 if(raw!=null){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||!Array.isArray(raw.groups))
   fail();
  for(const group of raw.groups){
   if(!group||!Array.isArray(group.keys))fail();
   for(const key of group.keys){
    if(typeof key==="string"&&key.startsWith("id:"))
     declared.push(key.slice(3));
   }
  }
 }
 let normalized;
 try{
  normalized=decodeGroups(raw,{
   allowedProducts:[...new Set([...visibleIds,...declared])],
   categories
  });
 }catch{fail();}
 const allowed=new Set(visibleIds);
 return {revision:normalized.revision,groups:normalized.groups.filter(group=>
  group.keys.every(key=>!key.startsWith("id:")||allowed.has(key.slice(3))))};
}
function addAutomaticPublishedGroups(savedGroups,publishedProducts,linkedIds,limit=MAX_VISIBLE_GROUPS){
 if(!Array.isArray(savedGroups)||savedGroups.length>30||
  !Array.isArray(publishedProducts)||publishedProducts.length>1000||
  !Array.isArray(linkedIds)||linkedIds.some(id=>!validId(id))||
  new Set(linkedIds).size!==linkedIds.length||
  !Number.isSafeInteger(limit)||limit<1||limit>MAX_VISIBLE_GROUPS)fail();
 const linked=new Set(linkedIds),covered=new Set(),seen=new Set();
 const groups=[];
 for(const group of savedGroups){
  if(!group||!validId(group.id)||typeof group.name!=="string"||
   !Array.isArray(group.keys))fail();
  for(const key of group.keys){
   if(typeof key!=="string")fail();
   if(key.startsWith("id:"))covered.add(key.slice(3));
  }
  groups.push(group);
 }
 for(const product of publishedProducts){
  if(!product||!validId(product.id)||seen.has(product.id))fail();
  seen.add(product.id);
  let safeName;
  try{safeName=nameOnly(product.name);}catch{fail();}
  if(linked.has(product.id)||covered.has(product.id))continue;
  // Hash the stable Firestore product ID. Never use arbitrary product labels
  // as rank identifiers, and never merge two distinct IDs with same names.
  const id="auto_"+crypto.createHash("sha256")
   .update("nico-published-product-v1\n"+product.id).digest("hex").slice(0,32);
  if(groups.some(group=>group.id===id))fail();
  groups.push({id,name:safeName,keys:["id:"+product.id]});
  if(groups.length>limit)fail(); // No silently dropped published products.
 }
 return groups;
}
module.exports={readVisibleRankingGroups,addAutomaticPublishedGroups,MAX_VISIBLE_GROUPS};
