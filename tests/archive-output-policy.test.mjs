import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {archiveExportPolicy} from "../archive-output-policy.mjs";

const records=[{id:"record1",date:"2026-10-27"}];
const rows=[{recordId:"record1",count:5,amount:50000}];
const check=o=>archiveExportPolicy({
 warnings:[],rows,records,companyVerified:true,...o
});
test("clean saved-price records allow PDF CSV and JSON evidence",()=>{
 const p=check({});
 assert.equal(p.canExportPdf,true);
 assert.equal(p.canExportCsv,true);
 assert.equal(p.canExportEvidenceJson,true);
 assert.equal(p.isVerifiedFinancialReport,true);
});
test("historical unit-price mismatch blocks finalized PDF and CSV but retains evidence JSON",()=>{
 const p=check({warnings:["実績record1：明細売上と保存売上が不一致"]});
 assert.equal(p.canExportPdf,false);assert.equal(p.canExportCsv,false);
 assert.equal(p.canExportEvidenceJson,true);
 assert.equal(p.isVerifiedFinancialReport,false);
 assert(p.issueCount>0);
});
test("missing, negative, overflow or noninteger financial data blocks finalized reports",()=>{
 for(const bad of [
  [{recordId:"record1",count:5,amount:null}],
  [{recordId:"record1",count:5,amount:NaN}],
  [{recordId:"record1",count:5,amount:-1}],
  [{recordId:"record1",count:"5",amount:50000}],
  [{recordId:"record1",count:1.5,amount:50000}],
  [{recordId:"record1",count:Number.MAX_SAFE_INTEGER,amount:1},
   {recordId:"record1",count:1,amount:1}],
  []
 ]){
  const p=check({rows:bad});
  assert.equal(p.canExportPdf,false);
  assert.equal(p.canExportCsv,false);
  assert.equal(p.canExportEvidenceJson,true);
 }
});
test("missing owner verification or invalid schema blocks all export state",()=>{
 for(const bad of [
  {companyVerified:false},{warnings:"none"},{rows:null},
  {records:null},{warnings:[{invalid:"structure"}]}
 ])assert.throws(()=>check(bad),/Archive source validation required/);
});
test("historical report UI runs this policy before enabling any output button",()=>{
 const source=readFileSync(new URL("../sales-archive.js",import.meta.url),"utf8");
 assert.match(source,/archiveExportPolicy\(\{warnings,rows,records,companyVerified:true\}\)/);
 assert.match(source,/archiveExportPolicy\(\{\s*warnings:saved.warnings,rows:saved.rows/);
 assert.match(source,/\$\("archivePdf"\)\.disabled=!policy\.canExportPdf/);
 assert.match(source,/\$\("archiveCsv"\)\.disabled=!policy\.canExportCsv/);
 assert.match(source,/\$\("archiveJson"\)\.disabled=!policy\.canExportEvidenceJson/);
 assert(!source.includes("outputButtons.forEach(id=>$(id).disabled=false)"));
});
