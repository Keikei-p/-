import test from "node:test";
import assert from "node:assert/strict";
import {buildAnnualSalesReport,makeArchivePackage,writeImmutableArchive,
 readImmutableArchive,digestArchive} from "../src/sales-archive.mjs";
import worker from "../src/index.js";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
const cid="companyA";
const products=[
 {id:"tok",companyId:cid,name:"とくするでんき",
  pricingOptions:[{cashback:0,revenuePerUnit:10000}]},
 {id:"ever",companyId:cid,name:"エバーグリーン",
  pricingOptions:[{cashback:0,revenuePerUnit:20000}]},
 {id:"nuro",companyId:cid,name:"NURO光",
  pricingOptions:[{cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:22500}]},
 {id:"other",companyId:"companyB",name:"他社のみ",revenue:999999}
];
const teams=[
 {id:"first",companyId:cid,name:"1班",active:true},
 {id:"second",companyId:cid,name:"2班",active:false},
 {id:"foreign",companyId:"companyB",name:"社外班"}
];
const rec=(uid,date,teamId,results,extra={})=>({
 id:uid+"_"+date,companyId:cid,uid,date,teamId,teamNameSnapshot:teamId==="second"?"旧2班":"1班",
 memberNameSnapshot:uid,totalCount:Object.values(results).reduce((v,i)=>v+i.count,0),
 results,...extra
});
const records=[
 rec("one","2025-10-21","first",{a:{productId:"tok",count:5,cashback:0,revenuePerUnit:0}},
   {totalRevenue:0}),
 rec("two","2025-10-22","second",{b:{productId:"ever",count:5,cashback:0,revenuePerUnit:16000}},
   {totalRevenue:80000}),
 rec("three","2025-10-23","second",{
  n1:{productId:"nuro",count:2,cashback:0,revenuePerUnit:25000},
  n2:{productId:"nuro",count:3,cashback:20000,revenuePerUnit:22500}
 },{totalRevenue:117500}),
 {...rec("foreigner","2025-10-23","foreign",{c:{productId:"other",count:100,revenuePerUnit:999999}}),companyId:"companyB"},
 rec("one","2026-01-04","first",{a:{productId:"tok",count:200,cashback:0,revenuePerUnit:0}})
];
const args={year:"2025",companyId:cid,records,products,teams};
function fakeBucket(){
 const store=new Map();
 return {store,
  async put(key,raw,options){
   if(options.onlyIf?.etagDoesNotMatch==="*"&&store.has(key))return null;
   store.set(key,raw);
   return {key};
  },
  async get(key){return store.has(key)?{text:async()=>store.get(key)}:null;}
 };
}
test("2025 annual report mirrors validated current CB tariffs without rewriting 0/old historical prices",()=>{
 const original=JSON.stringify([records,products,teams]);
 const result=buildAnnualSalesReport(args);
 assert.equal(result.schema,"sales-annual-report-v1");
 assert.equal(result.dealCount,15);
 assert.equal(result.recordDocuments,3);
 assert.equal(result.revenue,267500);
 assert.equal(result.originalRevenue,197500);
 assert.equal(result.recalculatedVsStored,70000);
 assert.equal(result.months.length,12);
 assert.equal(result.months.find(x=>x.month==="2025-10").revenue,267500);
 assert.equal(result.months.find(x=>x.month==="2025-11").revenue,0);
 assert.equal(result.teams.length,2);
 assert.equal(result.teams.find(x=>x.teamId==="second").count,10);
 assert.equal(result.products.find(x=>x.productId==="nuro").breakdown["20000"].revenue,67500);
 assert.equal(result.rowsWithStoredTotalMismatch,2);
 assert.equal(result.legacyPricingFallbackLines,0);
 assert.equal(JSON.stringify([records,products,teams]),original);
});
test("Unknown CB with recorded historical unit is visibly flagged; missing unit refuses archive",()=>{
 const fallback=rec("legacy","2025-11-01","second",{
  cb:{productId:"nuro",count:1,cashback:15555,revenuePerUnit:12345}
 });
 const result=buildAnnualSalesReport({...args,records:[...records,fallback]});
 assert.equal(result.revenue,279845);
 assert.equal(result.legacyPricingFallbackLines,1);
 const invalid={...fallback,results:{cb:{productId:"nuro",count:1,cashback:15555}}};
 assert.throws(()=>buildAnnualSalesReport({...args,records:[...records,invalid]}),/sales_price_not_verifiable/);
});
test("Archive rejects duplicate daily IDs, corrupt count, missing catalog and other-company only datasets",()=>{
 const dup=rec("one","2025-10-21","first",{a:{productId:"tok",count:1,cashback:0,revenuePerUnit:0}});
 assert.throws(()=>buildAnnualSalesReport({...args,records:[...records,dup]}),/sales_duplicate_daily_record/);
 const countErr={...records[0],totalCount:17};
 assert.throws(()=>buildAnnualSalesReport({...args,records:[countErr]}),/sales_record_count_mismatch/);
 const missing={...records[0],results:{bad:{productId:"ghost",count:1,revenuePerUnit:4}},totalCount:1};
 assert.throws(()=>buildAnnualSalesReport({...args,records:[missing]}),/sales_missing_product_master/);
 const onlyForeign=buildAnnualSalesReport({...args,records:records.filter(x=>x.companyId!=="companyA")});
 assert.equal(onlyForeign.revenue,0);
 assert.equal(onlyForeign.recordDocuments,0);
});
test("R2 immutable package is checksum-verified and contains original records for future restore",async()=>{
 const report=buildAnnualSalesReport(args);
 const pkg=makeArchivePackage({...args,report,goals:[{companyId:cid,month:"2025-10",teamId:"first",targetRevenue:1000000}],
  createdAt:"2026-10-28T01:00:00.000Z"});
 assert.equal(pkg.source.records.length,3);
 assert.equal(pkg.source.records[0].results.a.revenuePerUnit,0);
 assert.equal(pkg.source.products.length,3);
 assert.equal(pkg.source.teams.length,2);
 assert.equal(pkg.source.goals.length,1);
 const db=fakeBucket(),put=await writeImmutableArchive(db,pkg);
 assert.equal(put.integrityVerified,true);
 assert.equal(put.independentCopyDownloaded,false);
 assert.equal(put.recordDocuments,3);
 assert.equal(put.sourceRecordDocuments,3);
 assert.equal(db.store.size,1);
 const restore=await readImmutableArchive(db,cid,"2025",put.sha256);
 assert.deepEqual(restore.bundle,pkg);
 await writeImmutableArchive(db,pkg);
 assert.equal(db.store.size,1,"repeat save does not overwrite existing object");
 assert.equal(await digestArchive(restore.raw),put.sha256);
 const key=[...db.store.keys()][0];
 db.store.set(key,db.store.get(key).replace('"revenue":267500','"revenue":267501'));
 await assert.rejects(readImmutableArchive(db,cid,"2025",put.sha256),/archive_checksum_mismatch/);
 assert.equal(await readImmutableArchive(db,"companyB","2025",put.sha256),null);
});
test("Missing bucket or too-large backup returns explicit safe refusal",async()=>{
 const r=buildAnnualSalesReport(args),pkg=makeArchivePackage({...args,report:r,createdAt:"2026-10-28T00:00:00Z"});
 await assert.rejects(writeImmutableArchive(null,pkg),/archive_storage_unavailable/);
 const big={...pkg,large:"x".repeat(12100000)};
 await assert.rejects(writeImmutableArchive(fakeBucket(),big),/archive_too_large_for_safe_worker/);
});
test("Owner financial archive endpoint is default-off and never usable without Firebase auth",async()=>{
 const base="https://example.com";
 for(const path of ["/v1/owner-annual-report?year=2025",
   "/v1/owner-annual-archive?year=2025",
   "/v1/owner-annual-archive-list?year=2025"]){
  let response=await worker.fetch(new Request(base+path),{});
  assert.equal(response.status,503);
  response=await worker.fetch(new Request(base+path),{
   FIREBASE_PROJECT_ID:"sales-management-cc116",
   FINANCE_GATEWAY_ENABLED:"enabled",
   FINANCE_COST_APPROVAL:"OWNER_APPROVED_BLAZE_COSTS",
   FINANCE_ARCHIVE_APPROVAL:"OWNER_APPROVED_ARCHIVE_READS"
  });
  assert.equal(response.status,401);
 }
});
test("Owner report UI offers print-PDF, CSV, R2 verified JSON without unsafe innerHTML",()=>{
 const html=readFileSync(new URL("../preview/owner.html",import.meta.url),"utf8");
 const toml=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 assert.match(html,/id="annualPanel"/);
 assert.match(html,/id="printAnnual"/);
 assert.match(html,/id="downloadAnnualCsv"/);
 assert.match(html,/id="storeAnnual"/);
 assert.match(html,/id="annualArchives"/);
 assert.match(html,/\/v1\/owner-annual-report/);
 assert.match(html,/\/v1\/owner-annual-archive/);
 assert.match(html,/Object\.keys|\.textContent/);
 assert.match(html,/csvSafe/);
 assert.doesNotMatch(html,/R2_PUBLIC|\.innerHTML\s*=/);
 assert.match(toml,/FINANCE_ARCHIVE_APPROVAL = "NOT_APPROVED"/);
 assert.match(toml,/FINANCE_ARCHIVE_WRITE_APPROVAL = "NOT_APPROVED"/);
 const begin=html.indexOf('<script type="module">'),end=html.indexOf("</script>",begin);
 assert.ok(begin>=0&&end>begin);
 const dir=mkdtempSync(join(tmpdir(),"sales-archive-"));
 try{
  const file=join(dir,"owner.mjs");
  writeFileSync(file,html.slice(begin+'<script type="module">'.length,end));
  execFileSync(process.execPath,["--check",file]);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
