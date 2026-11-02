"use strict";
// This feature must NEVER change the original sales prices, revenue or saved
// quantity validation. Snapshots below were taken from the live release source
// at release/nico-partner-compact-two-column-index-20261102 (not generated data).
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
function hashPart(begin,end){
 const a=html.indexOf(begin),b=html.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,"Missing original pricing boundary: "+begin);
 const part=html.slice(a,b);
 let h=2166136261;
 for(let i=0;i<part.length;i++)
  h=Math.imul(h^part.charCodeAt(i),16777619)>>>0;
 return {len:part.length,fnv:h.toString(16).padStart(8,"0")};
}
test("original owner unit-price display is unchanged",()=>{
 assert.deepEqual(hashPart("function pricingOptionsText(","function readPricingOptions("),
  {len:3828,fnv:"ac52f50a"});
});
test("new result pricing verification remains unchanged",()=>{
 assert.deepEqual(hashPart("function verifyNewRecordPricing(",
  "function verifyChangedRecordPricing("),{len:1713,fnv:"49664f50"});
});
test("edited result pricing verification remains unchanged",()=>{
 assert.deepEqual(hashPart("function verifyChangedRecordPricing(",
  "function validateFinancialRecordForSave("),{len:1675,fnv:"4c75f9f2"});
});
test("new partner link never mutates money-bearing catalog records",()=>{
 const service=fs.readFileSync(path.join(__dirname,"..",
  "functions-partner-workspace","service.cjs"),"utf8");
 const first=service.indexOf(" async function setPartnerCountLink(request)");
 const last=service.indexOf(" const checkTeam=async",first);
 assert.ok(first>0&&last>first);
 const method=service.slice(first,last);
 assert.doesNotMatch(method,/tx\.(?:set|update|delete)\((?:productRef|entryRef|summaryRef|audit)/);
 assert.match(method,/tx\.set\(ref,/);
});
