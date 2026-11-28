/**
 * STAGING ONLY / NO DEPLOY.
 * Convert the EXISTING partnerWorkEntries + partnerWorkCountDays ledgers into
 * an approved public-count shape usable by buildCombinedCountLeaderboard().
 * This module never queries Firebase and never copies money/private products.
 * A trusted backend MUST supply complete, snapshot-consistent data and proof;
 * client-provided proof is not authorization.
 */
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";
const require=createRequire(import.meta.url);
const {KEYS}=require("../functions-partner-workspace/service.cjs");
const CATEGORY_CONTRACT=Object.freeze([
 "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_PRIVATE=100;
const PRIVATE_ID_PREFIX="partnerPrivate:";
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONEY=/(?:単価|売上|利益|報酬|キャッシュバック|[￥¥$€]|(?:CB|revenue|cashback|unitPrice)\s*[:=_-]?\s*[0-9０-９]|[0-9０-９][\d０-９,，.]*\s*(?:万円|千円|円))/i;
const stop=()=>{throw Error("PARTNER_RANK_SOURCE_INCOMPLETE_OR_UNVERIFIED");};
const id=v=>typeof v==="string"&&ID.test(v);
const validDay=v=>{
 if(typeof v!=="string"||!DATE.test(v))return false;
 const [y,m,d]=v.split("-").map(Number),dt=new Date(0);
 dt.setUTCHours(0,0,0,0);dt.setUTCFullYear(y,m-1,d);
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()+1===m&&dt.getUTCDate()===d;
};
function label(s) {
 if(typeof s!=="string"||!s.trim()||s.length>80||MONEY.test(s))stop();
 return s.replace(/[\r\n\t]/g," ").trim();
}
function safeNumber(n,max=Number.MAX_SAFE_INTEGER){
 if(typeof n!=="number"||!Number.isSafeInteger(n)||n<0||n>max)stop();
 return n;
}
function countObject(value,max){
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join("|")!==[...CATEGORY_CONTRACT].sort().join("|"))stop();
 const counts={};let total=0;
 for(const category of CATEGORY_CONTRACT){
  const n=safeNumber(value[category],max);
  total+=n;if(!Number.isSafeInteger(total))stop();
  counts[category]=n;
 }
 return {counts,total};
}
const skus=Object.freeze(CATEGORY_CONTRACT.map((name,i)=>Object.freeze({
 id:"partnerSku"+String(i+1).padStart(2,"0"),
 // Old combined totals must NEVER be guessed as either hikari or Air.
 name:name==="SB光・AIR"?"SB光・AIR（旧合算・未分類）":name
})));
export const PARTNER_RANK_SKUS=skus;
const ownerId=x=>typeof x==="string"&&/^[A-Za-z0-9_:-]{1,200}$/.test(x)&&
 !["__proto__","constructor","prototype"].includes(x)&&
 !x.startsWith("legacyPartnerSku:")&&!x.startsWith("partnerPrivate:");
export function individualOwnerSourceId(productId){
 if(!ownerId(productId))stop();
 return "ownerProduct:"+createHash("sha256").update(productId).digest("hex");
}
const hasIndividual=x=>Object.hasOwn(x,"ownerProductCounts")||
 Object.hasOwn(x,"ownerProductTotalCount");
function individualCounts(x,catalog,limit,maxKeys){
 const result=new Map();let total=0;
 if(!hasIndividual(x))return {counts:result,total};
 if(!catalog||!x.ownerProductCounts||typeof x.ownerProductCounts!=="object"||
    Array.isArray(x.ownerProductCounts)||
    Object.keys(x.ownerProductCounts).length>maxKeys)stop();
 for(const [sku,n] of Object.entries(x.ownerProductCounts)){
  if(!ownerId(sku)||!catalog.has(sku))stop();
  const count=safeNumber(n,limit);
  total+=count;if(!Number.isSafeInteger(total))stop();
  result.set(sku,count);
 }
 if(total!==x.ownerProductTotalCount)stop();
 return {counts:result,total};
}

/**
 * entries[] are stored partnerWorkEntries documents including original id.
 * summaries[] are stored, dated partnerWorkCountDays/{day}/reports/{cid}.
 * teams[] must include historical teams and is verified by trusted server.
 * proof is a server-assembled precondition, NOT a browser authorization input.
 */
export function buildPartnerCountRankingSource({
 hubCompanyId,partnerCompanyId,companyLabel,period,readTime,
 relation,proof,teams,entries,summaries,
 // The old 9-SKU reader remains compatible. Only the zero-setup GET opts
 // in once the entire private catalog is read in the same authorized tx.
 privateProducts,includePrivateCounts=false,individualPublicCatalog
}={}){
 if(KEYS.join("|")!==CATEGORY_CONTRACT.join("|")||
   !id(hubCompanyId)||!id(partnerCompanyId)||hubCompanyId===partnerCompanyId||
   !MONTH.test(period||"")||typeof readTime!=="string"||
   !relation||relation.hubCompanyId!==hubCompanyId||
   relation.partnerCompanyId!==partnerCompanyId||
   relation.active!==true||relation.countSharingApproved!==true||
   !proof||proof.serverVerified!==true||
   (proof.countSharingVerified!==true&&proof.reciprocalOwnersApproved!==true)||
   proof.completeMonthEntriesRead!==true||
   proof.completeMonthSummariesRead!==true||
   proof.historicalTeamsVerified!==true||
   proof.snapshotConsistent!==true||
   !Array.isArray(teams)||!Array.isArray(entries)||!Array.isArray(summaries)||
   teams.length>10000||entries.length>100000||summaries.length>31||
   typeof includePrivateCounts!=="boolean"||
   (includePrivateCounts&&(
    proof.completePrivateProductCatalogueRead!==true||
    !Array.isArray(privateProducts)||privateProducts.length>MAX_PRIVATE
   )))stop();
 const company=label(companyLabel);
 let individualCatalog=null;
 if(individualPublicCatalog!==undefined){
  if(proof.completeIndividualCatalogRead!==true||
     individualPublicCatalog?.schema!=="nico-reviewed-count-public-catalog-v1"||
     individualPublicCatalog.hubCompanyId!==hubCompanyId||
     !Array.isArray(individualPublicCatalog.products)||
     individualPublicCatalog.products.length>1000)stop();
  individualCatalog=new Map();
  for(const p of individualPublicCatalog.products){
   if(!p||Object.keys(p).sort().join("|")!=="active|companyId|id|name"||
      p.companyId!==hubCompanyId||typeof p.active!=="boolean"||
      typeof p.id!=="string"||!/^[-A-Za-z0-9_:]{1,200}$/.test(p.id)||
      ["__proto__","constructor","prototype"].includes(p.id))stop();
   if(individualCatalog.has(p.id))stop();
   individualCatalog.set(p.id,{name:label(p.name),active:p.active});
  }
 }
 const usedIndividual=new Set();
 const knownPrivate=new Map();
 if(includePrivateCounts){
  for(const p of privateProducts){
   if(!p||!id(p.id)||p.companyId!==partnerCompanyId||
      p.origin!=="partner_custom"||p.visibility!=="private"||
      typeof p.active!=="boolean"||knownPrivate.has(p.id))stop();
   const name=label(p.name); // No financial names in count-only results.
   knownPrivate.set(p.id,{name,active:p.active});
  }
 }
 const teamMap=new Map();
 for(const t of teams){
  if(!t||!id(t.id)||teamMap.has(t.id))stop();
  const goal=t.goalCount==null?null:safeNumber(t.goalCount);
  teamMap.set(t.id,{id:t.id,name:label(t.name),goalCount:goal});
 }
 const daily=new Map(),seenEntries=new Set();
 const records=[],lines=[];
 const privateOrder=[...knownPrivate.keys()].sort((a,b)=>a.localeCompare(b,"en"));
 const privateOrdinal=new Map(privateOrder.map((id,i)=>[id,i]));
 for(const e of entries){
  if(!e||e.companyId!==partnerCompanyId||e.hubCompanyId!==hubCompanyId||
    !validDay(e.date)||e.date.slice(0,7)!==period||
    !id(e.staffId)||!id(e.teamIdSnapshot)||
    !teamMap.has(e.teamIdSnapshot)||
    !Number.isSafeInteger(e.version)||e.version<1||e.version>999)stop();
  const key=e.date+"__"+e.staffId;
  if((e.id!==undefined&&e.id!==key)||seenEntries.has(key))stop();
  seenEntries.add(key);
  const {counts,total}=countObject(e.counts,9999);
  if(e.totalCount!==total)stop();
  let privateTotal=0;
  const privateCountRows=[];
  if(includePrivateCounts){
   const raw=e.privateCounts??{};
   if(!raw||typeof raw!=="object"||Array.isArray(raw)||
      Object.keys(raw).length>MAX_PRIVATE)stop();
   for(const [originalId,n] of Object.entries(raw)){
    if(!id(originalId)||!knownPrivate.has(originalId))stop();
    privateTotal+=safeNumber(n,9999);
    if(!Number.isSafeInteger(privateTotal))stop();
    if(n>0)privateCountRows.push({originalId,count:n});
   }
   if((e.privateTotalCount??0)!==privateTotal)stop();
  }
  const individual=individualCounts(e,individualCatalog,9999,200);
  const completeTotal=total+privateTotal+individual.total;
  if(!Number.isSafeInteger(completeTotal))stop();
  const display= e.staffNameSnapshot==null?"担当者":label(e.staffNameSnapshot);
  records.push({
   companyId:partnerCompanyId,sourceId:key,uid:e.staffId,date:e.date,
   teamId:e.teamIdSnapshot,totalCount:completeTotal,
   reportStatus:completeTotal===0?"no_result":"submitted",
   memberNameSnapshot:display,teamNameSnapshot:teamMap.get(e.teamIdSnapshot).name,
   workLocation:""
  });
  if(!daily.has(e.date))daily.set(e.date,{counts:Object.fromEntries(
    CATEGORY_CONTRACT.map(k=>[k,0])),total:0,individual:new Map()});
  const aggregate=daily.get(e.date);
  for(let i=0;i<skus.length;i++){
   const n=counts[CATEGORY_CONTRACT[i]];
   aggregate.counts[CATEGORY_CONTRACT[i]]+=n;
   if(!Number.isSafeInteger(aggregate.counts[CATEGORY_CONTRACT[i]]))stop();
   if(n>0)lines.push({
    companyId:partnerCompanyId,recordId:key,
    sourceId:key+"__"+String(i).padStart(4,"0"),
    date:e.date,uid:e.staffId,teamId:e.teamIdSnapshot,
    productId:skus[i].id,count:n
   });
  }
  // Each historical private count belongs to the same record, exactly once.
  // partnerWorkCountDays summaries contain ONLY the old nine categories.
  for(const {originalId,count:n} of privateCountRows)lines.push({
   companyId:partnerCompanyId,recordId:key,
   sourceId:key+"__p"+String(privateOrdinal.get(originalId)).padStart(4,"0"),
   date:e.date,uid:e.staffId,teamId:e.teamIdSnapshot,
   productId:PRIVATE_ID_PREFIX+originalId,count:n
  });
  const orderedIndividual=[...individual.counts.keys()].sort();
  for(const [ordinal,sku] of orderedIndividual.entries()){
   const count=individual.counts.get(sku);
   usedIndividual.add(sku);
   const newTotal=(aggregate.individual.get(sku)??0)+count;
   if(!Number.isSafeInteger(newTotal))stop();
   aggregate.individual.set(sku,newTotal);
   const productId=individualOwnerSourceId(sku);
   if(count>0)lines.push({
    companyId:partnerCompanyId,recordId:key,
    sourceId:key+"__i"+String(ordinal).padStart(4,"0"),
    date:e.date,uid:e.staffId,teamId:e.teamIdSnapshot,productId,count
   });
  }
  aggregate.total+=total;if(!Number.isSafeInteger(aggregate.total))stop();
 }
 const seenDays=new Set();
 for(const s of summaries){
  if(!s||s.source!=="staff-entries-v1"||
    s.hubCompanyId!==hubCompanyId||s.partnerCompanyId!==partnerCompanyId||
    !validDay(s.date)||s.date.slice(0,7)!==period||
    seenDays.has(s.date))stop();
  seenDays.add(s.date);
  const real=countObject(s.counts,Number.MAX_SAFE_INTEGER);
  const expected=daily.get(s.date);
  if(!expected||real.total!==s.totalCount||real.total!==expected.total||
     CATEGORY_CONTRACT.some(k=>real.counts[k]!==expected.counts[k]))stop();
  const individual=individualCounts(s,individualCatalog,Number.MAX_SAFE_INTEGER,1000);
  if(individual.counts.size!==expected.individual.size||
     [...expected.individual].some(([sku,n])=>individual.counts.get(sku)!==n))stop();
 }
 if(seenDays.size!==daily.size)stop();
 const products=skus.map(s=>({
  companyId:partnerCompanyId,sourceId:s.id,name:s.name,active:true,sortOrder:0
 }));
 if(includePrivateCounts)for(const [originalId,item] of knownPrivate){
  products.push({companyId:partnerCompanyId,
   sourceId:PRIVATE_ID_PREFIX+originalId,name:item.name,
   active:item.active,sortOrder:0});
 }
 for(const sku of [...usedIndividual].sort()){
  const item=individualCatalog.get(sku);
  products.push({companyId:partnerCompanyId,sourceId:individualOwnerSourceId(sku),
   name:item.name,active:item.active,sortOrder:0});
 }
 assertPublicSchema("publicRecords",records);
 assertPublicSchema("publicRecordLines",lines);
 assertPublicSchema("publicProducts",products);
 const result={
  companyId:partnerCompanyId,companyLabel:company,kind:"partner",
  consentVerified:true,isComplete:true,readTime,
  teams:[...teamMap.values()],records,lines,products
 };
 auditNoFinancialKeys(result);
 return result;
}
