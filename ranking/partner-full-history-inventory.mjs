/**
 * Trusted-server/offline READ ONLY inventory. No persistence, migrations or
 * authorization endpoints. Call only with a complete single-snapshot read.
 * Names produce candidates only; only reviewed IDs plus current publication
 * may count as mapped. Ambiguous quick/staff days have NO combined total.
 */
import {createHmac} from "node:crypto";

export const LEGACY_PARTNER_CATEGORIES=Object.freeze([
 "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|収益|原価|価格|報酬|利益|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
const obj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const id=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const stop=reason=>{throw Error("PARTNER_FULL_HISTORY_"+reason);};
const safeCount=(n,max=Number.MAX_SAFE_INTEGER)=>{
 if(!Number.isSafeInteger(n)||n<0||n>max)stop("INVALID_COUNT");
 return n;
};
const add=(a,b)=>safeCount(safeCount(a)+safeCount(b));
const sum=rows=>rows.reduce((n,x)=>add(n,x),0);
const named=x=>typeof x==="string"&&x.trim().length>0&&x.trim().length<=80&&
 !MONEY.test(x.normalize("NFKC"));
const nameKey=x=>named(x)?x.trim():null;
const combined=x=>typeof x==="string"&&
 /(?:^|[\s（(])(?:SB|ソフトバンク)?光\s*[/／・]\s*(?:AIR|エアー)(?=$|[\s）)（(])/i.test(x.normalize("NFKC"));
const LEGACY_COMBINED_TSUBASA_HTB=/(?:^|[\s（(])(?:つばさ|翼)\s*[/／・]\s*HTB(?=$|[\s）)（(])/i;
const energyCombined=x=>typeof x==="string"&&LEGACY_COMBINED_TSUBASA_HTB.test(x.normalize("NFKC"));
function day(x){
 if(typeof x!=="string"||!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(x))stop("INVALID_DATE");
 const d=new Date(x+"T00:00:00Z");
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==x)stop("INVALID_DATE");
 return x;
}
function counts(value,{legacy=false,max=9999}={}){
 if(!obj(value)||Object.keys(value).length>(legacy?9:1000))stop("INVALID_COUNTS");
 if(legacy&&Object.keys(value).sort().join("|")!==[...LEGACY_PARTNER_CATEGORIES].sort().join("|"))stop("LEGACY_KEYS");
 const result=new Map();
 for(const [key,n] of Object.entries(value)){
  if(!legacy&&!id(key))stop("INVALID_PRODUCT_ID");
  result.set(key,safeCount(n,max));
 }
 return result;
}
function entryCounts(e){
 const legacy=counts(e.counts,{legacy:true});
 const privateCounts=counts(e.privateCounts??{});
 const published=counts(e.publishedCounts??{});
 if(e.totalCount!==sum([...legacy.values()])||
    (e.privateTotalCount??0)!==sum([...privateCounts.values()])||
    (e.publishedTotalCount??0)!==sum([...published.values()]))stop("ENTRY_TOTAL");
 return {legacy,private:privateCounts,published};
}
function reportCounts(r){
 if(r.kind==="quick"&&(!Number.isSafeInteger(r.version)||r.version<1||r.version>999))stop("QUICK_REPORT_VERSION");
 const legacy=counts(r.counts,{legacy:true,max:Number.MAX_SAFE_INTEGER});
 const published=counts(r.publishedCounts??{},{max:Number.MAX_SAFE_INTEGER});
 if(r.totalCount!==sum([...legacy.values()])||
    (r.publishedTotalCount??0)!==sum([...published.values()])||
    (r.kind==="quick"&&published.size))stop("REPORT_TOTAL");
 return {legacy,published};
}
function sameCounts(a,b){
 const keys=new Set([...a.keys(),...b.keys()]);
 return [...keys].every(key=>(a.get(key)??0)===(b.get(key)??0));
}
function publication(hub,companyId,issues){
 const {visibility:v,catalog:c,mapping:m}=hub;
 const products=new Map(),bindings=new Map();
 let ready=true;
 const unique=values=>Array.isArray(values)&&values.length<=1000&&
  values.every(id)&&new Set(values).size===values.length;
 if(!obj(v)||v.hubCompanyId!==hub.id||v.ownerUid!==hub.ownerUid||
    !Number.isSafeInteger(v.version)||v.version<1||!unique(v.enabledHubProductIds)||
    !obj(v.partnerOverrides)||Object.keys(v.partnerOverrides).length>100||
    !obj(c)||c.schema!=="nico-reviewed-count-public-catalog-v1"||
    c.hubCompanyId!==hub.id||c.ownerUid!==hub.ownerUid||c.version!==v.version||
    !Array.isArray(c.products)||c.products.length>1000)ready=false;
 if(ready){
  for(const p of c.products){
   if(!obj(p)||Object.keys(p).sort().join("|")!=="active|companyId|id|name"||
      !id(p.id)||products.has(p.id)||p.companyId!==hub.id||
      typeof p.active!=="boolean"||!named(p.name)){ready=false;break;}
   products.set(p.id,p);
  }
  if(v.enabledHubProductIds.some(pid=>!products.has(pid)))ready=false;
  for(const [cid,values] of Object.entries(v.partnerOverrides))
   if(!id(cid)||cid===hub.id||!unique(values)||values.some(pid=>!products.has(pid)))ready=false;
 }
 if(!ready){products.clear();issues.add("PUBLICATION_UNVERIFIED");}
 let mappingReady=!!m;
 if(!obj(m)||m.hubCompanyId!==hub.id||m.ownerUid!==hub.ownerUid||
    m.reviewedByUid!==hub.ownerUid||m.active!==true||
    !Number.isSafeInteger(m.version)||m.version<1||
    !Array.isArray(m.bindings)||m.bindings.length>1000)mappingReady=false;
 if(mappingReady){
  const seen=new Set(),targets=new Set();
  for(const b of m.bindings){
   if(!obj(b)||Object.keys(b).sort().join("|")!=="companyId|hubProductId|productId"||
      !id(b.companyId)||b.companyId===hub.id||!id(b.productId)||!id(b.hubProductId)){
    mappingReady=false;break;
   }
   const pair=JSON.stringify([b.companyId,b.productId]);
   const target=JSON.stringify([b.companyId,b.hubProductId]);
   if(seen.has(pair)||targets.has(target)){mappingReady=false;break;}
   seen.add(pair);targets.add(target);
   if(b.companyId===companyId)bindings.set(b.productId,b.hubProductId);
  }
 }
 if(!mappingReady){bindings.clear();issues.add(m?"MAPPING_UNVERIFIED":"MAPPING_MISSING");}
 const on=ready?new Set(v.enabledHubProductIds):new Set();
 const scoped=ready&&Object.hasOwn(v.partnerOverrides,companyId)?
  new Set(v.partnerOverrides[companyId]):on;
 return {ready,mappingReady,products,bindings,
  allowed:pid=>ready&&on.has(pid)&&scoped.has(pid)&&products.get(pid)?.active===true};
}

/**
 * All identifiers and labels remain process-local. The returned report is
 * pseudonymous. Source totals stay separate whenever sources overlap; a null
 * grand total is intentional and must never be replaced with a sum.
 */
export function inventoryPartnerFullHistory({hubs,companies,relations,reports,proof,pseudonymKey}={}){
 if(!Array.isArray(hubs)||hubs.length>20||!Array.isArray(companies)||companies.length>200||
    !Array.isArray(relations)||relations.length>200||!Array.isArray(reports)||reports.length>20000||
    typeof pseudonymKey!=="string"||pseudonymKey.length<32||pseudonymKey.length>256||
    !obj(proof)||["serverVerified","snapshotConsistent","completeCompanies","completeRelations",
     "completeEntries","completePrivateProducts","completeReports","completeOwnerProducts",
     "completeSettings"].some(k=>proof[k]!==true)||
    typeof proof.readTime!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(proof.readTime)||
    !Number.isFinite(Date.parse(proof.readTime)))stop("INCOMPLETE_SNAPSHOT");
 const alias=(prefix,...parts)=>prefix+createHmac("sha256",pseudonymKey)
  .update(JSON.stringify(parts)).digest("hex").slice(0,16);
 const hubMap=new Map(),companyMap=new Map(),relationMap=new Map(),reportMap=new Map();
 for(const h of hubs){
  if(!obj(h)||!id(h.id)||!id(h.ownerUid)||hubMap.has(h.id)||
     !Array.isArray(h.ownerProducts)||h.ownerProducts.length>1000)stop("HUB_SCOPE");
  const seen=new Set();
  for(const p of h.ownerProducts){
   if(!obj(p)||!id(p.id)||seen.has(p.id)||p.companyId!==h.id||
      (p.active!==undefined&&typeof p.active!=="boolean"))stop("OWNER_PRODUCT_SCOPE");
   seen.add(p.id);
  }
  hubMap.set(h.id,h);
 }
 for(const c of companies){
  if(!obj(c)||!id(c.id)||!id(c.hubCompanyId)||c.id===c.hubCompanyId||
     !hubMap.has(c.hubCompanyId)||companyMap.has(c.id)||
     typeof c.active!=="boolean"||!Array.isArray(c.entries)||c.entries.length>10000||
     !Array.isArray(c.privateProducts)||c.privateProducts.length>1000)stop("COMPANY_SCOPE");
  companyMap.set(c.id,c);
 }
 for(const r of relations){
  if(!obj(r)||!id(r.partnerCompanyId)||!id(r.hubCompanyId)||
     typeof r.active!=="boolean"||typeof r.countSharingApproved!=="boolean"||
     relationMap.has(r.partnerCompanyId)||!hubMap.has(r.hubCompanyId)||
     (companyMap.has(r.partnerCompanyId)&&companyMap.get(r.partnerCompanyId).hubCompanyId!==r.hubCompanyId))stop("RELATION_SCOPE");
  relationMap.set(r.partnerCompanyId,r);
 }
 for(const r of reports){
  if(!obj(r)||!["staff","quick"].includes(r.kind)||!id(r.partnerCompanyId)||
     !hubMap.has(r.hubCompanyId)||!companyMap.has(r.partnerCompanyId)||
     companyMap.get(r.partnerCompanyId).hubCompanyId!==r.hubCompanyId)stop("REPORT_SCOPE");
  day(r.date);
  const key=JSON.stringify([r.partnerCompanyId,r.date,r.kind]);
  if(reportMap.has(key))stop("DUPLICATE_REPORT");
  reportMap.set(key,{...r,normalized:reportCounts(r)});
 }
 const companyResults=[],allIssues=new Set(),allRows=[],allConflicts=[];
 const totals={original:0,mapped:0,held:0};
 let rowCount=0,sourceEntryCount=0,sourcePrivateProductCount=0;
 for(const company of companies){
  const hub=hubMap.get(company.hubCompanyId),issues=new Set(),rel=relationMap.get(company.id);
  const approved=company.active&&rel?.hubCompanyId===hub.id&&rel.active===true&&rel.countSharingApproved===true;
  if(!approved)issues.add("COUNT_SHARING_UNVERIFIED");
  const pub=publication(hub,company.id,issues),privates=new Map(),days=new Map(),seenEntries=new Set();
  for(const p of company.privateProducts){
   if(!obj(p)||!id(p.id)||privates.has(p.id)||p.companyId!==company.id||
      p.origin!=="partner_custom"||p.visibility!=="private"||typeof p.active!=="boolean")stop("PRIVATE_PRODUCT_SCOPE");
   privates.set(p.id,p);
  }
  sourcePrivateProductCount+=privates.size;sourceEntryCount+=company.entries.length;
  const getDay=date=>{
   if(!days.has(date))days.set(date,{entries:0,zeroReports:0,legacy:new Map(),private:new Map(),published:new Map()});
   return days.get(date);
  };
  for(const e of company.entries){
   if(!obj(e)||e.companyId!==company.id||e.hubCompanyId!==hub.id||!id(e.staffId)||
      e.id!==day(e.date)+"__"+e.staffId||seenEntries.has(e.id)||
      !Number.isSafeInteger(e.version)||e.version<1)stop("ENTRY_IDENTITY");
   seenEntries.add(e.id);
   const values=entryCounts(e),d=getDay(e.date);d.entries++;
   if(sum([...values.legacy.values(),...values.private.values(),...values.published.values()])===0)d.zeroReports++;
   for(const type of ["legacy","private","published"])
    for(const [pid,n] of values[type])d[type].set(pid,add(d[type].get(pid)??0,n));
  }
  for(const r of reports)if(r.partnerCompanyId===company.id)getDay(r.date);
  const monthRows=new Map(),conflicts=[],summaryMismatches=[],sourceTotals=new Map();
  const addRow=({date,kind,pid,count,forcedReason=null})=>{
   const legacy=kind.endsWith("legacy"),privateKind=kind==="ledger_private",published=kind==="ledger_published";
   const legacyIndex=legacy?LEGACY_PARTNER_CATEGORIES.indexOf(pid):-1;
   const sourceId=legacy?"partnerSku"+String(legacyIndex+1).padStart(2,"0"):pid;
   const sourceName=legacy?pid:privateKind?privates.get(pid)?.name:pub.products.get(pid)?.name;
   const legacyCombined=legacy&&legacyIndex===4;
   const legacyEnergyCombined=legacy&&legacyIndex===6;
   const productRef=alias("P-",company.id,privateKind?"private":published?"published":"legacy",sourceId);
   const privateBindingId=privateKind?"partnerPrivate:"+sourceId:null;
   let target=published?pid:pub.bindings.get(privateBindingId??sourceId)??null;
   let reason=forcedReason;
   if(!reason&&!approved)reason="held_relation";
   if(!reason&&privateKind&&!privates.has(pid))reason="held_unknown_private_product";
   // Never infer that an untyped old binding applies to a private catalog.
   if(!reason&&privateKind&&!target&&pub.bindings.has(sourceId))reason="held_ambiguous_source_id";
   if(!reason&&!pub.ready)reason="held_publication";
   if(!reason&&!published&&!pub.mappingReady)reason="held_mapping";
   if(!reason&&!target)reason="held_unmapped";
   const targetProduct=target?pub.products.get(target):null;
   if(!reason&&!targetProduct)reason="held_unknown_target";
   if(!reason&&(legacyCombined||(privateKind&&combined(sourceName)))&&
      !combined(targetProduct.name))reason="held_legacy_combined";
   if(!reason&&(legacyEnergyCombined||(privateKind&&energyCombined(sourceName)))&&
      !energyCombined(targetProduct.name))reason="held_legacy_energy_combined";
   if(!reason&&!pub.allowed(target))reason="held_off";
   const state=reason??"mapped",mapped=state==="mapped"?count:0;
   const exact=nameKey(sourceName);
   const nameMatches=hub.ownerProducts.filter(p=>exact!==null&&nameKey(p.name)===exact&&
    (!legacyCombined||combined(p.name))&&(!legacyEnergyCombined||energyCombined(p.name)));
   const candidates=nameMatches.length===1&&nameMatches[0].active!==false?
    [alias("H-",hub.id,nameMatches[0].id)]:[];
   const exactIdKnown=published&&pub.products.has(pid);
   const rowKey=JSON.stringify([date.slice(0,7),kind,productRef,state,target]);
   if(!monthRows.has(rowKey))monthRows.set(rowKey,{
    month:date.slice(0,7),sourceKind:kind,productRef,state,legacyCombined,legacyEnergyCombined,
    targetProductRef:target?alias("H-",hub.id,target):null,
    originalCount:0,mappedCount:0,heldCount:0,
    exactNameCandidates:candidates.sort(),candidateOnly:true,
    exactPublishedIdCandidate:exactIdKnown
   });
   const out=monthRows.get(rowKey);
   out.originalCount=add(out.originalCount,count);out.mappedCount=add(out.mappedCount,mapped);
   out.heldCount=add(out.heldCount,count-mapped);
   if(!sourceTotals.has(kind))sourceTotals.set(kind,{sourceKind:kind,originalCount:0,mappedCount:0,heldCount:0});
   const t=sourceTotals.get(kind);t.originalCount=add(t.originalCount,count);
   t.mappedCount=add(t.mappedCount,mapped);t.heldCount=add(t.heldCount,count-mapped);
   if(state!=="held_overlap"){
    totals.original=add(totals.original,count);totals.mapped=add(totals.mapped,mapped);
    totals.held=add(totals.held,count-mapped);
   }
  };
  let mismatchDays=0,zeroEntries=0,zeroQuickReports=0,targetOverlapDays=0;
  for(const [date,d] of [...days].sort(([a],[b])=>a.localeCompare(b))){
   zeroEntries+=d.zeroReports;
   const staff=reportMap.get(JSON.stringify([company.id,date,"staff"]));
   const quick=reportMap.get(JSON.stringify([company.id,date,"quick"]));
   const quickOverlap=!!quick&&(!!staff||d.entries>0);
   // Direct published IDs and mapped legacy/private IDs can be the same
   // target. Without contract identity these are independent original sources,
   // so never decide they are additional sales or add them to a joint total.
   const occupiedTargets=new Map();
   const registerTarget=(target,source)=>{
    if(!target)return;
    if(!occupiedTargets.has(target))occupiedTargets.set(target,new Set());
    occupiedTargets.get(target).add(source);
   };
   if(pub.mappingReady){
    for(const [name,n] of d.legacy)if(n>0){
     const sku="partnerSku"+String(LEGACY_PARTNER_CATEGORIES.indexOf(name)+1).padStart(2,"0");
     registerTarget(pub.bindings.get(sku),"legacy");
    }
    for(const [pid,n] of d.private)if(n>0)registerTarget(pub.bindings.get("partnerPrivate:"+pid),"private");
   }
   for(const [pid,n] of d.published)if(n>0)registerTarget(pid,"published");
   const targetOverlaps=[...occupiedTargets].filter(([,sources])=>sources.size>1);
   const targetOverlap=targetOverlaps.length>0,overlap=quickOverlap||targetOverlap;
   let mismatch=false;
   if(staff){
    mismatch=d.entries===0||staff.source!=="staff-entries-v1"||
     !sameCounts(d.legacy,staff.normalized.legacy)||!sameCounts(d.published,staff.normalized.published);
   }else if(d.entries>0)mismatch=true;
   if(mismatch){
    mismatchDays++;issues.add("STAFF_SUMMARY_MISMATCH");
    summaryMismatches.push({date,combinedCount:null,
     originalEntryCount:d.entries,ledgerLegacyCount:sum([...d.legacy.values()]),
     ledgerPublishedCount:sum([...d.published.values()]),
     staffSummaryPresent:!!staff,
     staffSummaryLegacyCount:staff?sum([...staff.normalized.legacy.values()]):null,
     staffSummaryPublishedCount:staff?sum([...staff.normalized.published.values()]):null});
   }
   if(quick&&sum([...quick.normalized.legacy.values()])===0)zeroQuickReports++;
   if(overlap){
    if(quickOverlap)issues.add("QUICK_STAFF_OVERLAP");
    if(targetOverlap){targetOverlapDays++;issues.add("PRODUCT_SOURCE_OVERLAP");}
    conflicts.push({date,state:"held_overlap",combinedCount:null,
     quickStaffOverlap:quickOverlap,productSourceOverlap:targetOverlap,
     targetProductRefs:targetOverlaps.map(([pid])=>alias("H-",hub.id,pid)).sort(),
     ledgerLegacyCount:sum([...d.legacy.values()]),ledgerPrivateCount:sum([...d.private.values()]),
     ledgerPublishedCount:sum([...d.published.values()]),
     staffSummaryLegacyCount:staff?sum([...staff.normalized.legacy.values()]):null,
     quickLegacyCount:quick?sum([...quick.normalized.legacy.values()]):null});
   }
   const forcedReason=overlap?"held_overlap":mismatch?"held_summary_mismatch":null;
   for(const [type,kind] of [["legacy","ledger_legacy"],["private","ledger_private"],["published","ledger_published"]])
    for(const [pid,n] of d[type])addRow({date,kind,pid,count:n,forcedReason});
   if(quick)for(const [pid,n] of quick.normalized.legacy)
    addRow({date,kind:"quick_legacy",pid,count:n,forcedReason:quickOverlap?"held_overlap":null});
   // An orphan summary is not a substitute for missing original staff rows.
   // Keep it as separate unresolved evidence and do not manufacture entries.
  }
  const rows=[...monthRows.values()].sort((a,b)=>a.month.localeCompare(b.month)||
   a.sourceKind.localeCompare(b.sourceKind)||a.productRef.localeCompare(b.productRef)||a.state.localeCompare(b.state));
  if(rows.some(r=>r.originalCount!==add(r.mappedCount,r.heldCount)))stop("CONSERVATION");
  rowCount+=rows.length;
  if(rowCount>50000)stop("OUTPUT_LIMIT");
  const companyRef=alias("C-",company.id);
  const result={companyRef,hubRef:alias("C-",hub.id),active:company.active,countSharingApproved:approved,
   originalEntryCount:company.entries.length,privateProductCount:privates.size,reportedZeroEntryCount:zeroEntries,
   reportedZeroQuickReportCount:zeroQuickReports,
   overlapDayCount:conflicts.length,productSourceOverlapDayCount:targetOverlapDays,summaryMismatchDayCount:mismatchDays,
   sourceConservationVerified:true,combinedCountReconciled:conflicts.length===0&&mismatchDays===0,
   sourceTotals:[...sourceTotals.values()].sort((a,b)=>a.sourceKind.localeCompare(b.sourceKind)),
   products:rows,conflicts,summaryMismatches,blockingReasons:[...issues].sort()};
  companyResults.push(result);allRows.push(...rows);allConflicts.push(...conflicts);
  for(const issue of issues)allIssues.add(issue);
 }
 const reconciled=companyResults.every(c=>c.combinedCountReconciled);
 if(totals.original!==add(totals.mapped,totals.held))stop("CONSERVATION");
 // Diagnose why historic counts remain out of joint rankings without exposing
 // company, staff, SKU, or product IDs. Overlap invalidates any grand total:
 // never represent overlapping source counts as a summed held-reason metric.
 const reasonTotals=new Map();
 for(const row of allRows)if(row.heldCount>0){
  if(!/^held_[a-z_]+$/.test(row.state))stop("HOLD_REASON");
  reasonTotals.set(row.state,add(reasonTotals.get(row.state)??0,row.heldCount));
 }
 if(reconciled&&sum([...reasonTotals.values()])!==totals.held)
  stop("HOLD_REASON_CONSERVATION");
 const heldCountsByReason=reconciled?
  Object.fromEntries([...reasonTotals].sort(([a],[b])=>a.localeCompare(b))):null;
 return Object.freeze({schema:"nico-partner-full-history-inventory-v1",mode:"READ_ONLY_NO_DEPLOY",
  snapshotReadTime:proof.readTime,completeSnapshot:true,sourceConservationVerified:true,
  combinedCountReconciled:reconciled,hubCompanyCount:hubs.length,partnerCompanyCount:companies.length,
  originalEntryCount:sourceEntryCount,privateProductCount:sourcePrivateProductCount,reportCount:reports.length,
  reportedZeroEntryCount:sum(companyResults.map(c=>c.reportedZeroEntryCount)),
  reportedZeroQuickReportCount:sum(companyResults.map(c=>c.reportedZeroQuickReportCount)),
  productSourceOverlapDayCount:sum(companyResults.map(c=>c.productSourceOverlapDayCount)),
  overlapDayCount:allConflicts.length,summaryMismatchDayCount:sum(companyResults.map(c=>c.summaryMismatchDayCount)),
  originalTotalCount:reconciled?totals.original:null,mappedTotalCount:reconciled?totals.mapped:null,
  heldTotalCount:reconciled?totals.held:null,
  heldCountsByReason,
  nonOverlappingSourceCounts:{originalCount:totals.original,mappedCount:totals.mapped,heldCount:totals.held},
  legacyCombinedSourceCountsByKind:["ledger_legacy","quick_legacy"].map(sourceKind=>({sourceKind,
   count:sum(allRows.filter(r=>r.sourceKind===sourceKind&&r.legacyCombined).map(r=>r.originalCount))})),
  companies:companyResults.sort((a,b)=>a.companyRef.localeCompare(b.companyRef)),
  blockingReasons:[...allIssues].sort(),historicalWrites:0,mappingWrites:0,productionDocumentWrites:0,
  candidateMappingsApplied:0,safeToEnableRanking:false});
}
