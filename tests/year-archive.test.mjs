import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
const runner=new URL("../scripts/verify-sales-year.mjs",import.meta.url).pathname;
function exercise(transform){
 const folder=mkdtempSync(join(tmpdir(),"sales-year-"));
 try{
  const paths=[];
  for(let i=1;i<=12;i++){
   const period="2026-"+String(i).padStart(2,"0");
   const payload={schemaVersion:1,company:{id:"test-company"},period,periodMode:"month",
    summary:{dailyRecords:1,count:1,revenue:10000,warningCount:0},warnings:[],
    original:{records:[{id:"record-"+period,companyId:"test-company",date:period+"-08",
     totalCount:1,totalRevenue:10000,results:{p1:{productId:"p1",count:1,revenuePerUnit:10000}}}],
     recordCorrections:[]}};
   if(transform)transform(payload,i);
   const a={kind:"sales-archive",version:1,checksumAlgorithm:"SHA-256",
    checksum:createHash("sha256").update(JSON.stringify(payload)).digest("hex"),payload};
   const file=join(folder,i+".json");writeFileSync(file,JSON.stringify(a));paths.push(file);
  }
  return spawnSync(process.execPath,[runner,"2026",...paths],{encoding:"utf8"});
 }finally{rmSync(folder,{recursive:true,force:true});}
}
test("12 clean months form a consistent year",()=>{
 const run=exercise();assert.equal(run.status,0,run.stderr);
 const data=JSON.parse(run.stdout);assert.equal(data.totalDailyRecords,12);assert.equal(data.totalRevenue,120000);
});
test("duplicate month refuses annual closeout",()=>{
 const run=exercise((p,i)=>{if(i===2){p.period="2026-01";p.original.records[0].date="2026-01-08";}});
 assert.notEqual(run.status,0);assert.match(run.stderr,/Duplicate month/);
});
test("cross-company archive refuses annual closeout",()=>{
 const run=exercise((p,i)=>{if(i===2){p.company.id="other";p.original.records[0].companyId="other";}});
 assert.notEqual(run.status,0);assert.match(run.stderr,/different companies/);
});
test("wrong total refuses annual closeout",()=>{
 const run=exercise((p,i)=>{if(i===3)p.summary.revenue=3;});
 assert.notEqual(run.status,0);assert.match(run.stderr,/Monthly report total mismatch/);
});
