/**
 * STAGING ONLY / NO DEPLOY. Connect the existing canonical internal and
 * partner monthly count readers to the owner product ON/OFF ranking engine.
 *
 * All reads use the caller's ONE read-only Firestore transaction. Partner
 * product -> hub product correspondences require separate, current owner
 * approval by EXACT IDs. No browser-provided mapping, name matching or
 * automatic decomposition of legacy "SB光・AIR" counts is permitted.
 *
 * The existing 9 historical partner categories (including partnerSku05)
 * remain untouched. partnerSku05 is explicitly unclassified until the
 * owner-approved next-month migration; it must never contribute to
 * independent hikari/Air rankings by estimation.
 */
import {createInternalMonthTransactionReader}
 from "./internal-month-count-tx-reader.mjs";
import {createPartnerMonthTransactionReader}
 from "./partner-month-readonly-loader.mjs";
import {PARTNER_RANK_SKUS} from "./partner-workspace-count-source.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_PARTNERS=29,LEGACY_COMBINED_SKU="partnerSku05";
const stop=()=>{throw Error("CANONICAL_OWNER_JOINT_MONTH_UNVERIFIED");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const read=s=>s?.exists===true&&typeof s.data==="function"?s.data():stop();
const uniq=a=>Array.isArray(a)&&new Set(a).size===a.length;
const exactTime=s=>{
 const t=s?.readTime;
 if(!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds)||
    t.nanoseconds<0||t.nanoseconds>=1000000000||
    typeof t.toDate!=="function")stop();
 const d=t.toDate();
 if(!(d instanceof Date)||!Number.isFinite(d.getTime()))stop();
 return {key:t.seconds+":"+t.nanoseconds,iso:d.toISOString()};
};
const isDate=s=>{
 if(typeof s!=="string"||!DATE.test(s))return false;
 const [y,m,d]=s.split("-").map(Number),dt=new Date(0);
 dt.setUTCHours(0,0,0,0);dt.setUTCFullYear(y,m-1,d);
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()+1===m&&dt.getUTCDate()===d;
};
function currentTokyoDay(){
 const d=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const y=d.find(x=>x.type==="year")?.value;
 const m=d.find(x=>x.type==="month")?.value;
 const day=d.find(x=>x.type==="day")?.value;
 return y+"-"+m+"-"+day;
}
function lastDay(month){
 const [year,m]=month.split("-").map(Number);
 return month+"-"+String(new Date(Date.UTC(year,m,0)).getUTCDate())
  .padStart(2,"0");
}
function validatedMonthDay(month,today){
 if(!MONTH.test(month||"")||!isDate(today))stop();
 if(month>today.slice(0,7))stop();
 return month===today.slice(0,7)?today:lastDay(month);
}
function idsMatch(a,b){
 return uniq(a)&&uniq(b)&&a.length===b.length&&a.every(x=>id(x)&&b.includes(x));
}
function label(value){
 // No raw financial names, aliases or amounts may enter ranking responses.
 if(typeof value!=="string"||!value.trim()||value.length>80||
    /(?:売上|単価|利益|報酬|キャッシュバック|[¥￥$€]|(?:CB|revenue|cashback|unitPrice)[\s:=-]*[0-9０-９]|[0-9０-９][0-9０-９,.，]*\s*(?:円|万円))/i.test(value))stop();
 return value.trim();
}

