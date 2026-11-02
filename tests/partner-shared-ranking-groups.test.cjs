"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {decodeGroups,saveGroups,groupPersonalScores}=require("../functions-partner-workspace/shared-ranking-groups.cjs");
const valid={allowedProducts:["p1","p2"],categories:["NURO","SBMNP","YMMNP","U-NEXT"]};
test("server defaults to empty shared groups, never destroys local-only old settings",()=>{
 assert.deepEqual(decodeGroups(null,valid),{revision:0,groups:[]});
});
test("explicit owner group is saved with optimistic locking and identical IDs",()=>{
 const groups=[{id:"group_1",name:"乗り換え丸件",keys:["legacy:SBMNP","legacy:YMMNP"]}];
 const saved=saveGroups(null,groups,0,valid);
 assert.deepEqual(saved,{revision:1,groups});
 assert.throws(()=>saveGroups(saved,groups,0,valid),/SHARED_RANKING/);
});
test("reject unsupported legacy category, unpublished id, duplicate keys and price titles",()=>{
 const call=x=>decodeGroups({revision:1,groups:x},valid);
 assert.throws(()=>call([{id:"a",name:"料金 2000円",keys:["legacy:NURO"]}]),/SHARED_RANKING/);
 assert.throws(()=>call([{id:"a",name:"NURO",keys:["legacy:JPY"]}]),/SHARED_RANKING/);
 assert.throws(()=>call([{id:"a",name:"NURO",keys:["id:private"]}]),/SHARED_RANKING/);
 assert.throws(()=>call([{id:"a",name:"A",keys:["legacy:NURO"]},{id:"b",name:"B",keys:["legacy:NURO"]}]),/SHARED_RANKING/);
});
test("group aggregates verified direct and partner per-person category counts, not sales",()=>{
 const groups=[{id:"mnp",name:"乗り換え丸件",keys:["legacy:SBMNP","legacy:YMMNP"]}];
 const result=groupPersonalScores(groups,[
  {key:"direct1",name:"直営A",counts:{SBMNP:3,YMMNP:2},companyName:"直営"},
  {key:"partner1",name:"協力店B",counts:{SBMNP:2,YMMNP:5},companyName:"協力店B"}
 ],{categories:valid.categories});
 assert.deepEqual(result,[{id:"mnp",name:"乗り換え丸件",complete:true,members:[
  {rank:1,name:"協力店B",companyName:"協力店B",count:7},
  {rank:2,name:"直営A",companyName:"直営",count:5}]}]);
 assert.doesNotMatch(JSON.stringify(result),/revenue|price|cashback|email/);
});
test("unmapped product ID does not invent a name-based mapping or score",()=>{
 const groups=[{id:"one",name:"NURO",keys:["id:p1"]}];
 assert.deepEqual(groupPersonalScores(groups,[],{categories:valid.categories}),[
  {id:"one",name:"NURO",complete:false,members:[]}
 ]);
});
test("published product ID and explicitly selected legacy category count once",()=>{
 const groups=[{id:"linked",name:"NURO",keys:["id:p1","legacy:NURO"]}];
 const scores=groupPersonalScores(groups,[{key:"u1",name:"A",companyName:"直営",
  counts:{NURO:4}}],{categories:valid.categories});
 assert.deepEqual(scores,[{id:"linked",name:"NURO",complete:true,
  members:[{rank:1,name:"A",companyName:"直営",count:4}]}]);
});
test("backend only stores groups in private settings and no legacy financial rows",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const api=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
 assert.match(service,/async function getPartnerRankingGroups\(/);
 assert.match(service,/async function setPartnerRankingGroups\(/);
 assert.match(service,/const fresh=await scope\(a.uid,tx\)/);
 assert.match(service,/partnerRankingSettings/);
 assert.match(service,/groupPersonalScores\(sharedConfig.groups/);
 assert.match(api,/exports\.getPartnerRankingGroups=onCall/);
 assert.match(api,/exports\.setPartnerRankingGroups=onCall/);
});
