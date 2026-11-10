"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {redactCashbackTiers}=require("../functions-partner-workspace/count-only-response.cjs");
test("partner shared rankings omit monetary cashback tier keys recursively without changing source",()=>{
 const source={scope:"shared_counts_only",people:[{name:"担当者",totalCount:3,
  counts:{NURO:3},cbCounts:{NURO:{"0":1,"60000":2}}}],
  teams:[{totalCount:3,cbCounts:{NURO:{"60000":2}}}],
  direct:{totalCount:5,people:[{totalCount:5,previousCbCounts:{NURO:{"80000":1}}}]}};
 const before=JSON.stringify(source),safe=redactCashbackTiers(source);
 assert.equal(safe.people[0].counts.NURO,3);
 assert.equal(safe.people[0].totalCount,3);
 assert.equal(safe.teams[0].totalCount,3);
 assert.equal(safe.direct.totalCount,5);
 assert.doesNotMatch(JSON.stringify(safe),/cbCounts|previousCbCounts|60000|80000/);
 assert.equal(JSON.stringify(source),before);
 assert.notEqual(safe.people[0],source.people[0]);
});
