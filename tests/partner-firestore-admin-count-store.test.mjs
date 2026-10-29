import test from "node:test";
import assert from "node:assert/strict";
import {makePartnerCountAdminStore} from "../partner/firestore-admin-count-store.mjs";
import {stageNewPartnerCount,stageCorrectPartnerCount,readCurrentPartnerPublication}
 from "../partner/count-only-ledger.mjs";

function mockAdmin(){
 const documents=new Map([["users/partnerMember",{uid:"partnerMember",active:true}]]);
 let commits=0;
 const clone=x=>structuredClone(x);
 return {
  documents,
  get commits(){return commits;},
  doc(path){return {path};},
  async runTransaction(job){
   const writes=[];
   const raw={
    async get(ref){
     const data=documents.get(ref.path);
     return {exists:data!==undefined,data:()=>clone(data)};
    },
    create(ref,data){writes.push({action:"create",path:ref.path,data:clone(data)});},
    update(ref,data){writes.push({action:"update",path:ref.path,data:clone(data)});}
   };
   const result=await job(raw);
   const after=new Map(documents);
   for(const w of writes){
    if(w.action==="create"&&after.has(w.path))throw Error("existing document");
    if(w.action==="update"&&!after.has(w.path))throw Error("missing document");
    after.set(w.path,w.action==="update"?
      {...after.get(w.path),...w.data}:w.data);
   }
   documents.clear();
   for(const [path,data] of after)documents.set(path,data);
   commits++;
   return result;
  }
 };
}
const principal={
 serverVerified:true,tokenVerified:true,userActive:true,memberActive:true,
 companyActive:true,companyKind:"partner",accessKind:"partner",
 partnerRelationApproved:true,canSubmit:true,
 uid:"partnerMember",companyId:"partnerA",teamIds:["team1"]
};
const catalog=[
 {catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
 {catalogId:"custom:partnerA:own",ownerCompanyId:"partnerA",active:true,visibility:"private"}
];
const input={date:"2026-10-29",teamId:"team1",status:"submitted",
 lines:[{catalogId:"shared:hub:NURO",count:2},
  {catalogId:"custom:partnerA:own",count:3}]};
const context=async tx=>{
 const user=await tx.getTrustedDocument("users/partnerMember");
 if(!user.exists||!user.data().active)throw Error("Not an active member");
 return {principal,catalog,memberName:"協力店A",teamName:"1班"};
};
const reader=async()=>({serverVerified:true,tokenVerified:true,active:true,
 allowedCompanyIds:["partnerA"],allowedTeamIds:["team1"]});

test("staged adapter performs count-only create/correction/read atomically",async()=>{
 const db=mockAdmin();
 const store=makePartnerCountAdminStore(db);
 const recorded=await stageNewPartnerCount({
  store,loadTrustedContext:context,
  request:input,idempotencyKey:"idempotency_20261029",
  mintRecordId:async()=>"pc_adapter_record"
 });
 assert.equal(recorded.status,"registered");
 assert.equal(db.documents.size,6);
 assert.deepEqual(db.documents.get("users/partnerMember"),{
  uid:"partnerMember",active:true
 });
 assert([...db.documents.keys()].filter(x=>x.startsWith("partnerCount")).length===5);
 const output=await readCurrentPartnerPublication({
  store,companyId:"partnerA",recordId:"pc_adapter_record",
  loadAuthorizedReader:reader
 });
 assert.equal(output.header.totalCount,2);
 assert.equal(output.lines.length,1);
 assert(!JSON.stringify(output).includes("custom:partnerA:own"));
 await stageCorrectPartnerCount({
  store,loadTrustedContext:context,
  request:{...input,lines:[{catalogId:"shared:hub:NURO",count:4}]},
  recordId:"pc_adapter_record",expectedVersion:1,correctionId:"pcfix_adapter01"
 });
 const latest=await readCurrentPartnerPublication({
  store,companyId:"partnerA",recordId:"pc_adapter_record",
  loadAuthorizedReader:reader
 });
 assert.equal(latest.version,2);
 assert.equal(latest.header.totalCount,4);
 assert.equal(db.documents.size,9);
 assert(db.documents.has("partnerCountPublicRevisions/8-partnerA-17-pc_adapter_record_v000001"));
 assert.equal(db.commits,4);
});

test("write paths are strictly count-only; no raw/financial/deletion escape",async()=>{
 const db=mockAdmin(),store=makePartnerCountAdminStore(db);
 for(const path of ["records/doc1","products/doc1","users/person",
  "companies/c1/members/m1","partnerCountRecords/a/b",
  "partnerCountRecords/../evil","partnerCountUnknown/thing"]){
  assert.throws(()=>store.ref(path),/Partner count adapter refused/);
 }
 await assert.rejects(store.runTransaction(async tx=>{
  assert.equal("delete" in tx,false);
  assert.equal("set" in tx,false);
  assert.equal("batch" in tx,false);
  await tx.getTrustedDocument("users/partnerMember");
  assert.throws(()=>tx.getTrustedDocument("records/raw1"),
    /Partner count adapter refused/);
  assert.throws(()=>tx.get({path:"partnerCountRecords/forged"}),
    /Partner count adapter refused/);
  const ref=store.ref("partnerCountRecords/test");
  tx.create(ref,{companyId:"partnerA",results:[{count:1,totalRevenue:99999}]});
 }),/Private financial key leaked/);
 assert.equal(db.documents.size,1);
 assert.equal(db.commits,0);
});

test("correction cannot mutate private revisions; denied operations commit nothing",async()=>{
 const db=mockAdmin(),store=makePartnerCountAdminStore(db);
 await assert.rejects(store.runTransaction(tx=>{
  const ref=store.ref("partnerCountPublicRevisions/test");
  tx.update(ref,{revision:2,latestPublicRevision:2});
 }),/Partner count adapter refused/);
 assert.equal(db.commits,0);
 await assert.rejects(store.runTransaction(tx=>{
  const ref=store.ref("partnerCountRecords/test");
  tx.update(ref,{revision:2,latestPublicRevision:1});
 }),/Partner count adapter refused/);
 assert.equal(db.commits,0);
});
