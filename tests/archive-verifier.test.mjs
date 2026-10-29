import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
const verifier=new URL("../scripts/verify-sales-archive.mjs",import.meta.url).pathname;
function sample(tamper=false){
 const payload={
  schemaVersion:1,period:"2026-10",periodMode:"month",company:{id:"c1"},
  summary:{dailyRecords:1,count:5,revenue:50000,warningCount:0},
  warnings:[],
  original:{records:[{id:"r1",companyId:"c1",date:"2026-10-27",totalCount:5,totalRevenue:50000,
   results:{p1:{productId:"p1",count:5,revenuePerUnit:10000}}}],
   products:[{id:"p1",companyId:"c1"}],
   teams:[{id:"team1",companyId:"c1"}],
   recordCorrections:[]}
 };
 const checksum=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
 if(tamper)payload.original.records[0].totalRevenue=90000;
 return {kind:"sales-archive",version:1,checksumAlgorithm:"SHA-256",checksum,payload};
}
test("offline archive is self-consistent and restorable in principle",()=>{
 const dir=mkdtempSync(join(tmpdir(),"sales-archive-"));
 try{
  const f=join(dir,"archive.json");writeFileSync(f,JSON.stringify(sample()));
  const result=spawnSync(process.execPath,[verifier,f],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/No Firestore write/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("tampered archive is rejected, without touching Firebase",()=>{
 const dir=mkdtempSync(join(tmpdir(),"sales-archive-"));
 try{
  const f=join(dir,"archive.json");writeFileSync(f,JSON.stringify(sample(true)));
  const result=spawnSync(process.execPath,[verifier,f],{encoding:"utf8"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/integrity failure/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
