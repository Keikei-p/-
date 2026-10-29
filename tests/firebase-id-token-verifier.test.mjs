import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {createFirebaseIdTokenVerifier} from "../security/firebase-id-token-verifier.mjs";
import {createCountOnlyReadHandler} from "../security/public-count-api.mjs";

const PROJECT="sales-management-cc116";
const NOW=Date.parse("2026-10-29T00:00:00Z")/1000;
const keyPair=generateKeyPairSync("rsa",{modulusLength:2048});
const secondKey=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...keyPair.publicKey.export({format:"jwk"}),
 kid:"firebase-test-kid",alg:"RS256",use:"sig"};
const claims={
 iss:"https://securetoken.google.com/"+PROJECT,aud:PROJECT,
 sub:"staff-123",email:"staff@example.test",email_verified:true,
 iat:NOW-10,exp:NOW+1800,auth_time:NOW-20
};
function mint(payload=claims,head={alg:"RS256",typ:"JWT",kid:jwk.kid},privateKey=keyPair.privateKey){
 const h=Buffer.from(JSON.stringify(head)).toString("base64url");
 const p=Buffer.from(JSON.stringify(payload)).toString("base64url");
 const input=h+"."+p;
 return input+"."+sign("RSA-SHA256",Buffer.from(input),privateKey).toString("base64url");
}
function fixture(){
 let requested=0;
 const fetchKeys=async(url,init)=>{
  requested++;
  assert.equal(url,"https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  assert.equal(init.method,"GET");
  return new Response(JSON.stringify({keys:[jwk]}),{
   status:200,headers:{"Cache-Control":"public, max-age=120"}
  });
 };
 const verify=createFirebaseIdTokenVerifier({
  projectId:PROJECT,fetchKeys,subtle:webcrypto.subtle,nowSeconds:()=>NOW
 });
 return {verify,get requests(){return requested;}};
}
const rejected=()=>/Firebase ID token verification refused/;
test("valid signed Firebase ID token produces only server-verified UID, not caller role",async()=>{
 const f=fixture();
 assert.deepEqual(await f.verify(mint()),{
  uid:"staff-123",emailVerified:true,authTime:NOW-20
 });
 assert.equal(f.requests,1);
 await f.verify(mint());
 assert.equal(f.requests,1,"public keys can be cached until Google max-age");
});
test("reject unsigned, forged, expired, foreign audience or issuer, and unverified mail",async()=>{
 const invalid=[
  ["none",claims,{alg:"none",kid:jwk.kid}],
  ["wrong aud",{...claims,aud:"another-app"},undefined],
  ["wrong iss",{...claims,iss:"https://securetoken.google.com/evil"},undefined],
  ["expired",{...claims,exp:NOW},undefined],
  ["not issued",{...claims,iat:NOW+1},undefined],
  ["not authenticated",{...claims,auth_time:NOW+1},undefined],
  ["bad email",{...claims,email_verified:false},undefined],
  ["bad subject",{...claims,sub:""},undefined],
  ["too long expiration",{...claims,exp:NOW+4000},undefined],
  ["future nbf",{...claims,nbf:NOW+10},undefined]
 ];
 for(const [name,body,head]of invalid){
  const f=fixture();
  await assert.rejects(f.verify(mint(body,head)),rejected(),name);
 }
 const f=fixture();
 await assert.rejects(f.verify(mint(claims,undefined,secondKey.privateKey)),rejected());
 await assert.rejects(f.verify(mint(claims,{alg:"RS256",kid:"unknown"})),rejected());
 await assert.rejects(f.verify("a.b.c"),rejected());
});
test("google public JWK failure, bad algorithm or unsupported key response fails closed",async()=>{
 const bad=[
  {keys:[]},{keys:[{...jwk,use:"enc"}]},{keys:[jwk,jwk]},
  {keys:[{...jwk,kty:"oct"}]}
 ];
 for(const obj of bad){
  const verify=createFirebaseIdTokenVerifier({
   fetchKeys:async()=>new Response(JSON.stringify(obj),{status:200}),
   subtle:webcrypto.subtle,nowSeconds:()=>NOW
  });
  await assert.rejects(verify(mint()),rejected());
 }
 const unavailable=createFirebaseIdTokenVerifier({
  fetchKeys:async()=>new Response("offline",{status:503}),
  subtle:webcrypto.subtle,nowSeconds:()=>NOW
 });
 await assert.rejects(unavailable(mint()),rejected());
});
test("finance-free read gateway accepts verified token and rechecks live team permissions",async()=>{
 const verify=fixture().verify;
 let membershipCalls=0,queries=0;
 const handler=createCountOnlyReadHandler({
  enabled:true,
  authenticateBearer:verify,
  loadMembership:async(uid)=>{
   assert.equal(uid,"staff-123");membershipCalls++;
   return {
    uid,companyId:"co1",userCompanyId:"co1",memberCompanyId:"co1",
    userActive:true,memberActive:true,teamIds:["team1"],
    companyOwnerUid:"owner",userCompanyRole:"member",
    memberCompanyRole:"member",serverVerifiedOwner:false
   };
  },
  queryPublicDocuments:async options=>{
   queries++;
   assert.equal(options.companyId,"co1");
   assert.equal(options.teamId,"team1");
   return {items:[{
    companyId:"co1",sourceId:"record1",uid:"staff-123",date:"2026-10-29",
    teamId:"team1",totalCount:2,reportStatus:"submitted",
    memberNameSnapshot:"担当A",teamNameSnapshot:"1班",workLocation:""
   }],readTime:"2026-10-29T00:00:00Z"};
  }
 });
 const req=(url,token=mint())=>new Request(url,{
  headers:{Origin:"https://nico-factory.web.app",
   Authorization:"Bearer "+token}
 });
 const ok=await handler(req("https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId=team1"));
 assert.equal(ok.status,200);
 assert.equal(queries,1);assert.equal(membershipCalls,1);
 const safe=JSON.stringify(await ok.json());
 assert(!safe.includes("revenue"));assert(!safe.includes("uid"));
 const forbidden=await handler(req("https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId=other"));
 assert.equal(forbidden.status,403);
 assert.equal(queries,1);
 const bad=await handler(req("https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId=team1",
   mint({...claims,aud:"malicious-project"})));
 assert.equal(bad.status,401,"invalid cryptographic tokens must be unauthenticated");
 assert.equal(queries,1);
});
