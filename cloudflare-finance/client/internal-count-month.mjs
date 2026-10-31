/**
 * Non-deployable, COUNT-ONLY monthly reader for a future secure NICO cutover.
 *
 * This module NEVER changes the currently deployed owner/main screen or its
 * financial calculation. It is deliberately OFF until the finance gateway,
 * access Rules, historical reconciliation and live login tests all pass.
 *
 * Reads every calendar day with the existing auth + snapshot-pinned paged
 * count-only API. A single missing/invalid day causes the WHOLE month to
 * fail closed. It never silently turns a missing page into zero or returns
 * half-month totals. Each day is individually snapshot-consistent; this is
 * NOT falsely described as one global month-wide Firestore snapshot.
 */
import {fetchVerifiedInternalCountDay} from "./internal-count-day.mjs";

const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const fail=code=>{throw Error("secure_count_month_"+code);};
const isObject=x=>x&&typeof x==="object"&&!Array.isArray(x);
const validId=x=>typeof x==="string"&&/^[A-Za-z0-9_:-]{1,128}$/.test(x);
const safeInt=x=>Number.isSafeInteger(x)&&x>=0;

function datesOfMonth(month){
  if(typeof month!=="string"||!MONTH.test(month))fail("invalid_month");
  const [y,m]=month.split("-").map(Number);
  if(y<2000||y>2100)fail("invalid_month");
  const count=new Date(Date.UTC(y,m,0)).getUTCDate();
  return Array.from({length:count},(_,i)=>month+"-"+String(i+1).padStart(2,"0"));
}
function catalogSignature(products){
  if(!Array.isArray(products))fail("catalog_invalid");
  const keyed=products.map(p=>{
    if(!isObject(p)||!validId(p.sourceId)||typeof p.name!=="string"||
      typeof p.active!=="boolean"||!Number.isSafeInteger(p.sortOrder))
      fail("catalog_invalid");
    return [p.sourceId,p.name,p.active,p.sortOrder];
  });
  keyed.sort((a,b)=>a[0].localeCompare(b[0]));
  if(new Set(keyed.map(x=>x[0])).size!==keyed.length)fail("duplicate_catalog");
  return JSON.stringify(keyed);
}
export async function fetchVerifiedInternalCountMonth({
  user,origin,gatewayUrl,month,enabled=false,fetcher=fetch,maxPagesPerDay=1000
}={}){
  // Validate before a token refresh or network call.
  if(enabled!==true)fail("cutover_disabled");
  const days=datesOfMonth(month);
  if(!Number.isInteger(maxPagesPerDay)||maxPagesPerDay<1||
     maxPagesPerDay>1000)fail("page_limit");

  let companyId="",baselineCatalog=null,products=[];
  let totalCount=0,totalPages=0;
  const records=[],lines=[],dailyReadTimes=Object.create(null);
  const recordIds=new Set(),lineIds=new Set();
  for(const day of days){
    // Sequential reads bound peak traffic and never launch 31 network
    // requests simultaneously. All daily validation happens in this function.
    const result=await fetchVerifiedInternalCountDay({
      user,origin,gatewayUrl,day,enabled:true,fetcher,
      maxPages:maxPagesPerDay
    });
    if(!isObject(result)||result.day!==day||!validId(result.companyId)||
      !safeInt(result.totalCount)||!Number.isSafeInteger(result.pages)||
      result.pages<1||typeof result.readTime!=="string"||
      !Array.isArray(result.records)||!Array.isArray(result.lines))
      fail("day_contract");
    if(companyId&&result.companyId!==companyId)fail("company_changed");
    companyId=result.companyId;

    const signature=catalogSignature(result.products);
    if(baselineCatalog===null){
      baselineCatalog=signature;
      products=result.products;
    }else if(signature!==baselineCatalog){
      // Catalog changed mid-request; never render mixed product names.
      fail("catalog_changed_reload");
    }
    let dailyTotal=0;
    for(const row of result.records){
      if(!isObject(row)||!validId(row.sourceId)||row.companyId!==companyId||
        row.date!==day||!safeInt(row.totalCount)||
        recordIds.has(row.sourceId))fail("duplicate_or_foreign_record");
      recordIds.add(row.sourceId);
      dailyTotal+=row.totalCount;
      if(!safeInt(dailyTotal))fail("overflow");
    }
    if(dailyTotal!==result.totalCount)fail("count_mismatch");
    for(const row of result.lines){
      if(!isObject(row)||!validId(row.sourceId)||
        !recordIds.has(row.recordId)||row.companyId!==companyId||
        row.date!==day||!safeInt(row.count)||lineIds.has(row.sourceId))
        fail("duplicate_or_foreign_line");
      lineIds.add(row.sourceId);
    }
    totalCount+=dailyTotal;
    totalPages+=result.pages;
    if(!safeInt(totalCount)||!safeInt(totalPages))fail("overflow");
    dailyReadTimes[day]=result.readTime;
    records.push(...result.records);
    lines.push(...result.lines);
  }
  // Only a fully verified month is returned, without revenue or prices.
  return Object.freeze({
    month,companyId,complete:true,daysVerified:days.length,
    snapshotScope:"per_day",dailyReadTimes,
    totalCount,totalPages,records,lines,products
  });
}
