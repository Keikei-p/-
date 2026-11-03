"use strict";
// Count-only shared ranking group definition: never contains prices, revenue,
// cashback revenue, target amounts, emails or Firestore original sales records.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONEY=/(?:売上|単価|利益|原価|収益|報酬|価格|¥|￥|\$|€|\d[\d,，.]*\s*(?:万|千)?円|revenue|unitprice|cashback|commission)/i;
const assert=(ok)=>{if(!ok)throw Error("SHARED_RANKING_GROUPS_INVALID");};
const validId=s=>typeof s==="string"&&ID.test(s)&&!["__proto__","constructor","prototype"].includes(s);
function decodeGroups(input,{allowedProducts=[],categories=[]}={}){
 const doc=input==null?{revision:0,groups:[]}:input;
 assert(doc&&typeof doc==="object"&&!Array.isArray(doc)&&
   Number.isSafeInteger(doc.revision)&&doc.revision>=0&&
   Array.isArray(doc.groups)&&doc.groups.length<=30);
 assert(Array.isArray(allowedProducts)&&Array.isArray(categories));
 const productSet=new Set(allowedProducts),categorySet=new Set(categories);
 const names=new Set(),ids=new Set(),allKeys=new Set(),groups=[];
 for(const group of doc.groups){
  assert(group&&typeof group==="object"&&!Array.isArray(group)&&
    validId(group.id)&&typeof group.name==="string"&&group.name.trim().length>0&&
    group.name.trim().length<=40&&!MONEY.test(group.name)&&
    Array.isArray(group.keys)&&group.keys.length>0&&group.keys.length<=100);
  assert(!ids.has(group.id)&&!names.has(group.name.trim()));
  ids.add(group.id);names.add(group.name.trim());
  const keys=[];
  for(const key of group.keys){
   assert(typeof key==="string"&&key.length<=160&&!allKeys.has(key));
   const prefix=key.startsWith("id:")?"id:":key.startsWith("legacy:")?"legacy:":null;
   assert(prefix!==null);
   const value=key.slice(prefix.length);
   assert(prefix==="id:"?validId(value)&&productSet.has(value):categorySet.has(value));
   allKeys.add(key);keys.push(key);
  }
  groups.push({id:group.id,name:group.name.trim(),keys});
 }
 return {revision:doc.revision,groups};
}
function saveGroups(current,newGroups,revision,validation){
 assert(Number.isSafeInteger(revision)&&revision>=0);
 const prev=decodeGroups(current,validation);
 assert(prev.revision===revision);
 const normalized=decodeGroups({revision:revision+1,groups:newGroups},validation);
 return normalized;
}
// One shared result for HQ & partners from verified, redacted per-person category rows.
// Product IDs without an owner-approved category mapping cannot be inferred by name.
function groupPersonalScores(groups,persons,{categories=[],productLinks=[],extraVerifiedIds=[]}={}){
 assert(Array.isArray(groups)&&Array.isArray(persons)&&Array.isArray(categories)&&
   Array.isArray(productLinks)&&Array.isArray(extraVerifiedIds)&&
   extraVerifiedIds.every(validId)&&new Set(extraVerifiedIds).size===extraVerifiedIds.length);
 const extraVerified=new Set(extraVerifiedIds);
 const categoriesSet=new Set(categories),linked=new Map(),usedCategories=new Set();
 // Only Owner-approved, date-effective mappings can turn a product ID into
 // an existing count category. Never infer mappings from product names.
 for(const link of productLinks){
  assert(link&&validId(link.productId)&&categoriesSet.has(link.category)&&
   !linked.has(link.productId)&&!usedCategories.has(link.category));
  linked.set(link.productId,link.category);
  usedCategories.add(link.category);
 }
 assert([...linked.keys()].every(id=>!extraVerified.has(id)));
 const out=[];
 for(const group of groups){
  const categoryKeys=new Set(),extraKeys=new Set();
  let unmapped=false;
  for(const key of group.keys){
   if(key.startsWith("legacy:")){
    const category=key.slice(7);
    assert(categoriesSet.has(category));
    categoryKeys.add(category);
   }else if(key.startsWith("id:")){
    const productId=key.slice(3),category=linked.get(productId);
    if(category)categoryKeys.add(category);
    else if(extraVerified.has(productId))extraKeys.add(productId);
    else {unmapped=true;break;}
   }else assert(false);
  }
  // A mixed group must not silently drop an unlinked product ID and publish
  // a plausible but WRONG ranking. Dedupe mapped IDs and legacy keys.
  if(unmapped){out.push({id:group.id,name:group.name,complete:false,members:[]});continue;}
  const members=[];
  for(const p of persons){
   assert(p&&typeof p.name==="string"&&Array.isArray(p.sourceIds)===false&&
     p.counts&&typeof p.counts==="object"&&!Array.isArray(p.counts));
   let count=0;
   for(const k of categoryKeys){
    const value=p.counts[k];
    assert(Number.isSafeInteger(value)&&value>=0);
    count+=value;
   }
   for(const productId of extraKeys){
    const value=p.extraCounts?.[productId]??0;
    assert(Number.isSafeInteger(value)&&value>=0);
    count+=value;
   }
   assert(Number.isSafeInteger(count));
   members.push({key:p.key,name:p.name,companyName:p.companyName||"直営",count});
  }
  members.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja")||
    String(a.key).localeCompare(String(b.key)));
  let rank=0,last=null;
  const ranks=members.map((p,index)=>{
   if(p.count!==last)rank=index+1;
   last=p.count;
   return {rank,name:p.name,companyName:p.companyName,count:p.count};
  });
  out.push({id:group.id,name:group.name,complete:true,members:ranks});
 }
 return out;
}
module.exports={decodeGroups,saveGroups,groupPersonalScores};
