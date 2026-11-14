/**
 * STAGING / NO DEPLOY: join ORIGINAL internal records and authorized partner
 * staff entries with server-owned, explicitly reviewed exact product ID maps.
 * No client/browser group choices, label matching, raw sales or private SKUs.
 * One outer Firestore transaction must supply every snapshot.
 *
 * Mapping document (never automatically created or migrated):
 * companies/{hub}/rankingSkuMappings/shared
 * {hubCompanyId,ownerUid,reviewedByUid,active:true,version:1,
 *  bindings:[{companyId,productId,hubProductId}]}
 * Missing/changed/ambiguous mappings block publishing.
 */
import {createInternalMonthTransactionReader}
 from "./internal-month-count-tx-reader.mjs";
import {createPartnerMonthTransactionReader}
 from "./partner-month-readonly-loader.mjs";
import {createPartnerLegacyQuickMonthReader}
 from "./partner-legacy-quick-count-reader.mjs";
import {auditNoFinancialKeys}
 from "../security/public-projection.mjs";
import {mergeVerifiedTwoMonthInputs}
 from "./verified-two-month-count-input.mjs";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const STOP=()=>{throw Error("CANONICAL_RANKING_SOURCE_OR_SKU_MAP_UNVERIFIED");};
const FORBIDDEN_STAFF_NAME=/(?:売上|単価|収益|原価|価格|報酬|利益|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
const valid=x=>typeof x==="string"&&ID.test(x)&&
 !["constructor","prototype","__proto__"].includes(x);
const array=x=>Array.isArray(x);
function equal(a,b){
 return array(a)&&array(b)&&a.length===b.length&&
  new Set(a).size===a.length&&a.every(x=>valid(x)&&b.includes(x));
}
function safeDay(day,month){
 if(typeof day!=="string"||!DATE.test(day)||day.slice(0,7)!==month)STOP();
 const [y,m,d]=day.split("-").map(Number);
 const t=new Date(Date.UTC(y,m-1,d));
 if(t.toISOString().slice(0,10)!==day)STOP();
 return day;
}
const doc=x=>x?.exists===true&&typeof x.data==="function"?x.data():STOP();
function sameTime(snapshot,iso){
 const ts=snapshot?.readTime;
 if(!Number.isSafeInteger(ts?.seconds)||!Number.isSafeInteger(ts?.nanoseconds)||
    typeof ts?.toDate!=="function")STOP();
 const t=ts.toDate();
 if(!(t instanceof Date)||!Number.isFinite(t.getTime())||
    t.toISOString()!==iso)STOP();
}
function partnerRankingSource(source){
 if(!source||source.kind!=="partner"||!valid(source.companyId)||
    !array(source.records)||!array(source.lines)||
    !array(source.products)||!array(source.teams)||
    source.isComplete!==true||source.consentVerified!==true||
    !TIME.test(source.readTime||""))STOP();
 const roster=new Map();
 for(const r of source.records){
  if(!valid(r.uid)||!valid(r.teamId)||!safeDay(r.date,r.date.slice(0,7)))STOP();
  const old=roster.get(r.uid);
  if(!old||r.date>=old.lastDate)roster.set(r.uid,{
   uid:r.uid,name:r.memberNameSnapshot,teamId:r.teamId,lastDate:r.date
  });
 }
 // A complete partner-month reader also supplies active registered staff,
 // including people with no saved report. They must remain UNREPORTED, not
 // become fake submitted zero counts. Saved-entry-only historical members
 // stay in the map; a current team move never rewrites historical entry rows.
 if(source.roster!==undefined){
  if(!array(source.roster)||source.roster.length>150)STOP();
  const seenCurrent=new Set(),teamIds=new Set(source.teams.map(x=>x.id));
  for(const person of source.roster){
   if(!person||Object.keys(person).sort().join("|")!=="name|teamId|uid"||
      !valid(person.uid)||seenCurrent.has(person.uid)||
      !teamIds.has(person.teamId)||
      typeof person.name!=="string"||!person.name.trim()||
      person.name.length>80||
      FORBIDDEN_STAFF_NAME.test(person.name.normalize("NFKC")))STOP();
   seenCurrent.add(person.uid);
   // Only registered active staff may override the current presentation
   // name/team. The original records' teamId snapshot is NEVER changed.
   roster.set(person.uid,{uid:person.uid,name:person.name,teamId:person.teamId});
  }
 }
 const result={
  ...source,completeWindows:{current:true,previous:false},
  roster:[...roster.values()].map(({lastDate:_discard,...v})=>v)
 };
 auditNoFinancialKeys(result);
 return result;
}
export function composeCanonicalMonthlyRankingInput({
 context,hubSource,partnerSources,skuMap,hubOwnerUid,month,serverAsOf
}={}){
 if(!context||context.serverVerified!==true||
    !["hub_owner","partner_owner"].includes(context.role)||
    !valid(context.hubCompanyId)||!valid(hubOwnerUid)||
    !MONTH.test(month||"")||
    !array(context.approvedCompanyIds)||
    context.approvedCompanyIds.length<1||
    context.approvedCompanyIds.length>30||
    !context.approvedCompanyIds.includes(context.hubCompanyId)||
    !array(partnerSources)||!hubSource||
    !skuMap||skuMap.active!==true||
    skuMap.hubCompanyId!==context.hubCompanyId||
    skuMap.ownerUid!==hubOwnerUid||
    skuMap.reviewedByUid!==hubOwnerUid||
    !Number.isSafeInteger(skuMap.version)||skuMap.version<1||
    !array(skuMap.bindings)||skuMap.bindings.length>1000)
   STOP();
 const asOf=safeDay(serverAsOf,month);
 const hub=context.hubCompanyId;
 const partners=context.approvedCompanyIds.filter(id=>id!==hub);
 if(!equal(partnerSources.map(p=>p.companyId),partners)||
    hubSource.companyId!==hub||hubSource.kind!=="own"||
    hubSource.isComplete!==true||hubSource.consentVerified!==true||
    !TIME.test(hubSource.readTime||"")||
    !array(hubSource.products))STOP();
 const sourceProducts=new Map(),hubProducts=new Map();
 const sources=[hubSource,...partnerSources.map(partnerRankingSource)];
 if(!equal(sources.map(s=>s.companyId),context.approvedCompanyIds)||
    sources.some(s=>s.readTime!==hubSource.readTime))STOP();
 for(const p of hubSource.products){
  if(!valid(p.sourceId)||hubProducts.has(p.sourceId))STOP();
  hubProducts.set(p.sourceId,p);
 }
 for(const s of sources){
  if(!array(s.products)||!array(s.records)||!array(s.lines))STOP();
  const set=new Set();
  for(const p of s.products){
   if(!valid(p.sourceId)||p.companyId!==s.companyId||set.has(p.sourceId))STOP();
   set.add(p.sourceId);
  }
  sourceProducts.set(s.companyId,set);
 }
 const seen=new Set();
 const groups=hubSource.products.map(p=>({
  companyId:hub,productId:p.sourceId,
  groupId:p.sourceId,groupName:p.name
 }));
 for(const b of skuMap.bindings){
  if(!b||Object.keys(b).sort().join("|")!==
      ["companyId","productId","hubProductId"].sort().join("|")||
     !valid(b.companyId)||!valid(b.productId)||!valid(b.hubProductId)||
     !partners.includes(b.companyId)||
     !sourceProducts.get(b.companyId)?.has(b.productId)||
     !hubProducts.has(b.hubProductId))STOP();
  const key=b.companyId+":"+b.productId;
  if(seen.has(key))STOP();
  seen.add(key);
  const partner=sources.find(s=>s.companyId===b.companyId);
  const originalProduct=partner.products.find(p=>p.sourceId===b.productId);
  const target=hubProducts.get(b.hubProductId);
  // Legacy combined SB光・AIR may ONLY map to a distinct legacy-combined
  // hub SKU. Never silently split or claim it is 光 or Air.
  if(/旧合算|未分類|SB光・AIR/.test(originalProduct.name)&&
     !/旧合算|未分類|SB光・AIR/.test(target.name))STOP();
  groups.push({
   companyId:b.companyId,productId:b.productId,
   groupId:b.hubProductId,groupName:target.name
  });
 }
 const result={
  hubCompanyId:hub,
  approvedCompanyIds:[...context.approvedCompanyIds],
  sources,productGroups:groups,
  unassigned:[],personGoals:[],historicalBest:[],
  mappingsReviewed:true,snapshotReadTime:hubSource.readTime,
  period:{kind:"month",day:month+"-01",asOf}
 };
 auditNoFinancialKeys(result);
 return result;
}
/**
 * Canonical transaction callback for the existing atomic loader.
 * Requires approved mapping doc. A missing mapping NEVER silently joins
 * SKUs by name; owner's browser-local groups are NOT an authorization.
 */
function trustedJapanAsOf(month,clock){
 const now=clock();
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))STOP();
 const fmt=new Intl.DateTimeFormat("en-US",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
 });
 const parts=Object.fromEntries(fmt.formatToParts(now).map(x=>[x.type,x.value]));
 const today=parts.year+"-"+parts.month+"-"+parts.day;
 if(month>today.slice(0,7))STOP();
 const end=new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0))
  .toISOString().slice(0,10);
 return month===today.slice(0,7)?today:end;
}
export function createCanonicalCountTransactionReader({db,clock=()=>new Date()}={}){
 if(typeof clock!=="function")STOP();
 if(!db||typeof db.collection!=="function")STOP();
 const loadHub=createInternalMonthTransactionReader({db});
 const loadPartner=createPartnerMonthTransactionReader({db});
 const loadLegacyQuick=createPartnerLegacyQuickMonthReader({db});
 return async function readCounts({tx,month,context,secondMonth}={}){
  if(!tx||typeof tx.get!=="function"||!context||
     !valid(context.hubCompanyId)||!MONTH.test(month||"")||
     !array(context.approvedCompanyIds)||
     !context.approvedCompanyIds.includes(context.hubCompanyId))STOP();
  // Fail before issuing any Firestore read for a forged/unrelated second month.
  // A cross-month week can span exactly two adjacent calendar months.
  if(secondMonth!==undefined){
   if(!MONTH.test(secondMonth)||secondMonth===month)STOP();
   const toMonthIndex=m=>{
    const [year,num]=m.split("-").map(Number);
    return year*12+num;
   };
   if(Math.abs(toMonthIndex(secondMonth)-toMonthIndex(month))!==1)STOP();
  }
  const hubId=context.hubCompanyId;
  const hubRef=db.collection("companies").doc(hubId);
  const mappingRef=hubRef.collection("rankingSkuMappings").doc("shared");
  const partners=context.approvedCompanyIds.filter(x=>x!==hubId);
  const [hubCompanySnap,mappingSnap,hubSource,...partnerSources]=
   await Promise.all([
    tx.get(hubRef),tx.get(mappingRef),
    loadHub({tx,hubCompanyId:hubId,month,context}),
    ...partners.map(partnerCompanyId=>loadPartner({
     tx,hubCompanyId:hubId,partnerCompanyId,month,context
    }))
   ]);
  const hubCompany=doc(hubCompanySnap);
  if(!valid(hubCompany.ownerUid)||hubCompany.active===false||
     !mappingSnap.exists)STOP();
  sameTime(hubCompanySnap,hubSource.readTime);
  sameTime(mappingSnap,hubSource.readTime);
  // Recover legacy company-only daily reports from the SAME verified
  // transaction, without assigning their counts to a guessed staff/team.
  // The legacy reader rejects overlap with staff-summary or staff entries.
  const legacyByCompany=await Promise.all(partners.map((partnerCompanyId,i)=>
   loadLegacyQuick({
    tx,context,hubCompanyId:hubId,partnerCompanyId,month,
    source:partnerSources[i]
   })
  ));
  const original=composeCanonicalMonthlyRankingInput({
   context,hubSource,partnerSources,
   skuMap:doc(mappingSnap),hubOwnerUid:hubCompany.ownerUid,
   month,serverAsOf:trustedJapanAsOf(month,clock)
  });
  const primary={...original,unassigned:legacyByCompany.flat()};
  auditNoFinancialKeys(primary);
  if(secondMonth===undefined)return primary;
  // Both reads are performed with the SAME transaction supplied by the
  // trusted server loader; no second transaction is created here.
  const secondary=await readCounts({tx,month:secondMonth,context});
  const merged=mergeVerifiedTwoMonthInputs({primary,secondary});
  return {...merged,verifiedMonths:[month,secondMonth]};
 };
}
