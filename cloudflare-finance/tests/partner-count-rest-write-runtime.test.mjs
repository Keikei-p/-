import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {createPartnerCountRestWriteHandler}
 from "../src/partner-count-live-writer.mjs";
import {makePartnerCountRestDb} from "../src/partner-count-rest-db.mjs";
import worker from "../src/index.js";

const project="sales-management-cc116";
const prefix="projects/"+project+"/databases/(default)/documents/";
const now=Math.floor(Date.parse("2026-10-30T03:00:00Z")/1000);
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),alg:"RS256",use:"sig",kid:"local-write-key"};
function token(){
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid})).toString("base64url");
 const p=Buffer.from(JSON.stringify({aud:project,iss:"https://securetoken.google.com/"+project,
  sub:"partnerMember",email_verified:true,iat:now-120,auth_time:now-300,exp:now+1000})).toString("base64url");
 return h+"."+p+"."+sign("RSA-SHA256",Buffer.from(h+"."+p),privateKey).toString("base64url");
}
const encode=v=>{
 if(v===null)return {nullValue:null};
 if(typeof v==="boolean")return {booleanValue:v};
 if(typeof v==="number")return {integerValue:String(v)};
 if(typeof v==="string")return {stringValue:v};
 if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
 return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
};
const decode=v=>{
 if("nullValue"in v)return null;
 if("booleanValue"in v)return v.booleanValue;
 if("integerValue"in v)return Number(v.integerValue);
 if("stringValue"in v)return v.stringValue;
 if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields).map(([k,x])=>[k,decode(x)]));
 if("arrayValue"in v)return (v.arrayValue.values||[]).map(decode);
 throw Error("Invalid fixture Firestore type");
};
const encodeFields=d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,encode(v)]));
const decodeFields=d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,decode(v)]));
const row=(path,fields)=>({name:prefix+path,fields:encodeFields(fields)});
const original={
 "users/partnerMember":{uid:"partnerMember",companyId:"partnerA",
   active:true,accessKind:"partner",companyRole:"member",teamId:"team1",canSubmit:true},
 "companies/partnerA":{active:true,companyKind:"partner",
   ownerUid:"partnerOwner",hubCompanyId:"hub"},
 "companies/partnerA/members/partnerMember":{
   uid:"partnerMember",companyId:"partnerA",active:true,accessKind:"partner",
   companyRole:"member",role:"leader",teamId:"team1",canSubmit:true,name:"担当"},
 "companies/hub":{active:true,companyKind:"internal"},
 "teams/team1":{companyId:"partnerA",active:true,name:"1班"},
 "partnerRelations/partnerA":{active:true,partnerCompanyId:"partnerA",
   hubCompanyId:"hub",countSharingApproved:true,catalogAccessApproved:true},
 "partnerCountCatalog/shared:hub:NURO":{
   catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
 "partnerCountCatalog/custom:partnerA:own":{
   catalogId:"custom:partnerA:own",ownerCompanyId:"partnerA",active:true,visibility:"private"}
};
const entry={date:"2026-10-30",teamId:"team1",status:"submitted",lines:[
 {catalogId:"shared:hub:NURO",count:2},
 {catalogId:"custom:partnerA:own",count:1}
]};
const key="repeat_same_request_20261030";
const submitBody={action:"create",retryKey:key,request:entry};
const request=(body=submitBody,{origin="https://nico-factory.web.app"}={})=>new Request(
 "https://worker.example/v1/partner-counts",{method:"POST",headers:{
  Origin:origin,"Content-Type":"application/json",Authorization:"Bearer "+token()
 },body:JSON.stringify(body)}
);
function fixture({disabled=false,revoked=false,malformedCatalog=false}={}){
 const docs=new Map(Object.entries(structuredClone(original)));
 if(malformedCatalog)docs.get("partnerCountCatalog/shared:hub:NURO").unitPrice=12500;
 let nextTx=0,commits=0,rollbacks=0,queries=0;
 const calls=[];
 const ok=x=>new Response(JSON.stringify(x),{status:200});
 const fetcher=async(input,init={})=>{
  const url=String(input),body=init.body?JSON.parse(init.body):null;
  calls.push({url,method:init.method??"GET"});
  if(url.includes("/service_accounts/v1/jwk/"))
   return new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{"Cache-Control":"max-age=300"}});
  if(url.endsWith("/accounts:lookup")){
   assert.deepEqual(body,{localId:["partnerMember"],targetProjectId:project});
   return ok({users:[{localId:"partnerMember",emailVerified:true,
     disabled,validSince:String(now+(revoked?100:-1000))}]});
  }
  if(!url.startsWith("https://firestore.googleapis.com/v1/projects/"+project))
   throw Error("Unexpected external request");
  if(url.endsWith("/documents:beginTransaction")){
   nextTx++;return ok({transaction:"tx_"+nextTx});
  }
  if(url.endsWith("/documents:batchGet")){
   queries++;
   assert.equal(body.documents.length,1);
   const name=body.documents[0],path=decodeURIComponent(name.slice(prefix.length));
   if(docs.has(path))return ok([{found:row(path,docs.get(path))}]);
   return ok([{missing:name}]);
  }
  if(url.endsWith("/documents:rollback")){
   rollbacks++;return ok({});
  }
  if(url.endsWith("/documents:commit")){
   const pending=new Map(docs);
   for(const write of body.writes){
    const path=decodeURIComponent(write.update.name.slice(prefix.length));
    assert(path.startsWith("partnerCount"),"NO legacy financial collection touched");
    if(write.currentDocument.exists===false&&pending.has(path))
     return new Response(JSON.stringify({error:"already-exists"}),{status:409});
    if(write.currentDocument.exists===true&&!pending.has(path))
     return new Response(JSON.stringify({error:"missing"}),{status:409});
    pending.set(path,decodeFields(write.update.fields));
   }
   docs.clear();for(const [k,v] of pending)docs.set(k,v);
   commits++;
   return ok({writeResults:body.writes.map(()=>({updateTime:"2026-10-30T03:00:00Z"}))});
  }
  throw Error("Unexpected Firestore call: "+url);
 };
 return {docs,calls,fetcher,
  get commits(){return commits;},get rollbacks(){return rollbacks;},
  get queries(){return queries;},
  handle(){
   return createPartnerCountRestWriteHandler({
    enabled:true,fetcher,getServiceToken:async()=>"trusted-oauth-token",
    subtle:webcrypto.subtle,nowSeconds:()=>now,
    mintRecordId:()=> "pc_test_r1",
    mintCorrectionId:()=> "pcfix_test_c1"
   });
  }};
}
test("default OFF blocks POST before any Auth, Firestore read or write",async()=>{
 const old=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error("OFF requested network");};
  const res=await worker.fetch(request(),{
   FIREBASE_PROJECT_ID:project,FINANCE_GATEWAY_ENABLED:"disabled",
   PARTNER_COUNT_WRITE_ENABLED:"disabled",FINANCE_WRITE_APPROVAL:"NOT_APPROVED"
  });
  assert.equal(res.status,503);
 }finally{globalThis.fetch=old;}
});
test("partner count create/replay/correction are atomic, count-only and append immutable history",async()=>{
 const f=fixture(),handler=f.handle();
 const created=await handler(request());
 assert.equal(created.status,200,JSON.stringify(f.calls.map(c=>c.url)));
 assert.deepEqual(await created.json(),{saved:true,status:"registered",
  recordId:"pc_test_r1",version:1,ownCount:3,sharedCount:2});
 assert.equal(f.commits,1);
 assert.equal([...f.docs.keys()].filter(x=>x.startsWith("partnerCount")).length,7);
 const replay=await handler(request());
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).status,"already_registered");
 assert.equal(f.commits,1);
 assert.equal(f.rollbacks,1);
 const corrected=await handler(request({action:"correct",request:{...entry,lines:[
   {catalogId:"shared:hub:NURO",count:4}
 ]},recordId:"pc_test_r1",expectedVersion:1}));
 assert.equal(corrected.status,200);
 assert.equal((await corrected.json()).version,2);
 assert.equal(f.commits,2);
 assert(f.docs.has("partnerCountRevisions/8-partnerA-10-pc_test_r1_v000001"));
 assert(f.docs.has("partnerCountRevisions/8-partnerA-10-pc_test_r1_v000002"));
 assert([...f.docs.keys()].every(k=>!k.startsWith("records/")));
 assert(!JSON.stringify([...f.docs.entries()]).includes("unitPrice"));
});
test("invalid catalog, expired account, revoked user and attacker origin write nothing",async()=>{
 for(const options of [{malformedCatalog:true},{disabled:true},{revoked:true}]){
  const f=fixture(options);
  const res=await f.handle()(request());
  assert.equal(res.status,403);
  assert.equal(f.commits,0);
  assert.equal([...f.docs.keys()].filter(k=>k.startsWith("partnerCountRecords")).length,0);
 }
 const f=fixture();
 const forbidden=await f.handle()(request(submitBody,{origin:"https://keikei-p.github.io"}));
 assert.equal(forbidden.status,403);
 assert.equal(f.calls.length,0);
});
test("REST database will not accept direct finance collection writes, deletions or read-after-write",async()=>{
 const f=fixture();
 const db=makePartnerCountRestDb({fetcher:f.fetcher,getServiceToken:async()=>"oauth"});
 assert.throws(()=>db.doc("records/r1"),/refused/);
 assert.throws(()=>db.doc("products/r1"),/refused/);
 await assert.rejects(db.runTransaction(async tx=>{
  tx.create(db.doc("partnerCountRecords/r1"),{companyId:"partnerA",totalCount:1});
  await tx.get(db.doc("partnerCountRecords/r1"));
 }),/refused/);
 assert.equal(f.commits,0);
 assert.equal(f.rollbacks,1);
});
test("every Worker count write approval is independent and disabled by default",()=>{
 const source=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 const conf=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 for(const guard of [
  'env.PARTNER_COUNT_WRITE_ENABLED==="enabled"',
  'env.FINANCE_WRITE_APPROVAL==="DUAL_HOST_BACKUP_VERIFIED"',
  'env.PUBLIC_COUNT_PROJECTION_APPROVAL==="EXACT_COUNTS_RECONCILED"',
  'env.FINANCE_COST_APPROVAL==="OWNER_APPROVED_BLAZE_COSTS"'
 ])assert(source.includes(guard));
 assert(conf.includes('PARTNER_COUNT_WRITE_ENABLED = "disabled"'));
 assert(conf.includes('PUBLIC_COUNT_PROJECTION_APPROVAL = "NOT_APPROVED"'));
});