/** Pure composition, with owner-approved exact canonical mappings. */
export function combineVerifiedOwnerMonth({
 month,asOf,context,hubSource,partnerSources,mappingDocuments
}={}){
 if(!MONTH.test(month||"")||!isDate(asOf)||
    asOf.slice(0,7)!==month||
    !context||context.serverVerified!==true||
    !id(context.hubCompanyId)||!Array.isArray(context.approvedCompanyIds)||
    context.approvedCompanyIds.length<1||
    context.approvedCompanyIds.length>MAX_PARTNERS+1||
    !context.approvedCompanyIds.includes(context.hubCompanyId)||
    !idsMatch(context.approvedCompanyIds,[
      context.hubCompanyId,...(partnerSources||[]).map(x=>x?.companyId)
    ])||!hubSource||hubSource.companyId!==context.hubCompanyId||
    hubSource.kind!=="own"||
    !Array.isArray(hubSource.products)||!Array.isArray(hubSource.lines)||
    !Array.isArray(partnerSources)||!Array.isArray(mappingDocuments)||
    partnerSources.length!==mappingDocuments.length)stop();

 const hubSku=new Map();
 for(const p of hubSource.products){
  if(p.companyId!==context.hubCompanyId||!id(p.sourceId)||
     hubSku.has(p.sourceId))stop();
  hubSku.set(p.sourceId,label(p.name));
 }
 const allSources=[hubSource],productGroups=[...hubSku].map(([key,name])=>({
  companyId:context.hubCompanyId,productId:key,groupId:key,groupName:name
 }));
 const masterSkus=new Set(PARTNER_RANK_SKUS.map(x=>x.id));
 const groups=new Set([context.hubCompanyId]);
 for(const partner of partnerSources){
  if(!id(partner?.companyId)||groups.has(partner.companyId)||
     !context.approvedCompanyIds.includes(partner.companyId)||
     partner.kind!=="partner"||!Array.isArray(partner.records)||
     !Array.isArray(partner.lines)||!Array.isArray(partner.products)||
     !Array.isArray(partner.teams)||!Array.isArray(partner.roster)&&
      partner.roster!=null)stop();
  groups.add(partner.companyId);
  const mapDoc=mappingDocuments.find(m=>m?.partnerCompanyId===partner.companyId);
  if(!mapDoc||mapDoc.hubCompanyId!==context.hubCompanyId||
     mapDoc.ownerReviewed!==true||mapDoc.active!==true||
     !Number.isSafeInteger(mapDoc.version)||mapDoc.version<1||
     !Array.isArray(mapDoc.links)||mapDoc.links.length>masterSkus.size)
    stop();
  const known=new Set(),sourceProducts=new Map();
  for(const p of partner.products){
   if(p.companyId!==partner.companyId||!id(p.sourceId)||
      !masterSkus.has(p.sourceId)||sourceProducts.has(p.sourceId))stop();
   sourceProducts.set(p.sourceId,p);
  }
  for(const item of mapDoc.links){
   if(!item||!id(item.partnerProductId)||!id(item.hubProductId)||
      item.partnerProductId===LEGACY_COMBINED_SKU||
      !sourceProducts.has(item.partnerProductId)||
      !hubSku.has(item.hubProductId)||
      known.has(item.partnerProductId))stop();
   known.add(item.partnerProductId);
   productGroups.push({companyId:partner.companyId,
    productId:item.partnerProductId,groupId:item.hubProductId,
    groupName:hubSku.get(item.hubProductId)});
  }
  // An unmapped positive category could make the combined ranking falsely
  // incomplete. The deferred legacy hikari/Air category is the ONLY
  // exception; its original counts remain, but never join either ranking.
  for(const line of partner.lines){
   if(!sourceProducts.has(line?.productId)||
      !Number.isSafeInteger(line.count)||line.count<0)stop();
   if(line.count>0&&!known.has(line.productId)&&
      line.productId!==LEGACY_COMBINED_SKU)stop();
  }
  const teamIds=new Set(partner.teams.map(x=>x.id)),roster=new Map();
  for(const line of partner.records){
   if(!id(line.uid)||!id(line.teamId)||!teamIds.has(line.teamId))stop();
   if(!roster.has(line.uid))roster.set(line.uid,{
    uid:line.uid,teamId:line.teamId,
    name:label(line.memberNameSnapshot||"担当者")});
  }
  allSources.push({
   ...partner,
   completeWindows:{current:true,previous:false},
   roster:[...roster.values()]
  });
 }
 const readTimes=new Set(allSources.map(x=>x.readTime));
 if(readTimes.size!==1||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(hubSource.readTime))
  stop();
 return {
  context,hubCompanyId:context.hubCompanyId,
  approvedCompanyIds:[...context.approvedCompanyIds],
  sources:allSources,productGroups,
  mappingsReviewed:true,snapshotReadTime:hubSource.readTime,
  period:{kind:"month",day:month+"-01",asOf}
 };
}

/**
 * Staging backend read adapter; no callable registration or production write.
 * Mapping docs must be independently signed by current hub owner, in addition
 * to the reciprocal ranking consents verified by partner reader/context.
 */
export function createCanonicalOwnerJointMonthReader({
 db,clock=currentTokyoDay,
 internalReader=null,partnerReader=null
}={}){
 if(!db||typeof db.collection!=="function"||
    typeof clock!=="function")stop();
 const internal=internalReader||createInternalMonthTransactionReader({db});
 const partner=partnerReader||createPartnerMonthTransactionReader({db});
 if(typeof internal!=="function"||typeof partner!=="function")stop();
 return async function loadCountsInTransaction({tx,month,context}={}){
  if(!tx||typeof tx.get!=="function"||
     !context||context.serverVerified!==true||
     !id(context.hubCompanyId)||!Array.isArray(context.approvedCompanyIds)||
     !idsMatch(context.approvedCompanyIds,context.approvedCompanyIds)||
     context.approvedCompanyIds.length>MAX_PARTNERS+1)stop();
  const asOf=validatedMonthDay(month,clock());
  const hub=context.hubCompanyId;
  const partners=context.approvedCompanyIds.filter(x=>x!==hub);
  const company=db.collection("companies").doc(hub);
  const [hubCompany,hubSource,...sources]=await Promise.all([
   tx.get(company),
   internal({tx,hubCompanyId:hub,month,context}),
   ...partners.map(partnerCompanyId=>partner({tx,hubCompanyId:hub,
      partnerCompanyId,month,context}))
  ]);
  const hubDoc=read(hubCompany);
  if(hubDoc.active===false||!id(hubDoc.ownerUid))stop();
  const docs=await Promise.all(partners.map(pid=>tx.get(
   company.collection("rankingSkuMappings").doc(pid)
  )));
  const allTime=exactTime(hubCompany);
  if(allTime.iso!==hubSource.readTime||
     sources.some(x=>x.readTime!==allTime.iso)||
     docs.some(x=>exactTime(x).key!==allTime.key))stop();
  const mappingDocuments=docs.map((snapshot,i)=>{
   const doc=read(snapshot);
   if(doc.ownerReviewed!==true||doc.reviewedByUid!==hubDoc.ownerUid||
      doc.hubCompanyId!==hub||doc.partnerCompanyId!==partners[i]||
      !Array.isArray(doc.links))stop();
   return doc;
  });
  return combineVerifiedOwnerMonth({month,asOf,context,hubSource,
   partnerSources:sources,mappingDocuments});
 };
}
