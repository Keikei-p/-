"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readLegacyGate,activateLegacyGate,resolveLegacyInputPolicy,assertLegacyEditAllowed}=
 require("../functions-partner-workspace/legacy-publication-policy.cjs");
const categories=["NURO","YMMNP","SBMNP"],day="2026-11-07";
const publication={revision:1,productIds:["nuro"]};
const links={revision:1,links:[
 {productId:"nuro",category:"NURO",effectiveFrom:"2026-11-06"},
 {productId:"ym",category:"YMMNP",effectiveFrom:"2026-11-07"}
]};
const gate={revision:1,mode:"enforce",effectiveFrom:day};
const calc=(overrides={})=>resolveLegacyInputPolicy({
 gate,publication,links,date:day,categories,...overrides
});
test("no partner company opt-in means every original category remains available",()=>{
 assert.deepEqual(readLegacyGate(null),{revision:0,mode:"legacy",effectiveFrom:null});
 assert.deepEqual(calc({gate:null}),{mode:"legacy",effectiveFrom:null,blockedCategories:[]});
 assert.deepEqual(calc({gate:undefined}),{mode:"legacy",effectiveFrom:null,blockedCategories:[]});
});
test("company opt-in starts from explicit future day; pre-cutover history stays writable",()=>{
 const newGate=activateLegacyGate(null,day,0);
 assert.deepEqual(newGate,gate);
 assert.deepEqual(calc({date:"2026-11-06"}),{
  mode:"scheduled",effectiveFrom:day,blockedCategories:[]});
 assert.deepEqual(calc(),{mode:"enforce",effectiveFrom:day,blockedCategories:["YMMNP"]});
 assert.throws(()=>activateLegacyGate(gate,"2026-11-08",1),/INVALID/);
 assert.throws(()=>activateLegacyGate(null,day,1),/INVALID/);
});
test("only Owner-approved links and current publication ON control the category",()=>{
 assert.deepEqual(calc({publication:{revision:2,productIds:["nuro","ym"]}}).blockedCategories,[]);
 assert.deepEqual(calc({publication:{revision:3,productIds:[]}}).blockedCategories,["NURO","YMMNP"]);
 assert.deepEqual(calc({links:null}).blockedCategories,[]);
 assert.deepEqual(calc({date:"2026-11-07",links:{revision:1,links:[
  {productId:"ym",category:"YMMNP",effectiveFrom:"2026-11-08"}
 ]}}).blockedCategories,[]);
});
test("blocked new quantity or count correction is rejected, all other categories stay editable",()=>{
 const old={NURO:3,YMMNP:5,SBMNP:1};
 const changed={...old,NURO:4,SBMNP:2};
 assert.equal(assertLegacyEditAllowed({policy:calc(),previous:old,next:changed,categories}),true);
 assert.throws(()=>assertLegacyEditAllowed({policy:calc(),previous:old,
  next:{...old,YMMNP:6},categories}),/INVALID/);
 assert.throws(()=>assertLegacyEditAllowed({policy:calc(),previous:old,
  next:{...old,YMMNP:0},categories}),/INVALID/);
 // Existing historical 5 counts never become zero when hiding a field.
 assert.equal(assertLegacyEditAllowed({policy:calc(),previous:old,next:old,categories}),true);
 assert.equal(assertLegacyEditAllowed({policy:calc({gate:null}),previous:old,
  next:{...old,YMMNP:8},categories}),true);
});
test("blocked NURO CB amounts cannot change while the top-level count stays unchanged",()=>{
 const cb={NURO:{"0":1,"20000":2}};
 const changed={NURO:{"0":2,"20000":1}};
 const policy=calc({publication:{revision:2,productIds:[]}});
 assert.throws(()=>assertLegacyEditAllowed({policy,previous:{NURO:3,YMMNP:0,SBMNP:0},
  next:{NURO:3,YMMNP:0,SBMNP:0},previousCb:cb,nextCb:changed,categories}),/INVALID/);
 assert.equal(assertLegacyEditAllowed({policy,previous:{NURO:3,YMMNP:0,SBMNP:0},
  next:{NURO:3,YMMNP:0,SBMNP:0},previousCb:cb,nextCb:cb,categories}),true);
});
test("malformed policy, duplicate links or invalid calendar dates never silently permit input",()=>{
 assert.throws(()=>readLegacyGate({mode:"enforce",revision:1,effectiveFrom:"2026-02-30"}),/INVALID/);
 assert.throws(()=>calc({publication:{revision:1,productIds:["__proto__"]}}),/INVALID/);
 assert.throws(()=>calc({links:{revision:1,links:[
  {productId:"a",category:"NURO",effectiveFrom:day},
  {productId:"b",category:"NURO",effectiveFrom:day}
 ]}}),/INVALID/);
 assert.throws(()=>assertLegacyEditAllowed({policy:{mode:"enforce",
  blockedCategories:["UNRECOGNIZED"]},previous:{},next:{},categories}),/INVALID/);
});
