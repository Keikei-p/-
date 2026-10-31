/**
 * Non-deploying contract for the next generation of hub/partner catalog.
 * Every returned value is a small allowlisted shape. No untrusted browser
 * companyId/price/revenue/cashback-amount values are ever serialized.
 *
 * The hub owns publication rules. Partners own PRIVATE local products.
 * Only hub-published canonical products may contribute to hub totals.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONEY=/売上|単価|収益|利益|報酬|原価|価格|[¥￥$€]|(?:\d[\d,.]*)\s*(?:万|千)?円|revenue|unit.?price|cashback|commission/i;
const refuse=x=>{throw Error("CATALOG_PRIVACY_STOP_"+x);};
const id=(x,label)=>{if(typeof x!=="string"||!ID.test(x))refuse(label);return x;};
const name=x=>{
 if(typeof x!=="string"||!x.trim()||x.trim().length>80||MONEY.test(x))refuse("PRODUCT_NAME");
 return x.trim();
};
const own=x=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const safeCount=x=>Number.isSafeInteger(x)&&x>=0&&x<=9999;
const safeIds=x=>Array.isArray(x)&&x.length<=1000&&x.every(i=>typeof i==="string"&&ID.test(i))&&new Set(x).size===x.length;

/**
 * The owner chooses which existing internal products are listed for all
 * partners or for one specified partner. Non-listed products are never
 * transmitted. Revoking visibility never deletes historical sales rows.
 */
export function validateHubPublication({actor,hubCompanyId,partnerCompanyId=null,productIds}){
 if(!own(actor)||actor.serverVerified!==true||actor.companyRole!=="owner"||
    actor.companyId!==hubCompanyId)refuse("ACTOR_NOT_OWNER");
 id(hubCompanyId,"HUB_ID");
 if(partnerCompanyId!==null){id(partnerCompanyId,"PARTNER_ID");
  if(partnerCompanyId===hubCompanyId)refuse("SELF_PARTNER");}
 if(!safeIds(productIds))refuse("PUBLICATION_IDS");
 return Object.freeze({hubCompanyId,partnerCompanyId,
  scope:partnerCompanyId===null?"all_partners":"one_partner",
  productIds:Object.freeze(productIds.slice())});
}

/**
 * Omit prices and exclude unpublished/disabled products BEFORE responding
 * to the partner. Publish-by-ID, never guess by text label.
 */
export function projectPublishedProducts({hubCompanyId,partnerCompanyId,productMaster,globalIds=[],partnerIds=[]}){
 id(hubCompanyId,"HUB_ID");id(partnerCompanyId,"PARTNER_ID");
 if(hubCompanyId===partnerCompanyId||!Array.isArray(productMaster)||productMaster.length>1000||
    !safeIds(globalIds)||!safeIds(partnerIds))refuse("BAD_CATALOG");
 const allowed=new Set([...globalIds,...partnerIds]);
 const seen=new Set(),out=[];
 for(const raw of productMaster){
  if(!own(raw)||!id(raw.id,"MASTER_PRODUCT_ID")||
     raw.companyId!==hubCompanyId||seen.has(raw.id))refuse("FOREIGN_DUPLICATE_PRODUCT");
  seen.add(raw.id);
  if(!allowed.has(raw.id)||raw.active===false)continue;
  // All financial attributes are discarded by design.
  out.push({catalogId:"shared:"+hubCompanyId+":"+raw.id,
   canonicalProductId:raw.id,name:name(raw.name),origin:"hub"});
 }
 return out;
}

/**
 * Partners may create their own count-only products without approval, but
 * custom product definitions are ALWAYS private to that partner.
 * No sharing switch exists; the hub cannot enable one.
 */
export function validatePrivateProduct({actor,partnerCompanyId,productId,productName,active=true}){
 if(!own(actor)||actor.serverVerified!==true||actor.companyId!==partnerCompanyId||
    actor.companyKind!=="partner"||actor.role!=="owner")refuse("PARTNER_OWNER_ONLY");
 id(partnerCompanyId,"PARTNER_ID");id(productId,"CUSTOM_PRODUCT_ID");
 if(active!==true&&active!==false)refuse("ACTIVE_FLAG");
 return {companyId:partnerCompanyId,productId,name:name(productName),
  origin:"partner_custom",visibility:"private",active};
}
/**
 * Only canonical, server-verified published product IDs reach hub totals.
 * PRIVATE lines are returned only to the same partner. The hub payload does
 * not include a private total, staff metadata or unknown product IDs.
 */
export function projectCountAudience({audience,partnerCompanyId,hubCompanyId,
  publishedIds,partnerLocalIds=[],lines}){
 if(!["hub","partner"].includes(audience))refuse("AUDIENCE");
 id(partnerCompanyId,"PARTNER_ID");id(hubCompanyId,"HUB_ID");
 if(!safeIds(publishedIds)||!safeIds(partnerLocalIds)||
    !Array.isArray(lines)||lines.length>2000)refuse("COUNT_SCHEMA");
 const publicSet=new Set(publishedIds),privateSet=new Set(partnerLocalIds);
 if(publishedIds.some(x=>privateSet.has(x)))refuse("OVERLAPPING_IDENTITIES");
 const totals=new Map(),seen=new Set();
 for(const line of lines){
  if(!own(line)||line.companyId!==partnerCompanyId||
     !id(line.entryId,"ENTRY_ID")||!id(line.productId,"PRODUCT_ID")||
     !safeCount(line.count))refuse("FOREIGN_OR_MALFORMED_ENTRY");
  if(seen.has(line.entryId))refuse("DUPLICATE_ENTRY");
  seen.add(line.entryId);
  if(!publicSet.has(line.productId)&&!privateSet.has(line.productId))
    refuse("UNKNOWN_PRODUCT_ID");
  if(audience==="hub"&&!publicSet.has(line.productId))continue;
  totals.set(line.productId,(totals.get(line.productId)||0)+line.count);
 }
 const counts=[...totals.entries()].map(([productId,count])=>({productId,count}));
 return {counts,totalCount:counts.reduce((x,y)=>x+y.count,0)};
}

/**
 * Joint personal standings may be computed by the trusted backend but NEVER
 * send counts or financial data to any audience.
 */
export function projectPersonalRankings(rows){
 if(!Array.isArray(rows)||rows.length>500)refuse("TOO_MANY_RANKS");
 const seen=new Set(),ranked=[];
 for(const r of rows){
  if(!own(r)||!id(r.personId,"PERSON")||!id(r.companyId,"COMPANY")||
     !safeCount(r.sharedCount)||!r.name||!r.affiliation||
     typeof r.name!=="string"||typeof r.affiliation!=="string"||
     r.name.length>60||r.affiliation.length>80||MONEY.test(r.name)||MONEY.test(r.affiliation))
    refuse("RANK_ROW");
  const key=r.companyId+"|"+r.personId;
  if(seen.has(key))refuse("DUPLICATE_PERSON");
  seen.add(key);
  ranked.push({personId:r.personId,companyId:r.companyId,
    name:r.name,affiliation:r.affiliation,sharedCount:r.sharedCount});
 }
 ranked.sort((a,b)=>b.sharedCount-a.sharedCount||a.companyId.localeCompare(b.companyId)||
   a.personId.localeCompare(b.personId));
 return ranked.map((r,i)=>({rank:i+1,name:r.name,affiliation:r.affiliation}));
}
