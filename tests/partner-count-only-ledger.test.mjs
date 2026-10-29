import test from "node:test";
import assert from "node:assert/strict";
import {
 stageNewPartnerCount,stageCorrectPartnerCount,readCurrentPartnerPublication
} from "../partner/count-only-ledger.mjs";
const principal={
 serverVerified:true,tokenVerified:true,userActive:true,memberActive:true,
 companyActive:true,companyKind:"partner",accessKind:"partner",
 partnerRelationApproved:true,canSubmit:true,
 uid:"member1",companyId:"partnerA",teamIds:["team1"]
};
const catalog=[
 {catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
 {catalogId:"custom:partnerA:own",ownerCompanyId:"partnerA",active:true,visibility:"private"}
];
const input={date:"2026-10-29",teamId:"team1",status:"submitted",
 lines:[{catalogId:"shared:hub:NURO",count:2},
  {catalogId:"custom:partnerA:own",count:3}]};
function makeStore(){
 const map=new Map();
 let attemptedCommits=0;
 const clone=x=>x===undefined?undefined:structuredClone(x);
 const store={
   ref(path){
     if(typeof path!=="string"||!/^(partnerCountRecords|partnerCountRevisions|partnerCountPublicRevisions|partnerCountCorrections|partnerCountIdempotencyKeys)\/[a-zA-Z0-9_:-]+$/.test(path))
       throw Error("Blocked unexpected storage path");
     return {path};
   },
   async runTransaction(task){
     const pending=[];
     const tx={
       async get(ref){
         const data=map.get(ref.path);
         return {exists:data!==undefined,data:()=>clone(data)};
       },
       create(ref,value){pending.push({op:"create",path:ref.path,value:clone(value)});},
       update(ref,value){pending.push({op:"update",path:ref.path,value:clone(value)});}
     };
     const result=await task(tx);
     // Failure preconditions are checked BEFORE committing anything.
     const shadow=new Map(map);
     for(const action of pending){
       if(action.op==="create"&&shadow.has(action.path))throw Error("create conflict");
       if(action.op==="update"&&!shadow.has(action.path))throw Error("update missing");
       shadow.set(action.path,action.op==="update"?
         {...shadow.get(action.path),...action.value}:action.value);
     }
     attemptedCommits++;
     map.clear();for(const [path,value]of shadow)map.set(path,value);
     return result;
   }
 };
 return {store,map,get commitCount(){return attemptedCommits;}};
}
const trusted=()=>({principal:{...principal},catalog:structuredClone(catalog),
 memberName:"協力店A",teamName:"1班"});
const reader=async()=>({
 serverVerified:true,tokenVerified:true,active:true,
 allowedCompanyIds:["partnerA"]
});
const idempotencyKey="repeat_once_20261029";
function makeArgs(db){
 return {store:db.store,loadTrustedContext:trusted,request:input,
   mintRecordId:async()=>"pc_ledgerA",idempotencyKey};
}
test("new record is atomic across private current + immutable revision + publication + idempotency",async()=>{
 const db=makeStore();
 const result=await stageNewPartnerCount(makeArgs(db));
 assert.deepEqual(result,{status:"registered",recordId:"pc_ledgerA",version:1,
   ownCount:5,sharedCount:2});
 assert.equal(db.map.size,4);
 assert(db.map.has("partnerCountRecords/partnerA_pc_ledgerA"));
 assert(db.map.has("partnerCountRevisions/partnerA_pc_ledgerA_v000001"));
 assert(db.map.has("partnerCountPublicRevisions/partnerA_pc_ledgerA_v000001"));
 const publication=await readCurrentPartnerPublication({
  store:db.store,companyId:"partnerA",recordId:"pc_ledgerA",loadAuthorizedReader:reader
 });
 assert.equal(publication.version,1);
 assert.equal(publication.header.totalCount,2);
 assert.equal(publication.lines.length,1);
 assert.equal(publication.lines[0].count,2);
 const publicJson=JSON.stringify(publication);
 assert(!publicJson.includes("custom:partnerA:own"));
 for(const term of ["revenue","unitPrice","cashback","totalRevenue","pricingOptions"])
   assert(!publicJson.includes(term));
 assert.equal(db.commitCount,2);
});
test("same retry key returns same ID without a second record",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 const size=db.map.size;
 const result=await stageNewPartnerCount({...makeArgs(db),
  mintRecordId:async()=>{throw Error("should not mint on idempotent retry");}});
 assert.equal(result.status,"already_registered");
 assert.equal(result.recordId,"pc_ledgerA");
 assert.equal(db.map.size,size);
 await assert.rejects(stageNewPartnerCount({...makeArgs(db),
  request:{...input,lines:[{catalogId:"shared:hub:NURO",count:100}]} }),
  /Count-only transaction refused/);
 assert.equal(db.map.size,size);
});
test("corrections append history and change only the new partner count pointer",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 const first=structuredClone(db.map.get("partnerCountRevisions/partnerA_pc_ledgerA_v000001"));
 const firstPublic=structuredClone(db.map.get("partnerCountPublicRevisions/partnerA_pc_ledgerA_v000001"));
 const changed={...input,lines:[{catalogId:"shared:hub:NURO",count:4},
  {catalogId:"custom:partnerA:own",count:1}]};
 const result=await stageCorrectPartnerCount({store:db.store,loadTrustedContext:trusted,
  request:changed,recordId:"pc_ledgerA",expectedVersion:1,
  correctionId:"pcfix_edit001"});
 assert.equal(result.status,"corrected");
 assert.equal(result.version,2);
 assert.equal(result.ownCount,5);
 assert.equal(result.sharedCount,4);
 assert.equal(db.map.size,7);
 assert.deepEqual(db.map.get("partnerCountRevisions/partnerA_pc_ledgerA_v000001"),first);
 assert.deepEqual(db.map.get("partnerCountPublicRevisions/partnerA_pc_ledgerA_v000001"),firstPublic);
 assert.equal(db.map.get("partnerCountCorrections/partnerA_pcfix_edit001").beforeSharedCount,2);
 const read=await readCurrentPartnerPublication({
  store:db.store,companyId:"partnerA",recordId:"pc_ledgerA",loadAuthorizedReader:reader
 });
 assert.equal(read.version,2);
 assert.equal(read.header.totalCount,4);
 assert.equal(read.lines[0].count,4);
 assert.equal(db.map.get("partnerCountRecords/partnerA_pc_ledgerA").teamId,"team1");
});
test("stale edit, reused correction ID, no-op and different member all leave storage unchanged",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 const changed={...input,lines:[{catalogId:"shared:hub:NURO",count:3}]};
 await stageCorrectPartnerCount({store:db.store,loadTrustedContext:trusted,
  request:changed,recordId:"pc_ledgerA",expectedVersion:1,correctionId:"pcfix_1st"});
 const before=JSON.stringify([...db.map]);
 for(const args of [
  {request:changed,expectedVersion:1,correctionId:"pcfix_repeat"},
  {request:changed,expectedVersion:2,correctionId:"pcfix_repeat"},
  {request:input,expectedVersion:2,correctionId:"pcfix_1st"},
  {request:changed,expectedVersion:2,correctionId:"pcfix_1st",
    loadTrustedContext:async()=>({...(trusted()),principal:{...principal,uid:"other"}})}
 ]){
  await assert.rejects(stageCorrectPartnerCount({
   store:db.store,loadTrustedContext:trusted,request:input,
   recordId:"pc_ledgerA",expectedVersion:2,correctionId:"pcfix_fresh",
   ...args
  }),/Count-only/);
  assert.equal(JSON.stringify([...db.map]),before);
 }
});
test("private-only correction removes all public count visibility without deleting old revisions",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 const privateOnly={...input,
  lines:[{catalogId:"custom:partnerA:own",count:6}]};
 await stageCorrectPartnerCount({store:db.store,loadTrustedContext:trusted,
  request:privateOnly,recordId:"pc_ledgerA",expectedVersion:1,
  correctionId:"pcfix_privacy"});
 const current=await readCurrentPartnerPublication({
  store:db.store,companyId:"partnerA",recordId:"pc_ledgerA",loadAuthorizedReader:reader
 });
 assert.equal(current.published,false);
 assert.equal(current.header,null);
 assert.deepEqual(current.lines,[]);
 assert(db.map.has("partnerCountPublicRevisions/partnerA_pc_ledgerA_v000001"));
 assert(db.map.has("partnerCountPublicRevisions/partnerA_pc_ledgerA_v000002"));
});
test("server rejection or injected transaction write failure cannot create half a record",async()=>{
 const db=makeStore();
 await assert.rejects(stageNewPartnerCount({...makeArgs(db),
   loadTrustedContext:async()=>({...trusted(),principal:{
    ...principal,memberActive:false
   }})
 }),/Count-only/);
 assert.equal(db.map.size,0);
 await stageNewPartnerCount(makeArgs(db));
 const before=JSON.stringify([...db.map]);
 await assert.rejects(stageNewPartnerCount({
  ...makeArgs(db),idempotencyKey:"another_unique_20261029"
 }),/Count-only transaction refused/);
 assert.equal(JSON.stringify([...db.map]),before);
});
test("publication rejects missing version or corrupted private counts without changing data",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 const pubRef="partnerCountPublicRevisions/partnerA_pc_ledgerA_v000001";
 const current="partnerCountRecords/partnerA_pc_ledgerA";
 const pub=db.map.get(pubRef);
 db.map.delete(pubRef);
 await assert.rejects(readCurrentPartnerPublication({
  store:db.store,companyId:"partnerA",recordId:"pc_ledgerA",loadAuthorizedReader:reader
 }),/Count-only/);
 db.map.set(pubRef,pub);
 db.map.set(current,{...db.map.get(current),latestPublicRevision:2});
 await assert.rejects(readCurrentPartnerPublication({
  store:db.store,companyId:"partnerA",recordId:"pc_ledgerA",loadAuthorizedReader:reader
 }),/Count-only/);
});
test("only append-only custom collections are ever touched; old finance source remains absent",async()=>{
 const db=makeStore();
 const result=await stageNewPartnerCount(makeArgs(db));
 assert.equal(result.status,"registered");
 const paths=[...db.map.keys()];
 assert(paths.every(x=>/^(partnerCountRecords|partnerCountRevisions|partnerCountPublicRevisions|partnerCountCorrections|partnerCountIdempotencyKeys)\//.test(x)));
 assert(paths.every(x=>!/^records\/|^products\/|^recordCorrections\/|^revenueGoals\//.test(x)));
});

test("revoked reader cannot use a browser-controlled company ID to read published counts",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 const before=JSON.stringify([...db.map]);
 for(const attempt of [
  async()=>({...await reader(),allowedCompanyIds:[]}),
  async()=>({...await reader(),active:false}),
  async()=>({...await reader(),serverVerified:false}),
  async()=>({...await reader(),tokenVerified:false}),
  null
 ]){
  await assert.rejects(readCurrentPartnerPublication({
   store:db.store,companyId:"partnerA",recordId:"pc_ledgerA",
   loadAuthorizedReader:attempt
  }),/Count-only transaction refused/);
  assert.equal(JSON.stringify([...db.map]),before);
 }
});
test("revoked membership blocks even idempotent retried register",async()=>{
 const db=makeStore();
 await stageNewPartnerCount(makeArgs(db));
 await assert.rejects(stageNewPartnerCount({...makeArgs(db),
  loadTrustedContext:async()=>({...trusted(),principal:{
   ...principal,memberActive:false
  }})
 }),/Count-only transaction refused/);
 assert.equal(db.map.size,4);
});
