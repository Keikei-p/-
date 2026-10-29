import test from "node:test";
import assert from "node:assert/strict";
import {createStagedPartnerCountWriteGateway}
 from "../security/staged-partner-count-write-gateway.mjs";

const uid="partnerMember";
const auth={uid,emailVerified:true,authTime:1760000000};
const catalog=[
 {catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
 {catalogId:"custom:partnerA:secret",ownerCompanyId:"partnerA",active:true,visibility:"private"}
];
const entry={date:"2026-10-29",teamId:"team1",status:"submitted",
 lines:[{catalogId:"shared:hub:NURO",count:2},
  {catalogId:"custom:partnerA:secret",count:1}]};
const key="retry_20261029_test_abc";
function makeServer(){
 const docs=new Map(Object.entries({
  ["users/"+uid]:{uid,companyId:"partnerA",teamId:"team1",
   active:true,accessKind:"partner",canSubmit:true,companyRole:"member"},
  "companies/partnerA":{active:true,companyKind:"partner",
   hubCompanyId:"hub",ownerUid:"partnerOwner"},
  ["companies/partnerA/members/"+uid]:{uid,companyId:"partnerA",
   active:true,teamId:"team1",name:"協力店担当",role:"leader",
   accessKind:"partner",canSubmit:true,companyRole:"member"},
  "teams/team1":{name:"1班",companyId:"partnerA",active:true},
  "partnerRelations/partnerA":{active:true,hubCompanyId:"hub",
   partnerCompanyId:"partnerA",countSharingApproved:true,
   catalogAccessApproved:true},
  "companies/hub":{active:true,companyKind:"internal"}
 }));
 const clone=x=>structuredClone(x);
 let writes=0,verified=0;
 const db={
  doc:path=>({path}),
  async runTransaction(work){
   const staged=[];
   const tx={
    async get(ref){
     const value=docs.get(ref.path);
     return {exists:value!==undefined,data:()=>clone(value)};
    },
    create(ref,data){staged.push({kind:"create",path:ref.path,data:clone(data)});},
    update(ref,data){staged.push({kind:"update",path:ref.path,data:clone(data)});}
   };
   const result=await work(tx);
   const shadow=new Map(docs);
   for(const s of staged){
    if(s.kind==="create"&&shadow.has(s.path))throw Error("duplicate");
    if(s.kind==="update"&&!shadow.has(s.path))throw Error("missing");
    shadow.set(s.path,s.kind==="create"?s.data:{...shadow.get(s.path),...s.data});
   }
   docs.clear();for(const [k,v] of shadow)docs.set(k,v);
   writes+=staged.length;
   return result;
  }
 };
 const handle=createStagedPartnerCountWriteGateway({
  enabled:true,db,
  authenticateBearer:async token=>{
   verified++;
   if(token!=="a".repeat(60))throw Error("unverified");
   return auth;
  },
  loadAuthUser:async name=>({uid:name,disabled:false,emailVerified:true,
   tokensValidAfterTime:"2025-01-01T00:00:00.000Z"}),
  loadCountCatalog:async()=>clone(catalog),
  mintRecordId:async()=>"pc_first_record",
  mintCorrectionId:async()=>"pcfix_edit_record"
 });
 return {docs,handle,get writes(){return writes;},get verified(){return verified;}};
}
function request(body,{token="a".repeat(60),contentType="application/json"}={}){
 return new Request("https://staging.invalid/counts",{
  method:"POST",headers:{
   "Authorization":"Bearer "+token,"Content-Type":contentType
  },body:JSON.stringify(body)
 });
}
const create={action:"create",request:entry,retryKey:key};

test("default OFF returns 503 even if a request contains a bearer token",async()=>{
 const route=createStagedPartnerCountWriteGateway();
 const res=await route(request(create));
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{error:"service_disabled"});
});
test("verified actor saves count only; retry is idempotent; correction appends",async()=>{
 const service=makeServer();
 const first=await service.handle(request(create));
 assert.equal(first.status,200);
 assert.deepEqual(await first.json(),{saved:true,status:"registered",
  recordId:"pc_first_record",version:1,ownCount:3,sharedCount:2});
 assert.equal(service.writes,5);
 const replay=await service.handle(request(create));
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).status,"already_registered");
 assert.equal(service.writes,5);
 const corrected=await service.handle(request({
  action:"correct",request:{...entry,lines:[
   {catalogId:"shared:hub:NURO",count:4}
  ]},recordId:"pc_first_record",expectedVersion:1
 }));
 assert.equal(corrected.status,200);
 const answer=await corrected.json();
 assert.equal(answer.version,2);assert.equal(answer.sharedCount,4);
 assert.equal(service.writes,9);
 assert([...service.docs.keys()].every(p=>!p.startsWith("records/")));
 assert(service.docs.has("partnerCountRevisions/8-partnerA-15-pc_first_record_v000001"));
 const serialized=JSON.stringify(answer);
 for(const word of ["revenue","unitPrice","cashback","price","売上","単価"])
  assert(!serialized.includes(word));
 assert.equal(service.verified,3);
});
test("forged identity, money, correction ID, authorization and malformed requests fail without writes",async()=>{
 const service=makeServer();
 const attacks=[
  {...create,companyId:"hub"},
  {...create,uid:"owner"},
  {...create,recordId:"pc_fake"},
  {...create,request:{...entry,revenue:999}},
  {...create,request:{...entry,teamId:"hub-team"}},
  {...create,request:{...entry,lines:[{catalogId:"shared:hub:NURO",count:1,unitPrice:10000}]}},
  {action:"correct",request:entry,recordId:"pc_unknown",
   expectedVersion:1,correctionId:"pcfix_injected"},
  {action:"correct",request:entry,recordId:"pc_unknown",expectedVersion:1}
 ];
 for(const attack of attacks){
  const result=await service.handle(request(attack));
  assert.equal(result.status,403);
  assert.equal(service.writes,0);
 }
 const unauth=await service.handle(request(create,{token:"b".repeat(60)}));
 assert.equal(unauth.status,403);
 assert.equal(service.writes,0);
 const badType=await service.handle(request(create,{contentType:"text/plain"}));
 assert.equal(badType.status,403);
 assert.equal(service.writes,0);
});
test("revoked, unlinked or inactive partners cannot register; no partial writes",async()=>{
 for(const mutate of [
  docs=>docs.get("users/"+uid).active=false,
  docs=>docs.get("companies/partnerA").active=false,
  docs=>docs.get("partnerRelations/partnerA").countSharingApproved=false,
  docs=>docs.get("companies/partnerA/members/"+uid).teamId="team2",
  docs=>docs.get("companies/partnerA/members/"+uid).accessKind="internal",
  docs=>docs.get("teams/team1").active=false
 ]){
  const service=makeServer();
  mutate(service.docs);
  const result=await service.handle(request(create));
  assert.equal(result.status,403);
  assert.equal(service.writes,0);
 }
});
