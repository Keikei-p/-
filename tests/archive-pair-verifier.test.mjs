import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,copyFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const work=fileURLToPath(new URL("../",import.meta.url));
const runner=fileURLToPath(new URL("../scripts/verify-sales-archive-pair.mjs",import.meta.url));
const single=fileURLToPath(new URL("../scripts/verify-sales-archive.mjs",import.meta.url));

function archive(period="2026",mode="year"){
 const year=period.slice(0,4),m=mode==="year"?"01":period.slice(5,7);
 const date=year+"-"+m+"-05";
 const source={id:"row-"+date,companyId:"test-company",uid:"tester",date,
   totalCount:2,totalRevenue:12000,
   results:{electric:{productId:"electric",count:2,revenuePerUnit:6000}}};
 const payload={schemaVersion:1,company:{id:"test-company"},period,periodMode:mode,
   summary:{dailyRecords:1,count:2,revenue:12000,warningCount:0},
   warnings:[],rows:[{date,recordId:source.id,count:2,amount:12000}],
   original:{records:[source],products:[{id:"electric",companyId:"test-company"}],
     teams:[{id:"team1",companyId:"test-company"}],recordCorrections:[]}};
 return packageArchive(payload);
}
function packageArchive(payload){
 return {kind:"sales-archive",version:1,checksumAlgorithm:"SHA-256",
   checksum:createHash("sha256").update(JSON.stringify(payload)).digest("hex"),payload};
}
function exercise(fn){
 const folder=mkdtempSync(join(tmpdir(),"sales-pair-"));
 try {
   const a=join(folder,"a.json"),b=join(folder,"b.json");
   const orig=archive();
   writeFileSync(a,JSON.stringify(orig,null,2));
   copyFileSync(a,b);
   return fn({a,b,folder,orig,run:(...paths)=>spawnSync(process.execPath,[runner,...paths],{cwd:work,encoding:"utf8",timeout:30000}),
     validate:path=>spawnSync(process.execPath,[single,path],{cwd:work,encoding:"utf8",timeout:30000})});
 }finally{rmSync(folder,{recursive:true,force:true});}
}
test("a full calendar-year archive is accepted as valid original data",()=>exercise(({a,validate})=>{
 const out=validate(a);
 assert.equal(out.status,0,out.stderr);
 assert.match(out.stdout,/PASS archive/);
}));
test("a complete month archive is also accepted",()=>exercise(({a,validate})=>{
 writeFileSync(a,JSON.stringify(archive("2026-10","month")));
 assert.equal(validate(a).status,0);
}));
test("both independent files must pass source integrity and match byte for byte",()=>exercise(({a,b,run})=>{
 const out=run(a,b);
 assert.equal(out.status,0,out.stderr);
 assert.match(out.stdout,/PASS/);
 assert.match(out.stdout,/No Firebase access, restore, or deletion/);
}));
test("same pathname is not a second backup",()=>exercise(({a,run})=>{
 const out=run(a,a);
 assert.notEqual(out.status,0);
 assert.match(out.stderr,/BLOCK/);
}));
test("two distinct files with different valid data cannot be treated as matching backup",()=>exercise(({a,b,run})=>{
 const other=archive();
 other.payload.original.records[0].results.electric.revenuePerUnit=7000;
 other.payload.original.records[0].totalRevenue=14000;
 other.payload.rows[0].amount=14000;
 other.payload.summary.revenue=14000;
 other.checksum=createHash("sha256").update(JSON.stringify(other.payload)).digest("hex");
 writeFileSync(b,JSON.stringify(other));
 const out=run(a,b);
 assert.notEqual(out.status,0);
 assert.match(out.stderr,/SHA-256/);
}));
test("a corrupt checksum and wrong stored price are blocked",()=>exercise(({a,b,run})=>{
 const changed=JSON.parse(readFileSync(b,"utf8"));
 changed.payload.original.records[0].totalRevenue=1;
 writeFileSync(b,JSON.stringify(changed));
 const out=run(a,b);
 assert.notEqual(out.status,0);
 assert.match(out.stderr,/BLOCK/);
}));
test("wrong year and invalid February date are blocked even with recomputed checksum",()=>exercise(({a,validate})=>{
 for(const date of ["2025-12-05","2026-02-30"]){
   const file=archive("2026","year");
   file.payload.original.records[0].date=date;
   file.payload.rows[0].date=date;
   file.checksum=createHash("sha256").update(JSON.stringify(file.payload)).digest("hex");
   writeFileSync(a,JSON.stringify(file));
   const out=validate(a);
   assert.notEqual(out.status,0,"date must be refused: "+date);
   assert.match(out.stderr,/Date outside archive period/);
 }
}));
test("report line must match preserved original and annual stored amount",()=>exercise(({a,validate})=>{
 const file=archive("2026","year");
 file.payload.rows[0].amount=13000;
 file.checksum=createHash("sha256").update(JSON.stringify(file.payload)).digest("hex");
 writeFileSync(a,JSON.stringify(file));
 const result=validate(a);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/report lines/);
}));

test("archives with missing original totals are rejected instead of inferring them",()=>exercise(({a,validate})=>{
 const file=archive("2026","year");
 delete file.payload.original.records[0].totalRevenue;
 file.checksum=createHash("sha256").update(JSON.stringify(file.payload)).digest("hex");
 writeFileSync(a,JSON.stringify(file));
 const result=validate(a);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Original daily record totals/);
}));
test("false per-person reports are blocked even when the company grand total matches",()=>exercise(({a,validate})=>{
 const file=archive("2026","year");
 const second=structuredClone(file.payload.original.records[0]);
 second.id="second-record";second.uid="second-person";second.date="2026-12-10";
 file.payload.original.records.push(second);
 file.payload.summary.dailyRecords=2;
 file.payload.summary.count=4;
 file.payload.summary.revenue=24000;
 file.payload.rows=[
  {date:"2026-01-05",recordId:"row-2026-01-05",count:1,amount:6000},
  {date:"2026-12-10",recordId:"second-record",count:3,amount:18000}
 ];
 file.checksum=createHash("sha256").update(JSON.stringify(file.payload)).digest("hex");
 writeFileSync(a,JSON.stringify(file));
 const out=validate(a);
 assert.notEqual(out.status,0);
 assert.match(out.stderr,/Archive report lines differ/);
}));
