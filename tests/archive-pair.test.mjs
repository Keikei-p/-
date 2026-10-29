import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const runner=resolve("scripts/verify-sales-archive-pair.mjs");
const generator=resolve("tests/generate-synthetic-archive.mjs");
const exec=(bin,...args)=>spawnSync(process.execPath,[bin,...args],{encoding:"utf8"});
function withFiles(fn){
 const root=mkdtempSync(join(tmpdir(),"sales-pair-test-"));
 try{
  mkdirSync(join(root,"diskA"));mkdirSync(join(root,"diskB"));
  const a=join(root,"diskA","archive.json");
  const b=join(root,"diskB","archive.json");
  const result=exec(generator,a);
  assert.equal(result.status,0,result.stderr);
  copyFileSync(a,b);
  return fn({a,b,root});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test("independent copies of valid synthetic source validate without production data",()=>withFiles(({a,b})=>{
 const x=exec(runner,a,b);
 assert.equal(x.status,0,x.stderr);
 assert.match(x.stdout,/PASS/);
 assert.match(x.stdout,/No Firebase access/);
}));
test("the same file path cannot masquerade as two backups",()=>withFiles(({a})=>{
 const x=exec(runner,a,a);
 assert.equal(x.status,1);
 assert.match(x.stderr,/同じ実体ファイル/);
}));
test("corrupted second copy prevents backup PASS",()=>withFiles(({a,b})=>{
 const src=JSON.parse(readFileSync(b,"utf8"));
 src.payload.original.records[0].results.p1.count=999;
 writeFileSync(b,JSON.stringify(src));
 const x=exec(runner,a,b);
 assert.equal(x.status,1);
 assert.match(x.stderr,/BLOCK/);
}));
test("different valid exports cannot be claimed to be identical copies",()=>withFiles(({a,b})=>{
 const src=JSON.parse(readFileSync(b,"utf8"));
 src.payload.exportedAt="2026-10-29T04:00:00.000Z";
 src.checksum=createHash("sha256").update(JSON.stringify(src.payload)).digest("hex");
 writeFileSync(b,JSON.stringify(src));
 const x=exec(runner,a,b);
 assert.equal(x.status,1);
 assert.match(x.stderr,/SHA-256/);
}));
