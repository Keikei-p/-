/**
 * STAGING / NO DEPLOY. Read-only preview of existing partnerWorkEntries.
 * Must be called only with complete, snapshot-consistent, server-verified
 * count-only data. No Firebase SDK or data writes. Never infer SB light/AIR
 * individual counts from the old combined category.
 */
import {PARTNER_RANK_SKUS} from "./partner-workspace-count-source.mjs";
const CAT=PARTNER_RANK_SKUS.map(p=>({id:p.id,label:p.name.replace("（旧合算・未分類）","")}));
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const safe=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const obj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const fail=k=>{throw Error("PARTNER_HISTORY_PREVIEW_"+k)};
const money=/(?:売上|単価|報酬|利益|収益|キャッシュバック|cashback|revenue|unitprice|[¥￥$€]|[0-9０-９][0-9０-９,.]*\s*(?:円|万円))/i;
function dayInMonth(d,m){
 if(typeof d!=="string"||!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(d)||d.slice(0,7)!==m)return false;
 const v=new Date(d+"T00:00:00Z");
 return !Number.isNaN(v.getTime())&&v.toISOString().slice(0,10)===d;
}
export function previewHistoricalPartnerMapping({
 hubCompanyId,partnerCompanyId,ownerUid,month,proof,entries,
 mapping,visibility,products
}={}){
 if(!safe(hubCompanyId)||!safe(partnerCompanyId)||hubCompanyId===partnerCompanyId||
    !safe(ownerUid)||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month||"")||
    !obj(proof)||!proof.ownerVerified||!proof.partnerRelationVerified||
    !proof.completeMonthEntriesRead||!proof.snapshotConsistent||
    !Array.isArray(entries)||entries.length>100000||
    !Array.isArray(products)||products.length>1000)fail("SCOPE");
 if(!obj(visibility)||visibility.hubCompanyId!==hubCompanyId||
    visibility.ownerUid!==ownerUid||
    !Array.isArray(visibility.enabledHubProductIds)||
    !obj(visibility.partnerOverrides))fail("VISIBILITY");
 const catalog=new Map();
 for(const p of products){
  if(!obj(p)||!safe(p.id)||catalog.has(p.id)||p.companyId!==hubCompanyId||
     typeof p.active!=="boolean"||typeof p.name!=="string"||
     !p.name.trim()||p.name.length>80||money.test(p.name.normalize("NFKC")))
   fail("PRODUCT");
  catalog.set(p.id,p);
 }
 const collectIds=(items,kind)=>{
  if(!Array.isArray(items)||items.length>1000)fail(kind);
  const result=new Set();
  for(const item of items){
   if(!safe(item)||!catalog.has(item)||result.has(item))fail(kind);
   result.add(item);
  }
  return result;
 };
 const globalOn=collectIds(visibility.enabledHubProductIds,"GLOBAL_ON");
 const allowed=Object.hasOwn(visibility.partnerOverrides,partnerCompanyId)?
  visibility.partnerOverrides[partnerCompanyId]:visibility.enabledHubProductIds;
 const companyOn=collectIds(allowed,"PARTNER_ON");
 const bind=new Map(),used=new Set(),seenBindings=new Set();
 if(mapping!=null){
  if(!obj(mapping)||mapping.hubCompanyId!==hubCompanyId||
     mapping.ownerUid!==ownerUid||mapping.reviewedByUid!==ownerUid||
     mapping.active!==true||!Number.isSafeInteger(mapping.version)||
     mapping.version<1||!Array.isArray(mapping.bindings)||
     mapping.bindings.length>1000)fail("MAPPING");
  for(const item of mapping.bindings){
   if(!obj(item)||Object.keys(item).sort().join("|")!==
      ["companyId","productId","hubProductId"].sort().join("|")||
      !safe(item.companyId)||!safe(item.hubProductId)||
      !CAT.some(c=>c.id===item.productId))fail("BINDING");
   const key=item.companyId+":"+item.productId;
   if(seenBindings.has(key))fail("DUPLICATE");
   seenBindings.add(key);
   if(item.companyId!==partnerCompanyId)continue;
   const p=catalog.get(item.hubProductId);
   if(!p||used.has(item.hubProductId))fail("COLLISION");
   if(item.productId==="partnerSku05"&&
      !/(?:SB光・AIR|旧合算|未分類)/.test(p.name))fail("COMBINED_CANNOT_SPLIT");
   used.add(item.hubProductId);
   bind.set(item.productId,item.hubProductId);
  }
 }
 const names=CAT.map(x=>x.label),sums=new Map(CAT.map(x=>[x.id,0]));
 const entriesSeen=new Set();let total=0,zeroReports=0;
 for(const e of entries){
  if(!obj(e)||e.companyId!==partnerCompanyId||
     e.hubCompanyId!==hubCompanyId||!dayInMonth(e.date,month)||
     !safe(e.staffId)||!safe(e.teamIdSnapshot))fail("ENTRY_SCOPE");
  const key=e.date+"__"+e.staffId;
  if(entriesSeen.has(key)||(e.id!==undefined&&e.id!==key))fail("ENTRY_DUPLICATE");
  entriesSeen.add(key);
  if(!obj(e.counts)||Object.keys(e.counts).sort().join("|")!==
     names.slice().sort().join("|"))fail("ENTRY_KEYS");
  let entryTotal=0;
  for(const c of CAT){
   const value=e.counts[c.label];
   if(!Number.isSafeInteger(value)||value<0||value>9999)fail("ENTRY_COUNT");
   sums.set(c.id,sums.get(c.id)+value);
   entryTotal+=value;
  }
  if(e.totalCount!==entryTotal||!Number.isSafeInteger(entryTotal))fail("ENTRY_TOTAL");
  if(entryTotal===0)zeroReports++;
  total+=entryTotal;
  if(!Number.isSafeInteger(total))fail("OVERFLOW");
 }
 const categories=[],byHub=new Map();
 let included=0,held=0;
 for(const c of CAT){
  const originalCount=sums.get(c.id);
  const targetHubProductId=bind.get(c.id)??null;
  const prod=targetHubProductId===null?null:catalog.get(targetHubProductId);
  const on=!!prod&&prod.active&&globalOn.has(prod.id)&&companyOn.has(prod.id);
  const state=!prod?"unmapped":on?"published":"mapped_off";
  if(on){
   included+=originalCount;
   byHub.set(prod.id,(byHub.get(prod.id)||0)+originalCount);
  }else held+=originalCount;
  categories.push(Object.freeze({
   sourceSkuId:c.id,sourceLabel:c.label,originalCount,targetHubProductId,
   state,rankingIncludedCount:on?originalCount:0,
   heldCount:on?0:originalCount,legacyCombined:c.id==="partnerSku05"
  }));
 }
 if(included+held!==total||
    [...sums.values()].reduce((a,b)=>a+b,0)!==total)fail("RECONCILIATION");
 return Object.freeze({
  schema:"nico-partner-history-preview-v1",hubCompanyId,partnerCompanyId,month,
  existingEntryCount:entries.length,reportedZeroEntryCount:zeroReports,
  originalTotalCount:total,rankingIncludedCount:included,heldCount:held,
  legacyCombinedSourceCount:sums.get("partnerSku05"),
  categories:Object.freeze(categories),
  publishedByHubProductId:Object.freeze([...byHub].map(([productId,count])=>
    Object.freeze({productId,count}))),
  historicalWrites:0,mappingWrites:0,missingReportCount:null
 });
}
