"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
function source(name){
 let i=html.indexOf("function "+name+"(");
 assert.ok(i>=0,"required production function "+name+" must exist");
 if(html.slice(i-6,i)==="async ")i-=6;
 const end=html.indexOf("\n}",i);
 assert.ok(end>i,"function "+name+" must have an extractable end");
 return html.slice(i,end+2);
}
function app(deps={}){
 const ctx=vm.createContext(deps);
 vm.runInContext([
  "recordConflict","isPersistedRecordCountConsistent","persistDailyRecord"
 ].map(source).join("\n"),ctx);
 return ctx;
}
function sandbox(current){
 const writes=[],audits=[];
 let stored=current?structuredClone(current):null;
 const ref={id:"synthetic-sale"};
 const db={};
 const deps={
  db,
  query:()=>({}),
  where:()=>({}),
  recordsCollectionQuery:()=>({}),
  getDocsFromServer:async()=>({size:stored?1:0,docs:stored?[{id:ref.id}]:[]}),
  recordRevision:()=>"v1",
  runTransaction:async(_db,fn)=>fn({
   get:async()=>({id:ref.id,exists:()=>stored!==null,data:()=>structuredClone(stored)}),
   set:(...args)=>writes.push(args)
  })
 };
 return {app:app(deps),writes,audits,ref,db,
  replace:v=>{stored=v?structuredClone(v):null;},
  read:()=>structuredClone(stored)};
}
const base={companyId:"internal",uid:"test-person",date:"2026-11-05",
 totalCount:2,totalRevenue:90000,
 results:{a:{count:2,revenuePerUnit:45000}},
 createdByUid:"owner",createdAt:"original-time"};
const replacement={companyId:"internal",uid:"test-person",date:"2026-11-05",
 totalCount:2,totalRevenue:90000,results:{a:{count:2,revenuePerUnit:45000}}};

test("all historic count formats fail closed except exact checked nonnegative totals",()=>{
 const {isPersistedRecordCountConsistent:valid}=app();
 assert.equal(valid(base),true);
 assert.equal(valid({...base,totalCount:"2",results:{a:{count:"2"}}}),true);
 assert.equal(valid({...base,totalCount:0,results:{}}),true);
 for(const old of [
  {...base,results:{a:{count:2},orphan:{count:1}}},
  {...base,totalCount:3},
  {...base,totalCount:" "},
  {...base,totalCount:null},
  {...base,results:[]},
  {...base,results:null},
  {...base,results:{a:{}}},
  {...base,results:{a:{count:-1}}},
  {...base,results:{a:{count:1.5}}},
  {...base,results:{a:{count:"2 "}}},
  {...base,results:{a:{count:false}}},
  {...base,results:{a:{count:Number.MAX_SAFE_INTEGER},b:{count:1}}}
 ])assert.equal(valid(old),false,"invalid historic record must be rejected");
});

test("existing mismatched record cannot be silently edited or invent an audit row",async()=>{
 const old={...base,results:{...base.results,orphan:{count:1,revenuePerUnit:0}}};
 const box=sandbox(old),original=JSON.stringify(box.read());
 await assert.rejects(box.app.persistDailyRecord(box.ref,replacement,{id:box.ref.id},"v1",
  ()=>box.audits.push("correction")),e=>e?.code==="record-conflict"&&
  e.message.includes("総件数と商材別件数"));
 assert.equal(box.writes.length,0);
 assert.equal(box.audits.length,0);
 assert.equal(JSON.stringify(box.read()),original);
});

test("valid old record and first-ever new record keep original atomic save behavior",async()=>{
 const box=sandbox(base);
 await box.app.persistDailyRecord(box.ref,replacement,{id:box.ref.id},"v1",
  txn=>{box.audits.push("correction");txn.set({id:"synthetic-audit"},{kind:"correction"});});
 assert.equal(box.writes.length,2);
 assert.equal(box.audits.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(box.writes[0][2])),{
  mergeFields:Object.keys(replacement)
 });
 assert.deepEqual(JSON.parse(JSON.stringify(box.writes[0][1])),replacement);
 const fresh=sandbox(null);
 await fresh.app.persistDailyRecord(fresh.ref,replacement,null,null);
 assert.equal(fresh.writes.length,1);
 assert.equal(fresh.audits.length,0);
});

test("stale edit and duplicate person/day still abort before any save",async()=>{
 const box=sandbox(base);
 await assert.rejects(box.app.persistDailyRecord(box.ref,replacement,{id:box.ref.id},"stale"),
  e=>e?.code==="record-conflict");
 assert.equal(box.writes.length,0);
 const missing=sandbox(null);
 missing.replace(base);
 await assert.rejects(missing.app.persistDailyRecord(missing.ref,replacement,null,null),
  e=>e?.code==="record-conflict");
 assert.equal(missing.writes.length,0);
});
