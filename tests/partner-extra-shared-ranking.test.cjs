"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {projectExtraRankDocs}=require("../functions-partner-workspace/extra-rank-projection.cjs");
const {groupPersonalScores}=require("../functions-partner-workspace/shared-ranking-groups.cjs");
const day="2026-11-03";
const doc=(id,counts,overrides={})=>({id:day+"__"+id,data:()=>({
 companyId:"partner",hubCompanyId:"hub",date:day,staffId:id,version:1,
 totalCount:Object.values(counts).reduce((a,b)=>a+b,0),counts,
 staffNameSnapshot:"担当A",teamIdSnapshot:"teamA",...overrides
})});
const project=(docs,opts={})=>projectExtraRankDocs(docs,{
 hubId:"hub",cid:"partner",date:day,publishedIds:["solar","water"],
 linkedIds:["legacyId"],...opts
});
test("published extra products remain count-only; old/depublished quantities are retained in total",()=>{
 const projected=project([doc("staff1",{solar:3,water:2,archived:7})]);
 assert.deepEqual(projected,[{staffId:"staff1",staffNameSnapshot:"担当A",
  teamIdSnapshot:"teamA",totalCount:12,extraCounts:{solar:3,water:2},
  archivedCount:7}]);
 assert.doesNotMatch(JSON.stringify(projected),/price|revenue|cashback|email|commission/i);
});
test("different staff IDs never merge, same product ranks across original group UI",()=>{
 const rows=project([doc("a",{solar:4}),doc("b",{solar:7})]);
 const groups=[{id:"shared",name:"太陽光",keys:["id:solar"]}];
 const people=rows.map(x=>({key:x.staffId,name:x.staffId,companyName:"協力店",
  counts:{NURO:0},extraCounts:x.extraCounts}));
 people.push({key:"direct",name:"直営",companyName:"直営",counts:{NURO:3}});
 const result=groupPersonalScores(groups,people,{categories:["NURO"],extraVerifiedIds:["solar","water"]});
 assert.deepEqual(result[0].members.map(x=>[x.name,x.count,x.rank]),[
  ["b",7,1],["a",4,2],["直営",0,3]
 ]);
});
test("original nine categories and additional product both count once in one group",()=>{
 const groups=[{id:"mix",name:"合算",keys:["legacy:NURO","id:legacyId","id:solar"]}];
 const people=[{key:"u",name:"A",counts:{NURO:2},extraCounts:{solar:3}}];
 const result=groupPersonalScores(groups,people,{categories:["NURO"],
  productLinks:[{productId:"legacyId",category:"NURO"}],extraVerifiedIds:["solar"]});
 assert.equal(result[0].members[0].count,5);
});
test("unverified additional product ID cannot silently produce 0 or partial ranks",()=>{
 const groups=[{id:"missing",name:"未確定",keys:["legacy:NURO","id:unknown"]}];
 assert.deepEqual(groupPersonalScores(groups,[{name:"A",counts:{NURO:2}}],
  {categories:["NURO"],extraVerifiedIds:["solar"]}),
  [{id:"missing",name:"未確定",complete:false,members:[]}]);
});
test("duplicate, corrupted and linked-legacy extra amounts fail closed",()=>{
 assert.throws(()=>project([doc("a",{solar:2}),doc("a",{solar:3})]),/UNVERIFIED/);
 assert.throws(()=>project([doc("a",{legacyId:2})]),/UNVERIFIED/);
 assert.throws(()=>project([doc("a",{solar:2},{totalCount:999})]),/UNVERIFIED/);
 assert.throws(()=>project([doc("a",{solar:2},{hubCompanyId:"another"})]),/UNVERIFIED/);
 assert.throws(()=>project([doc("a",{solar:2},{teamIdSnapshot:""})]),/UNVERIFIED/);
 assert.throws(()=>project([doc("a",{solar:2},{staffNameSnapshot:"価格500円"})]),/UNVERIFIED/);
});
test("service reads separate ledger, validates company/date and uses the canonical shared rank response",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const index=fs.readFileSync(require.resolve("../index.html"),"utf8");
 assert.match(service,/projectExtraRankDocs\(extraSnaps\.docs/);
 assert.match(service,/partnerAdditionalCountEntries"\)\.where\("date","==",date\)/);
 assert.match(service,/member\.totalCount\+=extra\.totalCount/);
 assert.match(service,/companyExtras\+=extra\.totalCount/);
 assert.match(service,/additionalTotalCount,?categories:KEYS/);
 assert.match(service,/extraVerifiedIds/);
 assert.match(index,/productTotals\.set\("追加商材（協力店）",response\.additionalTotalCount\)/);
 assert.match(index,/ownerJointProductMode/);
});
