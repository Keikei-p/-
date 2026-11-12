/**
 * STAGING / NO DEPLOY. Owner-controlled product ON/OFF for shared count
 * rankings. The trusted server MUST load the current owner settings, current
 * catalog and approved cross-company SKU mapping; NEVER accept browser flags.
 * A switch changes publication only. It NEVER edits historical sales/counts.
 */
import {buildVerifiedCountDashboard} from "./verified-dual-count-dashboards.mjs";
import {assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const deny=()=>{throw Error("OWNER_PRODUCT_RANKING_VISIBILITY_UNVERIFIED");};
const valid=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const unique=x=>Array.isArray(x)&&x.length<=10000&&
 x.every(valid)&&new Set(x).size===x.length;

/**
 * A pure plan for the internal owner toggle; the application must commit the
 * resulting IDs with an authenticated, version-checked server transaction.
 * No write/authentication/deployment occurs in this module.
 */
export function planOwnerProductToggle({
 actor,hubCompanyId,hubProducts,currentEnabledIds,productId,enabled
}={}){
 if(!valid(hubCompanyId)||!valid(productId)||
    !actor||actor.serverVerified!==true||
    actor.companyRole!=="owner"||actor.companyId!==hubCompanyId||
    typeof enabled!=="boolean"||!Array.isArray(hubProducts)||
    !unique(currentEnabledIds))deny();
 assertPublicSchema("publicProducts",hubProducts);
 const products=new Map();
 for(const p of hubProducts){
  if(p.companyId!==hubCompanyId||!valid(p.sourceId)||
     products.has(p.sourceId))deny();
  products.set(p.sourceId,p);
 }
 if(!products.has(productId)||
    currentEnabledIds.some(x=>!products.has(x))||
    (enabled&&products.get(productId).active!==true))deny();
 const next=new Set(currentEnabledIds);
 if(enabled)next.add(productId);else next.delete(productId);
 return Object.freeze({hubCompanyId,
  enabledHubProductIds:Object.freeze([...next].sort()),
  changed:next.has(productId)!==currentEnabledIds.includes(productId)});
}

/**
 * Publish-by-exact-ID, NOT by SKU label. The same enabled product set is
 * applied before computing person, team, company and product totals.
 *
 * publication is a server-owned read of the settings, not browser input.
 * partnerOverrides may additionally disable a globally ON product for one
 * partner. It can never re-enable a globally OFF product.
 */
export function buildOwnerVisibleCountRanking({input,publication}={}){
 if(!input||!publication||publication.serverVerified!==true||
    publication.ownerSettingsRead===true&&publication.ownerUidVerified!==true||
    publication.ownerSettingsRead!==true||
    publication.productMappingsReviewed!==true||
    publication.hubCompanyId!==input.hubCompanyId||
    !valid(publication.hubCompanyId)||
    !Number.isSafeInteger(publication.revision)||
    publication.revision<1||
    !unique(publication.enabledHubProductIds)||
    !Array.isArray(input.sources)||!Array.isArray(input.productGroups)||
    !Array.isArray(input.approvedCompanyIds))deny();

 // Complete original snapshot must reconcile BEFORE filtering. A missing
 // report or double-counted correction must not be hidden by an OFF switch.
 buildVerifiedCountDashboard(input);

 const hub=input.sources.find(s=>s.companyId===input.hubCompanyId);
 if(!hub||!Array.isArray(hub.products))deny();
 const allHub=new Map();
 for(const p of hub.products){
  if(!valid(p.sourceId)||allHub.has(p.sourceId))deny();
  allHub.set(p.sourceId,p);
 }
 const on=new Set(publication.enabledHubProductIds);
 for(const id of on)if(!allHub.has(id)||allHub.get(id).active!==true)deny();
 const partners=input.approvedCompanyIds.filter(x=>x!==input.hubCompanyId);
 const overrides=publication.partnerOverrides??[];
 if(!Array.isArray(overrides)||overrides.length>partners.length)deny();
 const partnerEnabled=new Map();
 for(const row of overrides){
  if(!row||!valid(row.companyId)||!partners.includes(row.companyId)||
     partnerEnabled.has(row.companyId)||!unique(row.enabledHubProductIds)||
     row.enabledHubProductIds.some(x=>!allHub.has(x)))deny();
  partnerEnabled.set(row.companyId,new Set(row.enabledHubProductIds));
 }
 const canonical=new Map(),groupOwners=new Map();
 for(const m of input.productGroups){
  if(m.companyId!==input.hubCompanyId)continue;
  if(!valid(m.productId)||!valid(m.groupId)||
     !allHub.has(m.productId)||canonical.has(m.productId)||
     groupOwners.has(m.groupId))deny();
  canonical.set(m.productId,m.groupId);
  groupOwners.set(m.groupId,m.productId);
 }
 for(const x of on)if(!canonical.has(x))deny();
 // Encode the pair as a tuple: IDs may themselves contain ':' so joining is unsafe.
 const key=(companyId,productId)=>JSON.stringify([companyId,productId]);
 const allowed=new Set();
 for(const m of input.productGroups){
  const hubId=groupOwners.get(m.groupId);
  if(!hubId||!on.has(hubId))continue;
  if(m.companyId!==input.hubCompanyId){
   const enabledForPartner=partnerEnabled.get(m.companyId);
   if(enabledForPartner&&!enabledForPartner.has(hubId))continue;
  }
  allowed.add(key(m.companyId,m.productId));
 }
 // Preserve every original report, team and historical person, but recompute
 // its PUBLISHED count from the filtered line items. Never mutate originals.
 const sources=input.sources.map(source=>{
  const enabledProducts=source.products.filter(p=>
   allowed.has(key(source.companyId,p.sourceId)));
  const enabled=enabledProducts.length>0;
  // A saved report containing ONLY an OFF SKU is NOT a verified zero
  // submission for any ON SKU. Do not publish its person/company/team as
  // a tied 0-count rank or reveal that the person reported a hidden SKU.
  // A genuinely saved zero-total report is retained only when this
  // company has at least one Owner-published, mapped SKU.
  const visibleLines=source.lines.filter(l=>
   allowed.has(key(source.companyId,l.productId)));
  const sums=new Map();
  for(const line of visibleLines)
   sums.set(line.recordId,(sums.get(line.recordId)||0)+line.count);
  const records=source.records
   .filter(r=>enabled&&(r.totalCount===0||(sums.get(r.sourceId)||0)>0))
   .map(r=>({...r,totalCount:sums.get(r.sourceId)||0}));
  const visibleRecords=new Set(records.map(r=>r.sourceId));
  const lines=visibleLines.filter(l=>visibleRecords.has(l.recordId));
  return {...source,lines,products:enabledProducts,records};
 });
 const productGroups=input.productGroups.filter(g=>allowed.has(key(g.companyId,g.productId)));
 const unassigned=(input.unassigned||[]).filter(x=>allowed.has(key(x.companyId,x.productId)));
 // Personal bests from ALL products cannot be compared with an ON-only score.
 // Current count-only goals may remain; historical sales and rank data do not change.
 const result=buildVerifiedCountDashboard({
  ...input,sources,productGroups,unassigned,historicalBest:[]
 });
 auditNoFinancialKeys(result);
 return result;
}
