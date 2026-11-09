"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {ranked,jointCountRankings}=require("../functions-partner-workspace/count-only-rankings.cjs");
test("competition ties are 1,1,3 and never money ordered",()=>{
 assert.deepEqual(ranked([{name:"B",totalCount:4},{name:"A",totalCount:4},{name:"C",totalCount:1}]).map(x=>x.rank),[1,1,3]);
});
test("company, team and personal standings are count-only, with direct included",()=>{
 const result=jointCountRankings({
  companies:[{name:"協力店A",totalCount:3,peopleVerified:true,revenue:1000000}],
  teams:[{companyName:"協力店A",name:"1班",totalCount:3,revenue:30000}],
  people:[{companyName:"協力店A",name:"担当A",totalCount:3,unitPrice:999}],
  direct:{totalCount:4,peopleVerified:true,teams:[{name:"2班",totalCount:4}],
   people:[{name:"担当B",totalCount:4}]}
 });
 assert.deepEqual(result.companies.map(x=>x.count),[4,3]);
 assert.deepEqual(result.teams.map(x=>x.name),["直営 / 2班","協力店A / 1班"]);
 assert.deepEqual(result.people.map(x=>x.count),[4,3]);
 assert.equal(result.peopleComplete,true);
 assert.doesNotMatch(JSON.stringify(result),/revenue|unitPrice|1000000|30000|999/);
});
test("unverified direct people excluded and completeness flagged",()=>{
 const result=jointCountRankings({companies:[],teams:[],people:[],
  direct:{totalCount:1,peopleVerified:false,teams:[],people:[{name:"推定",totalCount:1}]}});
 assert.equal(result.people.length,0);assert.equal(result.peopleComplete,false);
});
test("invalid counts fail closed",()=>assert.throws(()=>ranked([{name:"x",totalCount:-1}])));
