/**
 * Zero-setup, count-only link for the EXISTING canonical partner ledger.
 *
 * No new Owner SKU setup, extra switch, price, Firestore write, membership
 * changes or client-supplied product lookup. An EXISTING server-verified,
 * Owner-reviewed exact ID binding takes precedence over automatic aliases.
 * The caller MUST provide complete, server-authorized, same-snapshot sources.
 *
 * A verified unique hub-product LABEL or a tightly specified legacy alias is
 * the only way to merge companies into a hub product. If it is ambiguous or
 * unknown, the partner's ORIGINAL category is published as a separate group,
 * never dropped, guessed, or added to a different sale.
 */
import {PARTNER_RANK_SKUS} from "./partner-workspace-count-source.mjs";
import {createHash} from "node:crypto";
import {auditNoFinancialKeys} from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const PRIVATE=/^partnerPrivate:([A-Za-z0-9_-]{1,128})$/;
const TIME=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const LEGACY_COMBINED_LIGHT_AIR=/(?:^|[\s（(])(?:SB|ソフトバンク)?光\s*[/／・]\s*(?:AIR|エアー)(?=$|[\s）)（(])/i;
const LEGACY_COMBINED_TSUBASA_HTB=/(?:^|[\s（(])(?:つばさ|翼)\s*[/／・]\s*HTB(?=$|[\s）)（(])/i;
const BAD=/(?:売上|単価|収益|原価|価格|キャッシュバック|報酬|利益|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９,.，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
const stop=()=>{throw Error("ZERO_SETUP_COUNT_SOURCE_UNVERIFIED");};
const valid=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const label=x=>typeof x==="string"&&x.trim()&&x.length<=80&&
 !BAD.test(x.normalize("NFKC"));
const norm=x=>x.normalize("NFKC").trim().toLowerCase().replace(/[\s　]+/g,"");
const COMBINED_ALIASES=new Set(["SB光・AIR","SB光・AIR（旧合算・未分類）",
 "光/AIR","光・Air","SB光/AIR","ソフトバンク光/Air"].map(norm));
const contract=new Map(PARTNER_RANK_SKUS.map(p=>[p.id,p.name]));
if(contract.size!==9||!COMBINED_ALIASES.has(norm(contract.get("partnerSku05")??"")))stop();

export function linkAllRegisteredCountsWithoutSetup({
 hubCompanyId,hubSource,partnerSources,reviewedBindings=[]
}={}){
 if(!valid(hubCompanyId)||!hubSource||
    hubSource.companyId!==hubCompanyId||hubSource.kind!=="own"||
    hubSource.consentVerified!==true||hubSource.isComplete!==true||
    !TIME.test(hubSource.readTime||"")||
    !Array.isArray(hubSource.products)||hubSource.products.length>1000||
    !Array.isArray(partnerSources)||partnerSources.length>30||
    !Array.isArray(reviewedBindings)||reviewedBindings.length>1000)stop();
 const own=new Map(),combinedMatches=[],byExactName=new Map();
 const result=[];
 for(const p of hubSource.products){
  if(!p||p.companyId!==hubCompanyId||!valid(p.sourceId)||
     !label(p.name)||own.has(p.sourceId)||typeof p.active!=="boolean")stop();
  own.set(p.sourceId,p);
  if(COMBINED_ALIASES.has(norm(p.name)))combinedMatches.push(p);
  const exactName=p.name.trim();
  const exactMatches=byExactName.get(exactName)||[];
  exactMatches.push(p);byExactName.set(exactName,exactMatches);
  result.push({
   companyId:hubCompanyId,productId:p.sourceId,
   groupId:p.sourceId,groupName:p.name
  });
 }
 // Only canonical server reads may supply these Owner-reviewed ID bindings.
 // Historic partnerPrivate:<id> is valid ONLY when that private product is
 // present in the same snapshot; never invent IDs or mutate saved entries.
 // Reject stale partner IDs, missing products, duplicate source/target bindings
 // and any attempt to split the old combined light/AIR category.
 const partnerIds=new Set(partnerSources.map(p=>p?.companyId));
 if(partnerIds.size!==partnerSources.length)stop();
 // A stored Owner mapping stays auditable when that Owner turns a product
 // OFF. Hold only that source unmatched; other ON rankings must keep working.
 const reviewedByCompany=new Map(),reservedByCompany=new Map(),
  boundIdsByCompany=new Map(),offBoundIdsByCompany=new Map();
 for(const b of reviewedBindings){
  if(!b||Object.keys(b).sort().join("|")!=="companyId|hubProductId|productId"||
     !valid(b.companyId)||!partnerIds.has(b.companyId)||
     !(contract.has(b.productId)||PRIVATE.test(b.productId))||
     !valid(b.hubProductId)||
     !own.has(b.hubProductId))stop();
  const target=own.get(b.hubProductId);
  const sourceCompany=partnerSources.find(p=>p?.companyId===b.companyId);
  const origin=Array.isArray(sourceCompany?.products)?
   sourceCompany.products.find(p=>p?.sourceId===b.productId):null;
  if(!origin||typeof origin.name!=="string")stop();
  // Both the immutable legacy source ID and an archived private combined
  // label must remain combined. Never accept generic "旧合算"/"未分類"
  // in an unrelated target such as NURO or solar.
  const oldCombined=b.productId==="partnerSku05"||
   (PRIVATE.test(b.productId)&&
    LEGACY_COMBINED_LIGHT_AIR.test(origin.name.normalize("NFKC")));
  if(oldCombined&&
     !LEGACY_COMBINED_LIGHT_AIR.test(target.name.normalize("NFKC")))stop();
  if((b.productId==="partnerSku07"||LEGACY_COMBINED_TSUBASA_HTB.test(origin.name.normalize("NFKC")))&&
     !LEGACY_COMBINED_TSUBASA_HTB.test(target.name.normalize("NFKC")))stop();
  const seen=boundIdsByCompany.get(b.companyId)||new Set();
  const reserved=reservedByCompany.get(b.companyId)||new Set();
  if(seen.has(b.productId)||reserved.has(b.hubProductId))stop();
  seen.add(b.productId);reserved.add(b.hubProductId);
  boundIdsByCompany.set(b.companyId,seen);
  reservedByCompany.set(b.companyId,reserved);
  if(target.active!==true){
   // Never auto-redirect an OFF reviewed source to a different ON SKU.
   const held=offBoundIdsByCompany.get(b.companyId)||new Set();
   held.add(b.productId);offBoundIdsByCompany.set(b.companyId,held);
   continue;
  }
  const accepted=reviewedByCompany.get(b.companyId)||new Map();
  accepted.set(b.productId,target);
  reviewedByCompany.set(b.companyId,accepted);
 }
 const seenCompanies=new Set();
 for(const partner of partnerSources){
  if(!partner||!valid(partner.companyId)||
     partner.companyId===hubCompanyId||
     seenCompanies.has(partner.companyId)||partner.kind!=="partner"||
     partner.consentVerified!==true||partner.isComplete!==true||
     partner.readTime!==hubSource.readTime||
     !Array.isArray(partner.products)||
     partner.products.length<contract.size||
     partner.products.length>contract.size+100)stop();
  seenCompanies.add(partner.companyId);
  const reviewed=reviewedByCompany.get(partner.companyId)||new Map();
  const offBound=offBoundIdsByCompany.get(partner.companyId)||new Set();
  const originallyBound=boundIdsByCompany.get(partner.companyId)||new Set();
  const seenProducts=new Set(),mappedHub=new Set(
   reservedByCompany.get(partner.companyId)||[]);
  const privateNameCounts=new Map();
  for(const p of partner.products){
   if(!p||!PRIVATE.test(p.sourceId)||!label(p.name))continue;
   const name=p.name.trim();
   privateNameCounts.set(name,(privateNameCounts.get(name)||0)+1);
  }
  // Built-in categories retain their established source IDs and take priority
  // over an unreviewed private candidate for the same target.
  const ordered=[...partner.products.filter(p=>contract.has(p?.sourceId)),
   ...partner.products.filter(p=>!contract.has(p?.sourceId))];
  for(const p of ordered){
   if(!p||p.companyId!==partner.companyId||
      !valid(p.sourceId)||!label(p.name)||
      typeof p.active!=="boolean"||seenProducts.has(p.sourceId))stop();
   const isOriginal=contract.has(p.sourceId);
   const isPrivate=PRIVATE.test(p.sourceId);
   if(!isOriginal&&!isPrivate)stop();
   // Historic private products can now be inactive without losing counts.
   if(isOriginal&&(p.active!==true||p.name!==contract.get(p.sourceId)))stop();
   seenProducts.add(p.sourceId);
   // The fixed light/AIR combined label is the only alias exception.
   const name=p.name.trim();
   const possible=p.sourceId==="partnerSku05"?combinedMatches:byExactName.get(name)||[];
   const exactTarget=possible.length===1&&possible[0].active===true&&
    (!isPrivate||privateNameCounts.get(name)===1)?possible[0]:null;
   // Reviewed owner IDs always win, even when an unrelated category also
   // has a matching alias. That automatic candidate must remain separate.
   const reviewedTarget=reviewed.get(p.sourceId)||null;
   let target=offBound.has(p.sourceId)?null:reviewedTarget||exactTarget;
   // Old SB光・AIR does not identify a separately sold Hikari or Air SKU.
   if((p.sourceId==="partnerSku05"||
       (isPrivate&&LEGACY_COMBINED_LIGHT_AIR.test(name.normalize("NFKC"))))&&
      target&&!LEGACY_COMBINED_LIGHT_AIR.test(target.name.normalize("NFKC")))
     target=null;
   if((p.sourceId==="partnerSku07"||
       (isPrivate&&LEGACY_COMBINED_TSUBASA_HTB.test(name.normalize("NFKC"))))&&
      target&&!LEGACY_COMBINED_TSUBASA_HTB.test(target.name.normalize("NFKC")))target=null;
   // One hub SKU cannot be claimed by two categories in the SAME company.
   // Pre-reserving reviewed IDs prevents an alias from stealing an Owner map.
   if(!reviewedTarget&&target&&mappedHub.has(target.sourceId))target=null;
   if(target)mappedHub.add(target.sourceId);
   const unmatched=isPrivate?
    "partnerPrivateUnmatched:"+createHash("sha256").update(
     partner.companyId+"\n"+p.sourceId).digest("hex").slice(0,32):
    "partnerUnmatched:"+p.sourceId;
   if(own.has(unmatched))stop();
   result.push({
    companyId:partner.companyId,productId:p.sourceId,
    groupId:target?.sourceId||unmatched,
    groupName:target?.name||p.name
   });
  }
  if([...contract.keys()].some(id=>!seenProducts.has(id))||
     [...originallyBound].some(id=>!seenProducts.has(id)))stop();
 }
 // All registered partner categories remain present in the result even
 // when there is no safe cross-company matching hub product.
 auditNoFinancialKeys(result);
 return Object.freeze(result.map(x=>Object.freeze(x)));
}
