import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";
import {makePublicCountRestAdapters,makePublicCountRestHandler}
 from "../src/public-count-live-adapter.mjs";

const project="sales-management-cc116";
const now=Math.floor(Date.parse("2026-10-29T12:00:00Z")/1000);
const key=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...key.publicKey.export({format:"jwk"}),kid:"local-test",alg:"RS256",use:"sig"};
function jwt(){
 const head=Buffer.from(JSON.stringify({kid:"local-test",alg:"RS256"})).toString("base64url");
 const payload=Buffer.from(JSON.stringify({
  aud:project,iss:"https://securetoken.google.com/"+project,
  sub:"powner",email_verified:true,iat:now-120,auth_time:now-300,exp:now+1200
 })).toString("base64url");
 return head+"."+payload+"."+sign("RSA-SHA256",Buffer.from(head+"."+payload),key.privateKey).toString("base64url");
}
const root="projects/"+project+"/databases/(default)/documents/";
const typed=value=>{
 if(value===null)return {nullValue:null};
 if(typeof value==="boolean")return {booleanValue:value};
 if(typeof value==="number")return {integerValue:String(value)};
 return {stringValue:value};
};
const fsDoc=(path,obj)=>({name:root+path,fields:Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,typed(v)]))});
const docs=new Map([
 ["users/powner",{uid:"powner",companyId:"pc",active:true,
   accessKind:"partner",companyRole:"owner",teamId:null}],
 ["companies/pc",{companyKind:"partner",ownerUid:"powner",
   hubCompanyId:"hub",active:true}],
 ["companies/pc/members/powner",{uid:"powner",companyId:"pc",
   active:true,accessKind:"partner",companyRole:"owner",teamId:null}],
 ["partnerRelations/pc",{active:true,partnerCompanyId:"pc",
   hubCompanyId:"hub",countSharingApproved:true,catalogAccessApproved:true}],
 ["companies/hub",{companyKind:"internal",active:true}]
]);
function fixture({accountDisabled=false,projectedMoney=false,revoked=false}={}){
 const calls=[];
 const fetcher=async (input,options={})=>{
  const url=String(input),body=options.body?JSON.parse(options.body):null;
  calls.push({url,method:options.method||"GET",body});
  const ok=x=>new Response(JSON.stringify(x),{status:200,headers:{"Cache-Control":"max-age=180"}});
  if(url.includes("/service_accounts/v1/jwk/"))return ok({keys:[jwk]});
  if(url.includes("/accounts:lookup")){
   assert.deepEqual(body,{localId:["powner"],targetProjectId:project});
   return ok({users:[{localId:"powner",emailVerified:true,
      disabled:accountDisabled,validSince:String(now+(revoked?50:-1000))}]});
  }
  if(url.startsWith("https://firestore.googleapis.com/v1/")&&url.includes("/documents:runQuery")){
   assert.equal(body.structuredQuery.from[0].collectionId,"publicRecords");
   assert.deepEqual(body.structuredQuery.where.compositeFilter.filters.map(x=>x.fieldFilter.field.fieldPath),["companyId","teamId"]);
   return ok([{readTime:"2026-10-29T12:00:00Z",document:fsDoc("publicRecords/r1",{
    companyId:"pc",sourceId:"r1",uid:"powner",
    teamId:"teamA",date:"2026-10-29",totalCount:2,
    reportStatus:"submitted",memberNameSnapshot:"担当",
    teamNameSnapshot:"1班",workLocation:"",
    ...(projectedMoney?{totalRevenue:99999}:{})
   })}]);
  }
  if(url.startsWith("https://firestore.googleapis.com/v1/")&&options.method==="GET"){
   const path=decodeURIComponent(url.split("/documents/")[1]||"");
   assert(!["records/","products/","recordCorrections/","revenueGoals/"].some(x=>path.startsWith(x)),
    "NEVER fetch raw financial data");
   const data=docs.get(path);
   return data?ok(fsDoc(path,data)):new Response(null,{status:404});
  }
  throw Error("Unexpected network destination: "+url);
 };
 return {calls,fetcher};
}
const routeOpts=f=>({
 enabled:true,fetcher:f.fetcher,subtle:webcrypto.subtle,nowSeconds:()=>now,
 getServiceToken:async()=>"server-owned-test-oauth-token"
});
const request=()=>new Request(
 "https://count-worker.example/v1/public-counts?collection=publicRecords&teamId=teamA",
 {headers:{Origin:"https://nico-factory.web.app",Authorization:"Bearer "+jwt()}}
);
test("worker default OFF refuses public-count route without Auth, Firestore or network calls",async()=>{
 const old=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error("OFF mode unexpectedly fetched secrets");};
  const env={FIREBASE_PROJECT_ID:project,FINANCE_GATEWAY_ENABLED:"disabled",
    PUBLIC_COUNT_GATEWAY_ENABLED:"disabled",
    PUBLIC_COUNT_PROJECTION_APPROVAL:"NOT_APPROVED"};
  const res=await worker.fetch(request(),env);
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{error:"request_blocked"});
 }finally{globalThis.fetch=old;}
});
test("real REST adapter verifies admin Auth and serves only whitelisted public projections",async()=>{
 const f=fixture();
 const handler=makePublicCountRestHandler(routeOpts(f));
 const res=await handler(request());
 assert.equal(res.status,200);
 const payload=await res.json();
 assert.deepEqual(payload.items,[{sourceId:"r1",date:"2026-10-29",teamId:"teamA",
  totalCount:2,reportStatus:"submitted"}]);
 assert(f.calls.some(c=>c.url.includes("/accounts:lookup")));
 assert(f.calls.some(c=>c.url.includes("publicRecords")===false&&c.url.includes("/documents/users/")));
 assert(f.calls.some(c=>c.url.includes("/documents:runQuery")&&c.method==="POST"&&
   c.body?.structuredQuery?.from?.[0]?.collectionId==="publicRecords"));
 assert(!JSON.stringify(payload).includes("powner"));
 assert(!JSON.stringify(payload).includes("revenue"));
});
test("revoked Auth, suspended Firebase account and tainted public fields never return data",async()=>{
 for(const option of [{revoked:true},{accountDisabled:true},{projectedMoney:true}]){
  const f=fixture(option);
  const response=await makePublicCountRestHandler(routeOpts(f))(request());
  assert.notEqual(response.status,200);
  const body=JSON.stringify(await response.json());
  assert(!body.includes("99999"));
  assert(!body.includes("powner"));
 }
});
test("REST adapters refuse direct financial documents, raw query and unknown OAuth identity",async()=>{
 const f=fixture();
 const adapters=makePublicCountRestAdapters({
  getServiceToken:async()=>"test-oauth",fetcher:f.fetcher
 });
 await assert.rejects(adapters.readDocument("records/secret"),/unavailable/);
 await assert.rejects(adapters.readDocument("products/secret"),/unavailable/);
 await assert.rejects(adapters.executeRunQuery({endpoint:"https://evil.example",method:"POST",
  body:{structuredQuery:{from:[{collectionId:"publicRecords"}],limit:25}}}),/unavailable/);
 await assert.rejects(adapters.executeRunQuery({
  endpoint:"https://firestore.googleapis.com/v1/"+root.slice(0,-1)+":runQuery",
  method:"POST",body:{structuredQuery:{from:[{collectionId:"records"}],limit:25}}
 }),/unavailable/);
 assert.equal(f.calls.length,0);
});
test("external worker read route requires every explicit OFF-by-default finance/projection switch",()=>{
 const src=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 const conf=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 for(const word of [
  'env.PUBLIC_COUNT_GATEWAY_ENABLED==="enabled"',
  'env.PUBLIC_COUNT_PROJECTION_APPROVAL==="EXACT_COUNTS_RECONCILED"',
  'env.FINANCE_COST_APPROVAL==="OWNER_APPROVED_BLAZE_COSTS"',
  'env.FINANCE_GATEWAY_ENABLED==="enabled"'
 ])assert(src.includes(word));
 for(const word of [
  'PUBLIC_COUNT_GATEWAY_ENABLED = "disabled"',
  'PUBLIC_COUNT_PROJECTION_APPROVAL = "NOT_APPROVED"'
 ])assert(conf.includes(word));
 assert(!src.includes("FIREBASE_API_KEY="));
});
