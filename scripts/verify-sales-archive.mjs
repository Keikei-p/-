#!/usr/bin/env node
/**
 * OFFLINE ONLY. Validates that an exported JSON has the source documents needed
 * for a future staging restore. Does NOT connect to Firebase or delete anything.
 */
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
const filename=process.argv[2];
if(!filename){console.error("Usage: node scripts/verify-sales-archive.mjs <saved-archive.json>");process.exit(2);}
function die(msg){console.error("FAIL: "+msg);process.exit(1);}
const src=JSON.parse(await readFile(resolve(filename),"utf8"));
if(src.kind!=="sales-archive"||src.version!==1||src.payload?.schemaVersion!==1)die("Unknown archive format/version");
if(src.checksumAlgorithm!=="SHA-256")die("Unsupported checksum type");
const actual=createHash("sha256").update(JSON.stringify(src.payload),"utf8").digest("hex");
if(actual!==src.checksum)die("Archive JSON integrity failure");
const {payload:p}=src,original=p.original||{},companyId=p.company?.id;
if(typeof companyId!=="string"||!companyId)die("Company ID is missing");
if(!Array.isArray(original.records)||!Array.isArray(original.products)||!Array.isArray(original.teams)||!Array.isArray(original.recordCorrections))die("Original source records are incomplete");
if(original.records.length!==p.summary?.dailyRecords)die("Summary daily-record count differs from saved source");
if((p.warnings||[]).length||(p.summary?.warningCount||0)>0)die("Unresolved financial-data validation warnings must be reviewed");
let count=0,amount=0;
const ids=new Set();
for(const r of original.records){
 if(!r||r.companyId!==companyId||!r.id||ids.has(r.id))die("Duplicate record ID or wrong company");
 ids.add(r.id);
 if(typeof r.date!=="string"||!r.date.startsWith(p.period+"-"))die("Date outside archive period");
 let countOne=0,amountOne=0;
 const entries=r.results&&typeof r.results==="object"?Object.values(r.results):r.productId?[r]:[];
 for(const item of entries){
  const n=Number(item.count),raw=item.revenuePerUnit;
  if(raw==null||raw==="")die("Missing preserved unit price");
  const rate=Number(raw);
  if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(rate)||rate<0||!Number.isSafeInteger(n*rate))die("Invalid count or saved price");
  countOne+=n;amountOne+=n*rate;
 }
 if(countOne!==Number(r.totalCount??countOne)||amountOne!==Number(r.totalRevenue??amountOne))die("Original daily record totals do not match line detail");
 count+=countOne;amount+=amountOne;
}
if(count!==p.summary.count||amount!==p.summary.revenue)die("Archive aggregates do not reconcile with original documents");
for(const [name,items] of [["products",original.products],["teams",original.teams],["recordCorrections",original.recordCorrections]]){
 const seen=new Set();
 for(const item of items)if(item.companyId!==companyId||!item.id||seen.has(item.id))die("Wrong company or duplicate source ID in "+name);else seen.add(item.id);
}
console.log("PASS archive checksum, company scope, source IDs, counts and saved financial totals");
console.log("Records:",original.records.length,"Count:",count,"Revenue:",amount,"Period:",p.period);
console.log("No Firestore write, import, restore, or deletion was performed.");
