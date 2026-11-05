"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {readLinks,addLink,projectLinks}=require("../functions-partner-workspace/catalog-count-links.cjs");
const categories=["NURO","SBMNP","YMMNP","SB光・AIR","U-NEXT"];
const input={categories,publishedIds:["nuro_1","mnp_1"]};
test("unlinked master is private by default and cannot rewrite a saved count",()=>{
 assert.deepEqual(readLinks(null,categories),{revision:0,links:[]});
 assert.deepEqual(projectLinks(null,{...input,audience:"partner",date:"2026-11-04"}),
  {revision:0,links:[]});
});
test("new explicit category mapping starts only tomorrow and never changes old entries",()=>{
 const next=addLink({existing:null,productId:"nuro_1",category:"NURO",
  effectiveFrom:"2026-11-04",expectedRevision:0,...input});
 assert.deepEqual(next,{revision:1,links:[{
  productId:"nuro_1",category:"NURO",effectiveFrom:"2026-11-04"
 }]});
 assert.deepEqual(projectLinks(next,{...input,audience:"partner",date:"2026-11-03"}).links,[]);
 assert.equal(projectLinks(next,{...input,audience:"partner",date:"2026-11-04"}).links.length,1);
 assert.throws(()=>addLink({existing:next,productId:"nuro_1",category:"YMMNP",
  effectiveFrom:"2026-11-05",expectedRevision:1,...input}),/INVALID/);
});
test("one-to-one mappings cannot double-count combined legacy buckets",()=>{
 const first=addLink({existing:null,productId:"mnp_1",category:"SBMNP",
  effectiveFrom:"2026-11-04",expectedRevision:0,...input});
 assert.throws(()=>addLink({existing:first,productId:"nuro_1",category:"SBMNP",
  effectiveFrom:"2026-11-04",expectedRevision:1,...input}),/INVALID/);
 assert.throws(()=>addLink({existing:first,productId:"nuro_1",category:"NURO",
  effectiveFrom:"2026-11-04",expectedRevision:0,...input}),/INVALID/);
});
test("unpublished products cannot link and are redacted for partner view",()=>{
 const first=addLink({existing:null,productId:"nuro_1",category:"NURO",
  effectiveFrom:"2026-11-04",expectedRevision:0,...input});
 assert.deepEqual(projectLinks(first,{categories,publishedIds:[],
  audience:"partner",date:"2026-11-05"}).links,[]);
 assert.equal(projectLinks(first,{categories,publishedIds:[],
  audience:"hub"}).links.length,1);
 assert.throws(()=>addLink({existing:first,productId:"hidden",category:"YMMNP",
  effectiveFrom:"2026-11-04",expectedRevision:1,...input}),/INVALID/);
});
test("category settings cannot contain finance or arbitrary attributes",()=>{
 assert.throws(()=>readLinks({revision:1,links:[{
  productId:"nuro_1",category:"NURO",effectiveFrom:"2026-11-04",revenue:33000
 }]},categories),/INVALID/);
 assert.throws(()=>readLinks({revision:1,links:[{
  productId:"nuro_1",category:"NURO",effectiveFrom:"2026-02-30"
 }]},categories),/INVALID/);
 assert.throws(()=>addLink({existing:null,productId:"nuro_1",category:"売上",
  effectiveFrom:"2026-11-04",expectedRevision:0,...input}),/INVALID/);
});
test("server mapping endpoint never writes sales product, entries, audits, summary or price",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const exported=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
 const begin=service.indexOf(" async function setPartnerCountLink(request)");
 const end=service.indexOf(" async function approvedExtraCatalog",begin);
 assert.ok(begin>0&&end>begin,"count linking is isolated");
 const method=service.slice(begin,end);
 assert.match(method,/const live=await scope\(a\.uid,tx\)/);
 assert.match(method,/pub\.productIds/);
 assert.match(method,/effectiveFrom=new Date\(Date\.parse\(jstToday\(\)/);
 assert.match(method,/tx\.set\(ref,/);
 assert.doesNotMatch(method,/tx\.(?:update|set|delete)\((?:productRef|er|entryRef|summary|audit|totalSnap)\b/);
 assert.match(exported,/exports\.getPartnerCountLinks=onCall/);
 assert.match(exported,/exports\.setPartnerCountLink=onCall/);
 const legacySave=service.slice(service.indexOf(" async function submit(request)"));
 assert.match(legacySave,/const \{counts,total\}=validateCounts\(d\.counts\)/);
 assert.match(legacySave,/const priorCounts=oldSnap\.exists\?validateCounts\(old\.counts\)/);
 assert.match(legacySave,/if\(oldSnap\.exists\)tx\.update\(er,row\);else tx\.create\(er,/);
});


test("legacy count saver preserves original transaction/audits and adds only the reviewed OFF guard",()=>{
 const source=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const start=source.indexOf(" async function submit(request){");
 const end=source.indexOf(" return Object.freeze(",start);
 assert.ok(start>0&&end>start,"legacy count saver must remain isolated");
 const segment=source.slice(start,end);
 assert.equal(segment.length,6570,"reviewed legacy saver changed unexpectedly");
 assert.match(segment,/const \{counts,total\}=validateCounts\(d\.counts\)/);
 assert.match(segment,/const priorCounts=oldSnap\.exists\?validateCounts\(old\.counts\)/);
 assert.match(segment,/assertLegacyEditAllowed\(/);
 assert.match(segment,/legacyInputPolicy\(s\.hubId,s\.cid,date/);
 assert.match(segment,/if\(oldSnap\.exists\)tx\.update\(er,row\);else tx\.create\(er,/);
 assert.match(segment,/tx\.create\(audit,/);
 // FNV-1a over the original JavaScript UTF-16 code units, frozen from
 // release/nico-partner-compact-two-column-index-20261102.
 let h=2166136261;
 for(let i=0;i<segment.length;i++)
  h=Math.imul(h^segment.charCodeAt(i),16777619)>>>0;
 assert.equal(h.toString(16).padStart(8,"0"),"deb7d3f9",
  "Only the reviewed Firestore transaction publication guard may change the count saver");
});
