#!/usr/bin/env node
/**
 * Yearly archive closeout preflight. It NEVER accesses Firestore or deletes data.
 * Require one independently hashed monthly archive for every calendar month.
 */
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
const [year,...inputs]=process.argv.slice(2);
function fail(msg){throw Error("YEAR CLOSEOUT BLOCKED: "+msg);}
if(!/^\d{4}$/.test(String(year))||inputs.length!==12)fail("Exactly 12 monthly archive JSON filenames are required");
const byMonth=new Map(),recordIds=new Set();
let companyId=null,totalRecords=0,totalCount=0,totalRevenue=0,totalCorrections=0;
for(const input of inputs){
 const archive=JSON.parse(await readFile(resolve(input),"utf8"));
 if(archive.kind!=="sales-archive"||archive.version!==1||archive.checksumAlgorithm!=="SHA-256")fail("Unsupported archive type");
 const payload=archive.payload;
 if(createHash("sha256").update(JSON.stringify(payload)).digest("hex")!==archive.checksum)fail("A monthly archive checksum does not match");
 if(payload.periodMode!=="month"||typeof payload.period!=="string"||!payload.period.startsWith(year+"-"))fail("Archive has wrong period");
 if(byMonth.has(payload.period))fail("Duplicate month: "+payload.period);
 if(!companyId)companyId=payload.company?.id;
 if(!companyId||payload.company?.id!==companyId)fail("Archives belong to different companies");
 if(payload.warnings?.length||payload.summary?.warningCount)fail("Unresolved financial mismatch: "+payload.period);
 const records=payload.original?.records;
 const corrections=payload.original?.recordCorrections;
 if(!Array.isArray(records)||!Array.isArray(corrections))fail("Missing originals: "+payload.period);
 let monthlyCount=0,monthlyRevenue=0;
 for(const record of records){
  if(record.companyId!==companyId||typeof record.date!=="string"||!record.date.startsWith(payload.period+"-"))fail("Wrong company/date");
  if(!record.id||recordIds.has(record.id))fail("Duplicate or missing historical record ID");
  recordIds.add(record.id);
  const results=record.results&&typeof record.results==="object"?Object.values(record.results):record.productId?[record]:[];
  let recCount=0,recRevenue=0;
  for(const item of results){
   const count=Number(item.count),rate=Number(item.revenuePerUnit);
   if(item.revenuePerUnit==null||item.revenuePerUnit===""||!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(rate)||rate<0||!Number.isSafeInteger(count*rate))fail("Invalid preserved deal");
   recCount+=count;recRevenue+=count*rate;
  }
  if(recCount!==Number(record.totalCount??recCount)||recRevenue!==Number(record.totalRevenue??recRevenue))fail("Record detail mismatch");
  monthlyCount+=recCount;monthlyRevenue+=recRevenue;
 }
 if(records.length!==payload.summary?.dailyRecords||monthlyCount!==payload.summary?.count||monthlyRevenue!==payload.summary?.revenue)fail("Monthly report total mismatch");
 for(const correction of corrections){
  if(correction.companyId!==companyId||!correction.recordDate?.startsWith(payload.period+"-"))fail("Correction belongs to another company/month");
 }
 byMonth.set(payload.period,{records:records.length,count:monthlyCount,revenue:monthlyRevenue,corrections:corrections.length});
 totalRecords+=records.length;totalCount+=monthlyCount;totalRevenue+=monthlyRevenue;totalCorrections+=corrections.length;
}
for(let month=1;month<=12;month++){
 const key=year+"-"+String(month).padStart(2,"0");
 if(!byMonth.has(key))fail("Missing month: "+key);
}
const report={verification:"PASSED (OFFLINE ONLY)",companyId,year,months:12,
 totalDailyRecords:totalRecords,totalCount,totalRevenue,totalCorrections,
 monthly:Array.from(byMonth.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([period,data])=>({period,...data})),
 note:"This is not backup durability verification or a restored production snapshot. Never delete originals solely based on this report."};
process.stdout.write(JSON.stringify(report,null,2)+"\n");
