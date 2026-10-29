import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {createStagedCountGateway} from "../security/staged-count-gateway.mjs";

const project="sales-management-cc116";
const now=Math.floor(Date.parse("2026-10-29T09:00:00Z")/1000);
const key=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...key.publicKey.export({format:"jwk"}),kid:"test-jwk",alg:"RS256",use:"sig"};
function makeToken(){
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:"test-jwk"})).toString("base64url");
 const p=Buffer.from(JSON.stringify({
  aud:project,iss:"https://securetoken.google.com/"+project,
  sub:"partnerOwner",email_verified:true,iat:now-100,auth_time:now-200,exp:now+1200
 })).toString("base64url");
 return h+"."+p+"."+sign("RSA-SHA256",Buffer.from(h+"."+p),key.privateKey).toString("base64url");
}
const bearer=makeToken();
const makeRequest=(team="teamA",token=bearer)=>new Request(
 "https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId="+team,
 {headers:{Authorization:"Bearer "+token,Origin:"https://nico-factory.web.app"}}
);
function fixture(){
 const documents=new Map([
  ["users/partnerOwner",{uid:"partnerOwner",companyId:"pc",active:true,companyRole:"owner",accessKind:"partner",teamId:null,canViewRevenue:true}],
  ["companies/pc",{ownerUid:"partnerOwner",companyKind:"partner",hubCompanyId:"hub",active:true}],
  ["companies/pc/members/partnerOwner",{uid:"partnerOwner",companyId:"pc",
     companyRole:"owner",role:"leader",accessKind:"partner",teamId:null,
     active:true,canViewRevenue:true,canViewUnitPrice:true}],
  ["partnerRelations/pc",{active:true,partnerCompanyId:"pc",hubCompanyId:"hub",
     countSharingApproved:true,catalogAccessApproved:true}],
  ["companies/hub",{companyKind:"internal",active:true,ownerUid:"hubOwner"}]
 ]);
 let authAccount={uid:"partnerOwner",emailVerified:true,disabled:false,
  tokensValidAfterTime:"2026-10-01T00:00:00Z"};
 const called={keys:0,auth:0,acl:[],queries:[]};
 let publicDocExtra={};
 const gateway=createStagedCountGateway({
  enabled:true,projectId:project,subtle:webcrypto.subtle,nowSeconds:()=>now,
  fetchKeys:async()=>{
   called.keys++;
   return new Response(JSON.stringify({keys:[jwk]}),{
    status:200,headers:{"Cache-Control":"public,max-age=180"}
   });
  },
  loadAuthUser:async()=>{called.auth++;return {...authAccount};},
  readDocument:async path=>{
   called.acl.push(path);
   assert(!/^(records|products|revenueGoals|recordCorrections)\//.test(path));
   return documents.get(path)??null;
  },
  executeRunQuery:async q=>{
   called.queries.push(q);
   assert.equal(q.body.structuredQuery.from[0].collectionId,"publicRecords");
   assert.equal(q.body.structuredQuery.where.compositeFilter.filters.length,2);
   const doc={
    companyId:{stringValue:"pc"},sourceId:{stringValue:"rec001"},
    uid:{stringValue:"partnerOwner"},teamId:{stringValue:"teamA"},
    date:{stringValue:"2026-10-29"},totalCount:{integerValue:"3"},
    reportStatus:{stringValue:"submitted"},memberNameSnapshot:{stringValue:"担当"},
    teamNameSnapshot:{stringValue:"協力店"},workLocation:{stringValue:""},
    ...publicDocExtra
   };
   return [{document:{name:"projects/"+project+"/databases/(default)/documents/publicRecords/rec001",
    fields:doc},readTime:"2026-10-29T09:00:00Z"}];
  }
 });
 return {gateway,called,documents,revoke:()=>{authAccount={...authAccount,disabled:true};},
   addMoney:()=>{publicDocExtra={totalRevenue:{integerValue:"1000000"}};}};
}
test("disabled gateway never initializes credentials or calls private data",async()=>{
 const handler=createStagedCountGateway({enabled:false,fetchKeys:()=>{throw Error("called");}});
 const result=await handler(makeRequest());
 assert.equal(result.status,503);
});
test("enabled gateway refuses missing trusted backend adapters",()=>{
 assert.throws(()=>createStagedCountGateway({enabled:true}),/incomplete/);
});
test("signed partner owner with price flags can fetch only count-only schema",async()=>{
 const f=fixture();const response=await f.gateway(makeRequest());
 assert.equal(response.status,200);
 const body=await response.json();
 assert.deepEqual(body.items,[{sourceId:"rec001",date:"2026-10-29",
  teamId:"teamA",totalCount:3,reportStatus:"submitted"}]);
 assert.equal(f.called.auth,1);
 assert.equal(f.called.keys,1);
 assert.equal(f.called.queries.length,1);
 assert(f.called.acl.includes("partnerRelations/pc"));
 for(const term of ["unitPrice","revenue","cashback","uid","canViewRevenue"])
  assert(!JSON.stringify(body).includes(term));
});
test("revoked Firebase account, revoked partnership and forged token never issue query",async()=>{
 const f=fixture();
 await f.gateway(makeRequest());
 f.revoke();
 const blocked=await f.gateway(makeRequest());
 assert.notEqual(blocked.status,200);
 assert.equal(f.called.queries.length,1);
 const bad=await f.gateway(makeRequest("teamA",bearer.slice(0,-5)+"abcde"));
 assert.equal(bad.status,401);
 assert.equal(f.called.queries.length,1);
});
test("backend price field on public record fails without returning any partial count",async()=>{
 const f=fixture();f.addMoney();
 const response=await f.gateway(makeRequest());
 assert.equal(response.status,503);
 const body=JSON.stringify(await response.json());
 assert(!body.includes("1000000"));
 assert.equal(body,'{"error":"request_blocked"}');
});
test("partner origin other than official NICO and client-supplied finance collection are refused",async()=>{
 const f=fixture();
 const old=new Request("https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId=teamA",{
   headers:{Authorization:"Bearer "+bearer,Origin:"https://keikei-p.github.io"}
 });
 assert.equal((await f.gateway(old)).status,403);
 const finance=new Request("https://nico-factory.web.app/v1/public-counts?collection=records&teamId=teamA",{
   headers:{Authorization:"Bearer "+bearer,Origin:"https://nico-factory.web.app"}
 });
 assert.equal((await f.gateway(finance)).status,400);
 assert.equal(f.called.queries.length,0);
});
