"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {ensureMonthlyIndex,isMonthlyIndex,ENDPOINT,FIELDS}=require("../scripts/restore-records-month-index.cjs");
const exact={name:"projects/sales-management-cc116/databases/(default)/collectionGroups/records/indexes/abc",queryScope:"COLLECTION",
 fields:[...FIELDS,{fieldPath:"__name__",order:"ASCENDING"}],state:"READY"};
test("only approved collection-scope records company/date index qualifies",()=>{
 assert(isMonthlyIndex(exact));
 assert(!isMonthlyIndex({...exact,queryScope:"COLLECTION_GROUP"}));
 assert(!isMonthlyIndex({...exact,fields:[FIELDS[1],FIELDS[0]]}));
 assert(!isMonthlyIndex({...exact,fields:[FIELDS[0],{fieldPath:"uid",order:"ASCENDING"},FIELDS[1]]}));
});
test("existing READY index causes zero writes and no polling",async()=>{
 const calls=[];
 const value=await ensureMonthlyIndex({request:async(method,url)=>{calls.push([method,url]);return {indexes:[exact]};},log:()=>{}});
 assert.equal(value,"READY");assert.equal(calls.length,1);assert.equal(calls[0][0],"GET");
});
test("missing index creates just one exact additive index and never deletes documents",async()=>{
 const calls=[];
 let created=false;
 const val=await ensureMonthlyIndex({request:async(method,url,payload)=>{
  calls.push({method,url,payload});
  if(method==="POST"){created=true;return {name:"projects/sales-management-cc116/databases/(default)/operations/111"};}
  return {indexes:created?[{...exact,state:"READY"}]:[]};
 },wait:async()=>{},polls:1,log:()=>{}});
 assert.equal(val,"READY");
 assert.equal(calls.filter(x=>x.method==="POST").length,1);
 assert.deepEqual(calls.filter(x=>x.method==="POST")[0].payload,{queryScope:"COLLECTION",fields:FIELDS});
 assert(calls.every(x=>x.method==="GET"||x.method==="POST"));
 assert(calls.every(x=>x.url.startsWith(ENDPOINT)));
});
test("CREATING index is not duplicated",async()=>{
 let calls=0;const log=[];
 const val=await ensureMonthlyIndex({request:async()=>{calls++;return {indexes:[{...exact,state:"CREATING"}]};},
 log:x=>log.push(x),polls:0});
 assert.equal(val,"CREATING");assert.equal(calls,1);
});
test("unknown error state and duplicate matching indexes stop without writes",async()=>{
 for(const list of [[{...exact,state:"ERROR"}],[exact,{...exact,name:exact.name+"2"}]]){
  await assert.rejects(ensureMonthlyIndex({request:async()=>({indexes:list}),log:()=>{}}),/INDEX_UNHEALTHY|DUPLICATE_MONTH_INDEXES/);
 }
});
test("index discovery follows pagination rather than incorrectly creating a duplicate",async()=>{
 const calls=[];
 const res=await ensureMonthlyIndex({request:async(method,url)=>{
  calls.push({method,url});
  return url.includes("pageToken")?{indexes:[exact]}:{indexes:[],nextPageToken:"token next"};
 },log:()=>{}});
 assert.equal(res,"READY");assert(calls.length===2&&calls.every(x=>x.method==="GET"));
});

// The GitHub runner installs firebase-admin under functions/node_modules only.
// The executable must resolve from that package directory, not repo/scripts.
test("runner resolves Firebase Admin from functions package directory",()=>{
 const {readFileSync}=require("node:fs");
 const {resolve}=require("node:path");
 const code=readFileSync(resolve(__dirname,"../scripts/restore-records-month-index.cjs"),"utf8");
 assert.match(code,/createRequire\(resolve\(__dirname,"\.\.\/functions\/package\.json"\)\)/);
 assert.match(code,/fromFunctions\("firebase-admin\/app"\)/);
 assert.doesNotMatch(code,/=require\("firebase-admin\/app"\)/);
});
