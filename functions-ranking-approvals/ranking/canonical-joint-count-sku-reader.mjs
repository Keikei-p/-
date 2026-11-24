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
import {linkAllRegisteredCountsWithoutSetup}
 from "./zero-setup-count-linker.mjs";
import {historicalCountGroup,withHistoricalCountProducts} from "./historical-count-publication-groups.mjs";
const LEGACY_COMBINED_LIGHT_AIR=/(?:^|[\s（(])(?:SB|ソフトバンク)?光\s*[/／・]\s*(?:AIR|エアー)(?=$|[\s）)（(])/i;
const LEGACY_COMBINED_TSUBASA_HTB=/(?:^|[\s（(])(?:つばさ|翼)\s*[/／・]\s*HTB(?=$|[\s）)（(])/i;
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
 context,hubSource,partnerSources,skuMap,hubOwnerUid,month,serverAsOf,
 zeroSetupLink=false,includeHistoricalGroups=false,historicalPublication
}={}){
 if(typeof includeHistoricalGroups!=="boolean")STOP();
 if(!context||context.serverVerified!==true||
    !["hub_owner","partner_owner"].includes(context.role)||
    !valid(context.hubCompanyId)||!valid(hubOwnerUid)||
    !MONTH.test(month||"")||
    !array(context.approvedCompanyIds)||
    context.approvedCompanyIds.length<1||
    context.approvedCompanyIds.length>30||
    !context.approvedCompanyIds.includes(context.hubCompanyId)||
    !array(partnerSources)||!hubSource||
    (zeroSetupLink!==true&&!skuMap)||
    (skuMap!=null&&(
     skuMap.active!==true||
     skuMap.hubCompanyId!==context.hubCompanyId||
     skuMap.ownerUid!==hubOwnerUid||
     skuMap.reviewedByUid!==hubOwnerUid||
     !Number.isSafeInteger(skuMap.version)||skuMap.version<1||
     !array(skuMap.bindings)||skuMap.bindings.length>1000)))
   STOP();
 if(historicalPublication!==undefined&&(!includeHistoricalGroups||historicalPublication.hubCompanyId!==context.hubCompanyId||historicalPublication.ownerUid!==hubOwnerUid))STOP();
 const asOf=safeDay(serverAsOf,month);
 const hub=context.hubCompanyId;
 const partners=context.approvedCompanyIds.filter(id=>id!==hub);
 if(!equal(partnerSources.map(p=>p.companyId),partners)||
    hubSource.companyId!==hub||hubSource.kind!=="own"||
    hubSource.isComplete!==true||hubSource.consentVerified!==true||
    !TIME.test(hubSource.readTime||"")||
    !array(hubSource.products))STOP();
 if(includeHistoricalGroups)hubSource={...hubSource,products:withHistoricalCountProducts(hubSource.products,hub,{source:true})};
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
 // A pre-existing Owner-reviewed exact binding is stronger evidence than
 // a name/alias match. Validate the complete saved mapping BEFORE applying
 // anything; zero-setup mode must work when no document exists.
 const reviewedBindings=skuMap?.bindings??[],seen=new Set(),targets=new Set();
 for(const b of reviewedBindings){
  if(!b||Object.keys(b).sort().join("|")!==
      ["companyId","productId","hubProductId"].sort().join("|")||
     !valid(b.companyId)||!valid(b.productId)||!valid(b.hubProductId)||
     !partners.includes(b.companyId)||
     !sourceProducts.get(b.companyId)?.has(b.productId)||
     !hubProducts.has(b.hubProductId))STOP();
  // Read-side defense rejects duplicate targets even in old mapping docs.
  const key=JSON.stringify([b.companyId,b.productId]);
  const targetKey=JSON.stringify([b.companyId,b.hubProductId]);
  if(seen.has(key)||targets.has(targetKey))STOP();
  seen.add(key);targets.add(targetKey);
  const partner=sources.find(s=>s.companyId===b.companyId);
  const originalProduct=partner.products.find(p=>p.sourceId===b.productId);
  const target=hubProducts.get(b.hubProductId);
  const historical=historicalCountGroup(b.hubProductId);
  if(historical&&historical.sourceSkuId!==b.productId)STOP();
  // A stored OFF mapping must not blank out every other ON ranking.
  // Zero-setup holds it unmatched; classic mode does not emit the OFF group.
  // Historic combined light/AIR must never be guessed into separate SKUs.
  if((b.productId==="partnerSku05"||
      LEGACY_COMBINED_LIGHT_AIR.test(originalProduct.name.normalize("NFKC")))&&
     !LEGACY_COMBINED_LIGHT_AIR.test(target.name.normalize("NFKC")))STOP();
  if((b.productId==="partnerSku07"||LEGACY_COMBINED_TSUBASA_HTB.test(originalProduct.name.normalize("NFKC")))&&
     !LEGACY_COMBINED_TSUBASA_HTB.test(target.name.normalize("NFKC")))STOP();
 }
 const groups=zeroSetupLink===true?
  linkAllRegisteredCountsWithoutSetup({
   hubCompanyId:hub,hubSource,partnerSources:sources.slice(1),
   reviewedBindings,...(includeHistoricalGroups&&historicalPublication!==undefined?{historicalPublication}:{})
  }):hubSource.products.map(p=>({
   companyId:hub,productId:p.sourceId,
   groupId:p.sourceId,groupName:p.name
  }));
 // Original Owner-reviewed-only mode keeps its existing behavior. Zero-setup
 // already included reviewed ID precedence above: never double-add a source.
 if(zeroSetupLink!==true)for(const b of reviewedBindings){
  if(hubProducts.get(b.hubProductId).active!==true)continue;
  groups.push({
   companyId:b.companyId,productId:b.productId,
   groupId:b.hubProductId,groupName:hubProducts.get(b.hubProductId).name
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
 * Strict original mode requires an approved mapping doc. Zero-setup mode
 * additionally accepts an absent map, but reuses any existing, verified
 * Owner-reviewed exact IDs before safe aliases; no browser authority.
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
export function createCanonicalCountTransactionReader({db,clock=()=>new Date(),zeroSetupLink=false,includeHistoricalGroups=false}={}){
 if(typeof clock!=="function")STOP();
 if(!db||typeof db.collection!=="function")STOP();
 const loadHub=createInternalMonthTransactionReader({db});
 const loadPartner=createPartnerMonthTransactionReader({
  db,clock,includePrivateCounts:zeroSetupLink===true
 });
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
  const snapshots=await Promise.all([
    tx.get(hubRef),tx.get(mappingRef),
    loadHub({tx,hubCompanyId:hubId,month,context}),
    ...partners.map(partnerCompanyId=>loadPartner({
     tx,hubCompanyId:hubId,partnerCompanyId,month,context
    }))
   ]);
  const [hubCompanySnap,mappingSnap,hubSource,...partnerSources]=snapshots;
  const hubCompany=doc(hubCompanySnap);
  if(!valid(hubCompany.ownerUid)||hubCompany.active===false||
     zeroSetupLink!==true&&!mappingSnap?.exists)STOP();
  sameTime(hubCompanySnap,hubSource.readTime);
  // Absent optional mapping is allowed only for zero-setup; any existing
  // reviewed map must be from the same count snapshot.
  if(mappingSnap?.exists)sameTime(mappingSnap,hubSource.readTime);
  // Recover legacy company-only daily reports from the SAME verified
  // transaction, without assigning their counts to a guessed staff/team.
  // The legacy reader rejects overlap with staff-summary or staff entries.
  const legacyByCompany=await Promise.all(partners.map((partnerCompanyId,i)=>
   loadLegacyQuick({
    tx,context,hubCompanyId:hubId,partnerCompanyId,month,
    source:partnerSources[i]
   })
  ));
  let historicalPublication;
  if(includeHistoricalGroups&&zeroSetupLink){
   const policy=await tx.get(hubRef.collection("rankingProductVisibility").doc("shared"));
   if(policy?.exists){
    sameTime(policy,hubSource.readTime);
    historicalPublication=doc(policy);
    if(historicalPublication.ownerUid!==hubCompany.ownerUid||historicalPublication.hubCompanyId!==hubId)STOP();
   }
  }
  const original=composeCanonicalMonthlyRankingInput({
   context,hubSource,partnerSources,
   skuMap:mappingSnap.exists?doc(mappingSnap):null,
   zeroSetupLink,includeHistoricalGroups,historicalPublication,hubOwnerUid:hubCompany.ownerUid,
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
