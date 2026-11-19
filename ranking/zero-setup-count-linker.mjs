/**
 * Zero-setup, count-only link for the EXISTING canonical partner ledger.
 *
 * No Owner SKU mapping document, extra switch, price, Firestore write,
 * membership changes or client-supplied product lookup.
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
const BAD=/(?:売上|単価|収益|原価|価格|キャッシュバック|報酬|利益|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９,.，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
const stop=()=>{throw Error("ZERO_SETUP_COUNT_SOURCE_UNVERIFIED");};
const valid=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const label=x=>typeof x==="string"&&x.trim()&&x.length<=80&&
 !BAD.test(x.normalize("NFKC"));
const norm=x=>x.normalize("NFKC").trim().toLowerCase().replace(/[\s　]+/g,"");
const ALIASES=Object.freeze({
 partnerSku01:["NURO","NURO光"],
 partnerSku02:["SBMNP","SoftBank MNP","ソフトバンクMNP"],
 partnerSku03:["YMMNP","Y!mobile MNP","ワイモバイルMNP"],
 partnerSku04:["YM純新規","ワイモバイル純新規"],
 partnerSku05:["SB光・AIR","SB光・AIR（旧合算・未分類）",
  "光/AIR","光・Air","SB光/AIR","ソフトバンク光/Air"],
 partnerSku06:["ウォーター"],
 partnerSku07:["つばさ・HTB"],
 partnerSku08:["太陽光・蓄電池AP"],
 partnerSku09:["U-NEXT"]
});
const contract=new Map(PARTNER_RANK_SKUS.map(p=>[p.id,p.name]));
const aliases=new Map(Object.entries(ALIASES).map(([id,names])=>[
 id,new Set(names.map(norm))
]));
if(contract.size!==9||[...contract.keys()].some(id=>!aliases.has(id)))stop();

export function linkAllRegisteredCountsWithoutSetup({
 hubCompanyId,hubSource,partnerSources
}={}){
 if(!valid(hubCompanyId)||!hubSource||
    hubSource.companyId!==hubCompanyId||hubSource.kind!=="own"||
    hubSource.consentVerified!==true||hubSource.isComplete!==true||
    !TIME.test(hubSource.readTime||"")||
    !Array.isArray(hubSource.products)||hubSource.products.length>1000||
    !Array.isArray(partnerSources)||partnerSources.length>30)stop();
 const own=new Map(),byName=new Map();
 const result=[];
 for(const p of hubSource.products){
  if(!p||p.companyId!==hubCompanyId||!valid(p.sourceId)||
     !label(p.name)||own.has(p.sourceId)||typeof p.active!=="boolean")stop();
  own.set(p.sourceId,p);
  const key=norm(p.name);
  const matches=byName.get(key)||[];
  matches.push(p);byName.set(key,matches);
  result.push({
   companyId:hubCompanyId,productId:p.sourceId,
   groupId:p.sourceId,groupName:p.name
  });
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
  const seenProducts=new Set(),mappedHub=new Set();
  for(const p of partner.products){
   if(!p||p.companyId!==partner.companyId||
      !valid(p.sourceId)||!label(p.name)||
      typeof p.active!=="boolean"||seenProducts.has(p.sourceId))stop();
   const isOriginal=contract.has(p.sourceId);
   const isPrivate=PRIVATE.test(p.sourceId);
   if(!isOriginal&&!isPrivate)stop();
   // Historic private products can now be inactive without losing counts.
   if(isOriginal&&(p.active!==true||
      norm(p.name)!==norm(contract.get(p.sourceId))))stop();
   seenProducts.add(p.sourceId);
   // Standard categories keep reviewed exact aliases; previously private
   // products may match ONLY a uniquely named active hub product.
   const possible=new Map();
   if(isOriginal){
    for(const alias of aliases.get(p.sourceId)){
     for(const candidate of byName.get(alias)||[])
      if(candidate.active===true)possible.set(candidate.sourceId,candidate);
    }
   }else for(const candidate of byName.get(norm(p.name))||[])
    if(candidate.active===true)possible.set(candidate.sourceId,candidate);
   let target=possible.size===1?[...possible.values()][0]:null;
   // Old SB光・AIR does not identify a separately sold Hikari or Air SKU.
   if(p.sourceId==="partnerSku05"&&target&&
      !aliases.get("partnerSku05").has(norm(target.name)))target=null;
   // One hub SKU cannot be claimed by two categories in the SAME company.
   if(target&&mappedHub.has(target.sourceId))target=null;
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
  if([...contract.keys()].some(id=>!seenProducts.has(id)))stop();
 }
 // All registered partner categories remain present in the result even
 // when there is no safe cross-company matching hub product.
 auditNoFinancialKeys(result);
 return Object.freeze(result.map(x=>Object.freeze(x)));
}
