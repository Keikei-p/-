/**
 * Owner-only, non-destructive historic sales reporting.
 * No Firestore writes, no deletes. Source documents and prices are retained
 * unmodified in the immutable archive package for forensic reconciliation.
 */
import {securePricing} from "./write-plan.js";
const idOk=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,150}$/.test(v);
const dateOk=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  new Date(v+"T00:00:00.000Z").toISOString().slice(0,10)===v;
const cash=v=>{
 if(!Number.isSafeInteger(v)||v<0||v>Number.MAX_SAFE_INTEGER)throw Error("sales_invalid_money");
 return v;
};
const count=v=>{
 if(!Number.isSafeInteger(v)||v<0||v>1000000)throw Error("sales_invalid_count");
 return v;
};
const short=(name,fallback)=>String(name||fallback).slice(0,75);
const totals=(key,values)=>Object.fromEntries([...values.values()].sort((a,b)=>String(a[key]).localeCompare(String(b[key]),"ja"))
  .map(row=>[row[key],row]));
const tally=(map,key,base,countValue,revenue,original)=>{
 let entry=map.get(key);
 if(!entry){entry={...base,count:0,revenue:0,originalRevenue:0};map.set(key,entry);}
 entry.count=count(entry.count+countValue);
 entry.revenue=cash(entry.revenue+revenue);
 entry.originalRevenue=cash(entry.originalRevenue+original);
};
export function buildAnnualSalesReport({year,companyId,records,products,teams}){
 if(!/^20\d{2}$/.test(String(year))||!idOk(companyId)||
    ![records,products,teams].every(Array.isArray))throw Error("sales_invalid_report_scope");
 const nameByTeam=new Map(),catalog=new Map();
 for(const team of teams){
  if(team?.companyId!==companyId)continue;
  if(!idOk(team.id))throw Error("sales_invalid_team");
  nameByTeam.set(team.id,short(team.name,"班"));
 }
 for(const p of products){
  if(p?.companyId!==companyId)continue;
  if(!idOk(p.id)||catalog.has(p.id))throw Error("sales_duplicate_product");
  catalog.set(p.id,{product:p,plans:securePricing(p)});
 }
 const byMonth=new Map(),byTeam=new Map(),byProduct=new Map(),byPerson=new Map();
 const seenDoc=new Set(),seenDaily=new Set();
 let totalRecords=0,storedMismatchCount=0,historicalFallbacks=0;
 const fullYear=String(year)+"-";
 for(const r of records){
  if(r?.companyId!==companyId || typeof r.date!=="string"||!r.date.startsWith(fullYear))continue;
  if(!dateOk(r.date)||!idOk(r.id)||!idOk(r.uid)||!idOk(r.teamId))throw Error("sales_invalid_record");
  if(seenDoc.has(r.id)||seenDaily.has(r.uid+"|"+r.date))
    throw Error("sales_duplicate_daily_record");
  seenDoc.add(r.id);seenDaily.add(r.uid+"|"+r.date);totalRecords++;
  if(!r.results || typeof r.results!=="object")
    throw Error("sales_unreadable_results");
  // Old application versions also stored results as an array. Do not
  // discard or mutate these historic records when producing legal evidence.
  const entries=Array.isArray(r.results)?
    r.results.map((line,index)=>[String(index),line]):Object.entries(r.results);
  let dayCount=0,dayRevenue=0,recorded=0;
  for(const [key,line] of entries){
    if(!line || typeof line!=="object"||Array.isArray(line))throw Error("sales_invalid_line");
    const n=count(line.count);if(!n)continue;
    const productId=line.productId||key.split("__cb_")[0];
    const existing=catalog.get(productId);
    if(!existing)throw Error("sales_missing_product_master");
    const plans=existing.plans;
    const explicitCb=Number.isSafeInteger(line.cashback)&&line.cashback>=0;
    const plan=explicitCb?plans.find(p=>p.cashback===line.cashback):plans.length===1?plans[0]:null;
    const exact=plan?.revenuePerUnit;
    let priceSource="approved_master";
    let unit=exact;
    if(unit===null||unit===undefined){
      if(!Number.isSafeInteger(line.revenuePerUnit)||line.revenuePerUnit<0)
        throw Error("sales_price_not_verifiable");
      unit=line.revenuePerUnit;priceSource="stored_snapshot";historicalFallbacks++;
    }
    cash(unit);
    const amount=cash(n*unit);
    const originalUnit=line.revenuePerUnit;
    if(!Number.isSafeInteger(originalUnit)||originalUnit<0)
      throw Error("sales_missing_original_unit");
    const original=cash(n*originalUnit);
    dayCount=count(dayCount+n);dayRevenue=cash(dayRevenue+amount);recorded=cash(recorded+original);
    const month=r.date.slice(0,7);
    tally(byProduct,productId,{productId,name:short(existing.product.name,productId)},n,amount,original);
    // CB grouping preserves precisely which promotion produced each sale.
    const item=byProduct.get(productId);
    if(!item.breakdown)item.breakdown={};
    const cbKey=explicitCb?String(line.cashback):"unknown";
    if(!item.breakdown[cbKey])item.breakdown[cbKey]={count:0,revenue:0,source:priceSource};
    item.breakdown[cbKey].count+=n;item.breakdown[cbKey].revenue+=amount;
    if(item.breakdown[cbKey].source!==priceSource)item.breakdown[cbKey].source="mixed";
  }
  if(Number.isSafeInteger(r.totalCount)&&r.totalCount!==dayCount)
    throw Error("sales_record_count_mismatch");
  if(Number.isSafeInteger(r.totalRevenue)&&r.totalRevenue!==dayRevenue)
    storedMismatchCount++;
  const month=r.date.slice(0,7);
  tally(byMonth,month,{month},dayCount,dayRevenue,recorded);
  tally(byTeam,r.teamId,{teamId:r.teamId,name:short(r.teamNameSnapshot||
    nameByTeam.get(r.teamId),"旧班")},dayCount,dayRevenue,recorded);
  tally(byPerson,r.uid,{uid:r.uid,name:short(r.memberNameSnapshot||r.memberName||r.uid,"担当者")},dayCount,dayRevenue,recorded);
 }
 const monthly=Object.values(totals("month",byMonth));
 // Include all 12 months even when no registrations exist.
 const completeMonths=Array.from({length:12},(_,i)=>{
  const month=String(year)+"-"+String(i+1).padStart(2,"0");
  return monthly.find(m=>m.month===month)||{month,count:0,revenue:0,originalRevenue:0};
 });
 const recordCounts=completeMonths.reduce((a,x)=>a+x.count,0);
 const revenue=completeMonths.reduce((a,x)=>a+x.revenue,0);
 const originalRevenue=completeMonths.reduce((a,x)=>a+x.originalRevenue,0);
 if(!Number.isSafeInteger(revenue)||!Number.isSafeInteger(originalRevenue))
   throw Error("sales_revenue_overflow");
 return {
  schema:"sales-annual-report-v1",companyId,year:String(year),
  calculationBasis:"approved_current_master_with_recorded_unit_fallback",
  notes:"この報告書は作成時点の商材マスター単価で再計算。旧CB等は保存時単価にフォールバック。原本は無変更。",
  recordDocuments:totalRecords,dealCount:recordCounts,revenue,originalRevenue,
  recalculatedVsStored:revenue-originalRevenue,
  rowsWithStoredTotalMismatch:storedMismatchCount,legacyPricingFallbackLines:historicalFallbacks,
  months:completeMonths,teams:Object.values(totals("teamId",byTeam)),
  products:Object.values(totals("productId",byProduct)),
  people:Object.values(totals("uid",byPerson))
    .sort((a,b)=>b.revenue-a.revenue||String(a.uid).localeCompare(String(b.uid)))
 };
}
export function makeArchivePackage({report,records,products,teams,goals=[],createdAt}){
 if(!report||report.schema!=="sales-annual-report-v1"||
   ![records,products,teams,goals].every(Array.isArray)||
   typeof createdAt!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(createdAt))
   throw Error("invalid_archive");
 return {
  schema:"sales-annual-archive-v1",companyId:report.companyId,year:report.year,
  createdAt,report,
  // Original records are stored, never corrected here. Owner downloads
  // this JSON file as independent secondary backup.
  source:{
    records:records.filter(r=>r.companyId===report.companyId&&r.date?.startsWith(report.year+"-")),
    products:products.filter(x=>x.companyId===report.companyId),
    teams:teams.filter(x=>x.companyId===report.companyId),
    goals:goals.filter(x=>x.companyId===report.companyId && x.month?.startsWith(report.year+"-"))
  }
 };
}
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
export async function digestArchive(raw){
 return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)));
}
const objKey=(cid,year,hash)=>"v1/"+cid+"/"+year+"/"+hash+".json";
export async function writeImmutableArchive(bucket,bundle){
 if(!bucket?.put || !bucket?.get ||!idOk(bundle?.companyId)||!/^20\d{2}$/.test(bundle?.year))
   throw Error("archive_storage_unavailable");
 const raw=JSON.stringify(bundle);
 if(new TextEncoder().encode(raw).byteLength>12000000)
   throw Error("archive_too_large_for_safe_worker");
 const digest=await digestArchive(raw),key=objKey(bundle.companyId,bundle.year,digest);
 const stored=await bucket.put(key,raw,{
  onlyIf:{etagDoesNotMatch:"*"},
  httpMetadata:{contentType:"application/json",cacheControl:"private,no-store"},
  customMetadata:{sha256:digest,companyId:bundle.companyId,year:bundle.year,
    schema:bundle.schema}
 });
 if(!stored){
  // A preexisting immutable backup is fine ONLY if its full body matches.
  const existing=await bucket.get(key);
  if(!existing||await existing.text()!==raw)throw Error("archive_existing_hash_conflict");
 }
 const copy=await bucket.get(key);
 if(!copy)throw Error("archive_restore_unavailable");
 const restored=await copy.text();
 if(await digestArchive(restored)!==digest || restored!==raw)
   throw Error("archive_restore_checksum_failed");
 return {year:bundle.year,sha256:digest,recordDocuments:bundle.report.recordDocuments,
   sourceRecordDocuments:bundle.source.records.length,integrityVerified:true,
   independentCopyDownloaded:false};
}
export async function readImmutableArchive(bucket,companyId,year,digest){
 if(!bucket?.get||!idOk(companyId)||!/^20\d{2}$/.test(year)||
  !/^[a-f0-9]{64}$/.test(digest))throw Error("invalid_archive_read");
 const stored=await bucket.get(objKey(companyId,year,digest));
 if(!stored)return null;
 const raw=await stored.text();
 if(await digestArchive(raw)!==digest)throw Error("archive_checksum_mismatch");
 const bundle=JSON.parse(raw);
 if(bundle.companyId!==companyId||bundle.year!==year||
   bundle.schema!=="sales-annual-archive-v1")
   throw Error("archive_scope_mismatch");
 return {bundle,raw};
}
