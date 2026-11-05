"use strict";
// Server-only projection for the original NICO sales product master.
// The raw master includes price and cashback revenue; NEVER serialize it.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONEY=/(?:売上|単価|収益|利益|原価|報酬|価格|¥|[￥¥$€]|[0-9０-９][0-9０-９,.，]*\s*(?:万|千)?円|revenue|unitprice|unit_price|cashback|commission)/i;
function ensure(ok){if(!ok)throw Error("CATALOG_PUBLICATION_INVALID");}
function validId(id){return typeof id==="string"&&ID.test(id)&&!["__proto__","constructor","prototype"].includes(id);}
function nameOnly(name){
 ensure(typeof name==="string"&&name.trim().length>0&&name.trim().length<=80&&!MONEY.test(name));
 return name.trim();
}
function loadPublication(doc){
 if(doc==null)return {revision:0,productIds:[]};
 ensure(doc&&typeof doc==="object"&&!Array.isArray(doc));
 const revision=doc.revision,productIds=doc.productIds;
 ensure(Number.isSafeInteger(revision)&&revision>=1&&
  Array.isArray(productIds)&&productIds.length<=1000&&
  productIds.every(validId)&&new Set(productIds).size===productIds.length);
 return {revision,productIds:[...productIds]};
}
function projectMasterProducts(rows,publishedIds,forPartner){
 ensure(Array.isArray(rows)&&rows.length<=1000&&Array.isArray(publishedIds));
 const publicSet=new Set(publishedIds),seen=new Set(),result=[];
 for(const product of rows){
  ensure(product&&validId(product.id)&&!seen.has(product.id));
  seen.add(product.id);
  if(product.active===false)continue;
  if(forPartner&&!publicSet.has(product.id))continue;
  // Only attributes expressly allowlisted here cross into the partner UI.
  const displayName=nameOnly(product.name);
  result.push({id:product.id,name:displayName,
   sortOrder:Number.isSafeInteger(product.sortOrder)&&product.sortOrder>=0?
    product.sortOrder:0,
   published:publicSet.has(product.id)});
 }
 result.sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
 return result;
}
// The hub owner needs to see publication state for RETIRED products too,
// so they can turn an old ON flag OFF. Never return financial attributes.
function projectOwnerPublicationRows(rows,publishedIds){
 ensure(Array.isArray(rows)&&rows.length<=1000&&Array.isArray(publishedIds)&&
  publishedIds.every(validId));
 const published=new Set(publishedIds),seen=new Set();
 return rows.map(product=>{
  ensure(product&&validId(product.id)&&!seen.has(product.id));
  seen.add(product.id);
  let label;
  try{label=nameOnly(product.name);}catch{label="公開不可の商材";}
  return {id:product.id,name:label,
   sortOrder:Number.isSafeInteger(product.sortOrder)&&product.sortOrder>=0?
    product.sortOrder:0,published:published.has(product.id)};
 }).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
}
function changePublication(current,productId,published,expectedRevision){
 ensure(validId(productId)&&typeof published==="boolean"&&
  Number.isSafeInteger(expectedRevision)&&expectedRevision>=0);
 const existing=loadPublication(current);
 ensure(expectedRevision===existing.revision);
 const next=new Set(existing.productIds);
 if(published)next.add(productId);else next.delete(productId);
 ensure(next.size<=1000);
 return {revision:existing.revision+1,productIds:[...next].sort()};
}
module.exports={validId,nameOnly,loadPublication,projectMasterProducts,projectOwnerPublicationRows,changePublication};
