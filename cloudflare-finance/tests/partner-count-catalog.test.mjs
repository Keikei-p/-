import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {createPartnerCountCatalogHandler}
 from "../src/partner-count-catalog.mjs";
import {createPartnerCountBrowserClient}
 from "../client/partner-count-browser-client.mjs";
import worker from "../src/index.js";

const PROJECT="sales-management-cc116";
const PREFIX="projects/"+PROJECT+"/databases/(default)/documents/";
const NOW=Math.floor(Date.parse("2026-10-30T03:00:00Z")/1000);
const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...keys.publicKey.export({format:"jwk"}),kid:"synthetic-catalog-key",
 alg:"RS256",use:"sig"};
function jwt(){
 const h=Buffer.from(JSON.stringify({kid:jwk.kid,alg:"RS256"})).toString("base64url");
 const p=Buffer.from(JSON.stringify({aud:PROJECT,
  iss:"https://securetoken.google.com/"+PROJECT,sub:"partnerMember",
  email_verified:true,iat:NOW-100,auth_time:NOW-300,exp:NOW+300
 })).toString("base64url");
 return h+"."+p+"."+sign("RSA-SHA256",Buffer.from(h+"."+p),keys.privateKey).toString("base64url");
}
function typed(x){
 if(typeof x==="boolean")return {booleanValue:x};
 return {stringValue:x};
}
function doc(path,fields){
 return {name:PREFIX+path,
  fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,typed(v)]))};
}
const data=new Map([
 ["users/partnerMember",{uid:"partnerMember",companyId:"partnerA",
   active:true,accessKind:"partner",companyRole:"member",teamId:"team1"}],
 ["companies/partnerA",{active:true,companyKind:"partner",hubCompanyId:"hub",
   ownerUid:"other"}],
 ["companies/partnerA/members/partnerMember",{uid:"partnerMember",
   companyId:"partnerA",active:true,accessKind:"partner",
   companyRole:"member",teamId:"team1"}],
 ["companies/hub",{active:true,companyKind:"internal"}],
 ["teams/team1",{companyId:"partnerA",active:true,name:"1班"}],
 ["partnerRelations/partnerA",{active:true,partnerCompanyId:"partnerA",
   hubCompanyId:"hub",countSharingApproved:true,catalogAccessApproved:true}]
]);
function setup({disabled=false,money=false,tooMany=false,foreign=false}={}){
 const calls=[];
 const ok=x=>new Response(JSON.stringify(x),{status:200,
  headers:{"Cache-Control":"max-age=300"}});
 const fetcher=async(url,opts={})=>{
  const target=String(url),body=opts.body?JSON.parse(opts.body):null;
  calls.push({url:target,body,method:opts.method??"GET"});
  if(target.includes("/service_accounts/v1/jwk/"))return ok({keys:[jwk]});
  if(target.endsWith("/accounts:lookup"))
   return ok({users:[{localId:"partnerMember",emailVerified:true,
    disabled,validSince:String(NOW-1000)}]});
  if(target.includes("/documents:runQuery")){
   assert.equal(opts.method,"POST");
   assert.equal(body.structuredQuery.from[0].collectionId,"partnerCountCatalog");
   assert.equal(body.structuredQuery.where.fieldFilter.field.fieldPath,"ownerCompanyId");
   const owner=body.structuredQuery.where.fieldFilter.value.stringValue;
   assert(["hub","partnerA"].includes(owner));
   const records=owner==="hub"?
    [["shared:hub:NURO",{catalogId:"shared:hub:NURO",
       ownerCompanyId:"hub",active:true,visibility:"shared_counts"}]]:
    [["custom:partnerA:own",{catalogId:"custom:partnerA:own",
       ownerCompanyId:foreign?"different":"partnerA",active:true,
       visibility:"private"}]];
   if(money)records[0][1].unitPrice="12345";
   if(tooMany&&owner==="hub"){
    for(let i=0;i<101;i++)records.push(["shared:hub:p"+i,{
     catalogId:"shared:hub:p"+i,ownerCompanyId:"hub",active:true,
     visibility:"shared_counts"
    }]);
   }
   return ok(records.map(([id,v])=>({document:doc("partnerCountCatalog/"+id,v)})));
  }
  if(target.includes("/documents/")&&opts.method==="GET"){
   const path=decodeURIComponent(target.split("/documents/")[1]??"");
   assert(!["records/","products/","recordCorrections/"].some(p=>path.startsWith(p)));
   const item=data.get(path);
   return item?ok(doc(path,item)):new Response(null,{status:404});
  }
  throw Error("Mock refuses unapproved backend: "+target);
 };
 const handler=createPartnerCountCatalogHandler({
  enabled:true,fetcher,getServiceToken:async()=>"server_oauth",
  subtle:webcrypto.subtle,nowSeconds:()=>NOW
 });
 const request=(origin="https://nico-factory.web.app")=>
  new Request("https://worker.example/v1/partner-count-catalog",{
   headers:{Origin:origin,Authorization:"Bearer "+jwt()}
  });
 return {handler,request,calls};
}
test("verified partner sees only own current team and hub/custom nonfinancial catalog",async()=>{
 const f=setup();
 const res=await f.handler(f.request());
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{
  teams:[{teamId:"team1",name:"1班"}],
  products:[
   {catalogId:"shared:hub:NURO",name:"NURO",visibility:"shared_counts"},
   {catalogId:"custom:partnerA:own",name:"own",visibility:"private"}
  ].sort((a,b)=>a.name.localeCompare(b.name,"ja")||
    a.catalogId.localeCompare(b.catalogId))
 });
 assert(f.calls.some(c=>c.url.endsWith("/accounts:lookup")));
 assert.deepEqual(f.calls.filter(c=>c.url.includes("documents:runQuery"))
   .map(c=>c.body.structuredQuery.where.fieldFilter.value.stringValue).sort(),
   ["hub","partnerA"].sort());
 assert(f.calls.every(c=>!c.url.includes("/records/")&&!c.url.includes("/products/")));
});
test("disabled account, wrong origin, injected finance and wrong owner never return catalog",async()=>{
 for(const opt of [{disabled:true},{money:true},{foreign:true},{tooMany:true}]){
  const f=setup(opt);
  const response=await f.handler(f.request());
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:"request_blocked"});
 }
 const f=setup();
 const bad=await f.handler(f.request("https://keikei-p.github.io"));
 assert.equal(bad.status,403);
 assert.equal(f.calls.length,0);
});
test("default-OFF Worker catalog never invokes Firebase or credential exchange",async()=>{
 const before=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error("OFF should never call network");};
  const env={FIREBASE_PROJECT_ID:PROJECT,FINANCE_GATEWAY_ENABLED:"enabled",
   PARTNER_COUNT_WRITE_ENABLED:"disabled",
   PARTNER_COUNT_CATALOG_ENABLED:"disabled",
   PUBLIC_COUNT_PROJECTION_APPROVAL:"NOT_APPROVED",
   FINANCE_COST_APPROVAL:"NOT_APPROVED"};
  const req=setup().request();
  const res=await worker.fetch(req,env);
  assert.equal(res.status,503);
 }finally{globalThis.fetch=before;}
});
test("browser client validates catalog schema and does not transmit money or app credentials",async()=>{
 const f=setup();
 const api=createPartnerCountBrowserClient({
  enabled:true,origin:"https://nico-factory.web.app",
  gatewayBase:"https://worker.example",
  getIdToken:async()=>jwt(),
  fetcher:async(url,opts)=>{
   const request=new Request(url,{headers:{
    Origin:"https://nico-factory.web.app",Authorization:opts.headers.Authorization}});
   return f.handler(request);
  }
 });
 const data=await api.readCatalog();
 assert.equal(data.teams[0].teamId,"team1");
 assert.equal(data.products.length,2);
 assert(Object.isFrozen(data.products));
 const invalid=createPartnerCountBrowserClient({
  enabled:true,origin:"https://nico-factory.web.app",
  gatewayBase:"https://worker.example",
  getIdToken:async()=>jwt(),
  fetcher:async()=>new Response(JSON.stringify({teams:[],
   products:[{catalogId:"shared:hub:NURO",name:"NURO",visibility:"shared_counts",
    unitPrice:11000}]}),{status:200})
 });
 await assert.rejects(invalid.readCatalog(),/partner_count_client_blocked/);
});
test("Worker catalog requires separate OFF-by-default release flag",()=>{
 const src=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 const conf=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 assert(src.includes('env.PARTNER_COUNT_CATALOG_ENABLED==="enabled"'));
 assert(src.includes('env.FINANCE_WRITE_APPROVAL==="DUAL_HOST_BACKUP_VERIFIED"'));
 assert(conf.includes('PARTNER_COUNT_CATALOG_ENABLED = "disabled"'));
});
