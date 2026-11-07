"use strict";
// Synthetic only. No Firebase credentials or production calls.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {readLegacyGate,nextDay,activateLegacyGate,resolveLegacyPolicy,assertUnchangedBlocked}=
 require("../functions-partner-workspace/legacy-publication-policy.cjs");
const {makeLegacyPublicationOperations}=
 require("../functions-partner-workspace/legacy-publication-operations.cjs");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const linked={revision:1,links:[{productId:"prod-nuro",category:"NURO",effectiveFrom:"2026-11-07"}]};
const pub=ids=>({revision:1,productIds:ids});
const gate={revision:1,mode:"enforce",effectiveFrom:"2026-11-07"};
const amounts=n=>Object.fromEntries(KEYS.map(key=>[key,key==="NURO"?n:0]));
test("no company gate retains existing all-nine-input behavior without any migration",()=>{
 assert.deepEqual(readLegacyGate(null),{revision:0,mode:"legacy",effectiveFrom:null});
 assert.deepEqual(resolveLegacyPolicy({gate:null,publication:null,links:null,
  date:"2026-11-07",categories:KEYS}).blockedCategories,[]);
 assert.equal(nextDay("2026-11-06"),"2026-11-07");
 assert.equal(nextDay("2028-02-28"),"2028-02-29");
 assert.throws(()=>readLegacyGate({mode:"enforce",revision:2,effectiveFrom:"2026-11-07"}));
});
test("per-company next-day rollout changes only linked OFF categories and never the past",()=>{
 const before=resolveLegacyPolicy({gate,publication:pub([]),links:linked,
  date:"2026-11-06",categories:KEYS});
 const after=resolveLegacyPolicy({gate,publication:pub([]),links:linked,
  date:"2026-11-07",categories:KEYS});
 assert.equal(before.mode,"scheduled");
 assert.deepEqual(before.blockedCategories,[]);
 assert.deepEqual(after.blockedCategories,["NURO"]);
 assert.deepEqual(resolveLegacyPolicy({gate,publication:pub(["prod-nuro"]),
  links:linked,date:"2026-11-07",categories:KEYS}).blockedCategories,[]);
 assert.equal(assertUnchangedBlocked({policy:after,previous:amounts(7),
  next:amounts(7),categories:KEYS}),true);
 assert.throws(()=>assertUnchangedBlocked({policy:after,previous:amounts(7),
  next:amounts(8),categories:KEYS}));
 assert.throws(()=>assertUnchangedBlocked({policy:after,previous:amounts(7),
  next:amounts(0),categories:KEYS}));
 const another=amounts(7);another["U-NEXT"]=3;
 assert.equal(assertUnchangedBlocked({policy:after,previous:amounts(7),
  next:another,categories:KEYS}),true);
});
test("single irreversible activation document refuses stale, invalid or repeated approvals",()=>{
 assert.deepEqual(activateLegacyGate(null,"2026-11-07",0),gate);
 assert.throws(()=>activateLegacyGate(gate,"2026-11-07",0));
 assert.throws(()=>activateLegacyGate(null,"2026-11-07",1));
 assert.throws(()=>activateLegacyGate(null,"2026-11-34",0));
});
class Ref{
 constructor(db,p){this.db=db;this.path=p;this.id=p.split("/").at(-1);}
 collection(name){return new Collection(this.db,this.path+"/"+name);}
 async get(){const d=this.db.store.get(this.path);return {
  id:this.id,exists:d!==undefined,data:()=>d===undefined?undefined:structuredClone(d)};}
}
class Collection{
 constructor(db,p){this.db=db;this.path=p;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
}
class FakeDB{
 constructor(){this.store=new Map();this.writes=[];}
 collection(id){return new Collection(this,id);}
 put(p,v){this.store.set(p,structuredClone(v));}
 async runTransaction(fn){
  const pending=[];
  const tx={get:x=>x.get(),create:(ref,value)=>{
   if(this.store.has(ref.path))throw Error("already-exists");
   pending.push([ref.path,structuredClone(value)]);
  }};
  const result=await fn(tx);
  for(const [p,v] of pending){this.put(p,v);this.writes.push(p);}
  return result;
 }
}
function fixture(activationEnabled=false){
 const db=new FakeDB();
 db.put("partnerRelations/partner-a",{partnerCompanyId:"partner-a",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 db.put("companies/partner-a",{companyKind:"partner",hubCompanyId:"hub",active:true,name:"協力店A"});
 db.put("companies/hub/partnerCatalogSettings/countLinks",linked);
 db.put("companies/hub/partnerCatalogSettings/publication",pub([]));
 const auth=async req=>({uid:req.auth.uid});
 const scope=async uid=>uid==="owner"?
  {kind:"hub",cid:"hub",role:"owner"}:
  {kind:"partner",cid:"partner-a",hubId:"hub",role:"leader"};
 const ops=makeLegacyPublicationOperations({db,actor:auth,scope,
  collection:(cid,name)=>db.collection("companies").doc(cid).collection(name),
  fail:code=>{let err=Error(code||"permission-denied");err.code=code;throw err;},
  FieldValue:{serverTimestamp:()=>123},jstToday:()=>"2026-11-06",KEYS,
  activationEnabled:()=>activationEnabled});
 return {db,ops,request:(who,data)=>({auth:{uid:who},data})};
}
test("read-only Owner gate state cannot reveal pricing, emails or originals",async()=>{
 const {db,ops,request}=fixture();
 const before=structuredClone([...db.store]);
 const status=await ops.getLegacyGate(request("owner",{partnerCompanyId:"partner-a"}));
 assert.deepEqual(status.mappedCategories,["NURO"]);
 assert.equal(status.armed,false);
 assert.equal(status.activationAvailable,false);
 assert.doesNotMatch(JSON.stringify(status),/revenue|unitPrice|cashback|email|password/);
 assert.deepEqual([...db.store],before);
 await assert.rejects(ops.getLegacyGate(request("member",{partnerCompanyId:"partner-a"})));
 await assert.rejects(ops.getLegacyGate(request("owner",{partnerCompanyId:"foreign"})));
});
test("activation is hard-disabled even for authenticated Owner, leaving counts untouched",async()=>{
 const {db,ops,request}=fixture();
 const before=structuredClone([...db.store]);
 await assert.rejects(ops.activateLegacyCountGate(request("owner",{
  partnerCompanyId:"partner-a",expectedRevision:0,
  confirmation:"ACTIVATE_NEXT_DAY_LEGACY_CATEGORY_FILTER"})),e=>e.code==="failed-precondition");
 assert.deepEqual([...db.store],before);
 assert.deepEqual(db.writes,[]);
});
test("synthetic staged activation writes only one setting and guarded subsequent quantities",async()=>{
 const {db,ops,request}=fixture(true);
 const old=structuredClone([...db.store]);
 const saved=await ops.activateLegacyCountGate(request("owner",{
  partnerCompanyId:"partner-a",expectedRevision:0,
  confirmation:"ACTIVATE_NEXT_DAY_LEGACY_CATEGORY_FILTER"}));
 assert.equal(saved.effectiveFrom,"2026-11-07");
 assert.deepEqual(db.writes,["companies/partner-a/partnerCatalogSettings/legacyPublicationGate"]);
 for(const [p,v] of old)assert.deepEqual(db.store.get(p),v);
 const partner={kind:"partner",cid:"partner-a",hubId:"hub"};
 const previous=await ops.policyFor(partner,"2026-11-06");
 const future=await ops.policyFor(partner,"2026-11-07");
 assert.equal(previous.mode,"scheduled");
 assert.deepEqual(future.blockedCategories,["NURO"]);
 ops.assertEdit(previous,amounts(3),amounts(4));
 assert.throws(()=>ops.assertEdit(future,amounts(3),amounts(4)),e=>e.code==="failed-precondition");
 assert.equal(ops.assertEdit(future,amounts(3),amounts(3)),undefined);
 await assert.rejects(ops.activateLegacyCountGate(request("owner",{
  partnerCompanyId:"partner-a",expectedRevision:0,
  confirmation:"ACTIVATE_NEXT_DAY_LEGACY_CATEGORY_FILTER"})));
});
test("existing UI preserves all nine inputs and never exposes a destructive activation button",()=>{
 const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
 const service=fs.readFileSync(path.join(__dirname,"..","functions-partner-workspace","service.cjs"),"utf8");
 const index=fs.readFileSync(path.join(__dirname,"..","functions-partner-workspace","index.js"),"utf8");
 assert.match(html,/const policy=snap\.legacyPublication\|\|\{mode:"legacy",blockedCategories:\[\]\}/);
 assert.match(html,/if\(frozen&&previous===0\)label\.hidden=true/);
 assert.match(html,/if\(frozen\)input\.readOnly=true/);
 assert.match(html,/input\.dataset\.countKey=key/);
 assert.match(html,/legacyGateStatus|gateStatus/);
 assert.match(service,/legacyPublication=await legacyPolicyFor\(s,date\)/);
 assert.match(service,/const inputPolicy=await legacyPolicyFor\(fresh,date,tx\)/);
 assert.match(service,/assertLegacyEdit\(inputPolicy,prior,counts\)/);
 assert.match(index,/NICO_LEGACY_COUNT_GATE_ACTIVATION==="approved"/);
 assert.match(index,/exports\.getPartnerLegacyCountGate=onCall/);
 assert.match(index,/exports\.activatePartnerLegacyCountGate=onCall/);
 assert.doesNotMatch(html,/const activatePartnerLegacyCountGate = httpsCallable/);
});
