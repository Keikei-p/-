import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,webcrypto} from "node:crypto";
import reporter from "../reports/worker.mjs";

const project="sales-management-cc116";
const base="projects/"+project+"/databases/(default)/documents";
const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const secret=JSON.stringify({
 client_email:"testing-only@example.test",
 private_key:privateKey.export({format:"pem",type:"pkcs8"}).toString()
});
function typed(v){
 if(v==null)return {nullValue:null};
 if(typeof v==="string")return {stringValue:v};
 if(typeof v==="boolean")return {booleanValue:v};
 if(typeof v==="number")return {integerValue:String(v)};
 if(Array.isArray(v))return {arrayValue:{values:v.map(typed)}};
 return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,typed(x)]))}};
}
function firestoreDoc(path,fields){
 return {name:base+"/"+path,
 fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,typed(v)]))};
}
const weekdays=[4]; // 2026-10-29 is Thursday in Tokyo
const settings={
 hub:{enabled:true,lineEnabled:true,lineGroupId:"group_test",
  weekdays,aggregatePartnerReports:true,
  linkedCompanyIds:["partner"],partnerTeamIds:["hub-partner"]},
 partner:{enabled:true,lineEnabled:true,lineGroupId:"group_partner",
  weekdays,linkedHubCompanyId:"hub",countsShareApproved:true,
  countsShareLineGroupId:"group_test"}
};
function fixture({live=true,consent=true}={}){
 const calls=[],sent=[],dispatches=[];
 const companyDocs=[
  firestoreDoc("companies/hub",{name:"自社",active:true}),
  firestoreDoc("companies/partner",{name:"協力店A",active:true})
 ];
 const byCompany={
  hub:{
   teams:[
    firestoreDoc("teams/hub-team",{companyId:"hub",name:"自社1班",active:true}),
    firestoreDoc("teams/hub-partner",{companyId:"hub",name:"自社所属協力店",active:true})
   ],
   goals:[
    firestoreDoc("goals/goal-own",{companyId:"hub",month:"2026-10",teamId:"hub-team",targets:{a:10}}),
    firestoreDoc("goals/goal-partner",{companyId:"hub",month:"2026-10",teamId:"hub-partner",targets:{a:7}})
   ],
   records:[
    firestoreDoc("records/hub-r1",{companyId:"hub",date:"2026-10-29",teamId:"hub-team",
      totalCount:4,totalRevenue:150000,results:{a:{count:4,revenuePerUnit:10000,cashback:40000}}}),
    firestoreDoc("records/hub-r2",{companyId:"hub",date:"2026-10-29",teamId:"hub-partner",
      totalCount:2,totalRevenue:50000,results:{a:{count:2,revenuePerUnit:8000,cashback:20000}}})
   ]
  },
  partner:{
   teams:[firestoreDoc("teams/p1",{companyId:"partner",name:"協力店1班",active:true})],
   goals:[firestoreDoc("goals/goal-p1",{companyId:"partner",month:"2026-10",
     teamId:"p1",targets:{a:12}})],
   records:[firestoreDoc("records/p-r1",{companyId:"partner",date:"2026-10-29",teamId:"p1",
     totalCount:3,totalRevenue:90000,results:{a:{count:3,revenuePerUnit:30000}}})]
  }
 };
 const fetchMock=async(url,init={})=>{
  const u=new URL(url),method=init.method??"GET";
  calls.push({path:u.pathname,method});
  const ok=v=>({ok:true,status:200,json:async()=>v});
  if(u.hostname==="oauth2.googleapis.com")
   return ok({access_token:"synthetic-test-token"});
  if(u.hostname==="api.line.me"){
   const body=JSON.parse(init.body);
   sent.push(body);
   return ok({});
  }
  if(u.hostname!=="firestore.googleapis.com")
   throw Error("Test blocked unexpected network destination");
  if(method==="GET"&&u.pathname.endsWith("/documents/companies"))
   return ok({documents:companyDocs});
  for(const cid of ["hub","partner"]){
   if(method==="GET"&&u.pathname.endsWith(
     "/documents/companies/"+cid+"/settings/notifications"
   )){
    const s=cid==="partner"&&!consent
      ?{...settings.partner,countsShareApproved:false}:settings[cid];
    return ok(firestoreDoc("companies/"+cid+"/settings/notifications",s));
   }
  }
  if(method==="POST"&&u.pathname.endsWith("/documents:runQuery")){
   const q=JSON.parse(init.body).structuredQuery;
   const collection=q.from[0].collectionId;
   const filters=q.where.compositeFilter?.filters??[q.where];
   const company=filters.find(x=>x.fieldFilter.field.fieldPath==="companyId")
      ?.fieldFilter.value.stringValue;
   if(!byCompany[company]||!["teams","goals","records"].includes(collection))
    throw Error("Blocked unknown test query");
   return ok(byCompany[company][collection].map(document=>({document})));
  }
  if(method==="POST"&&u.pathname.endsWith("/documents/notificationDispatches")){
   dispatches.push({kind:"reserve",doc:u.searchParams.get("documentId")});
   return ok({});
  }
  if(method==="PATCH"&&u.pathname.includes("/notificationDispatches/")){
   dispatches.push({kind:"sent"});
   return ok({});
  }
  throw Error("Blocked unexpected Firestore test operation");
 };
 return {fetchMock,calls,sent,dispatches,env:{
   REPORT_DELIVERY_ENABLED:live?"true":"false",
   FIREBASE_PROJECT_ID:project,
   FIREBASE_SERVICE_ACCOUNT_JSON:secret,
   LINE_CHANNEL_ACCESS_TOKEN:"synthetic-line-token"
 }};
}
async function run(opts){
 const fixtureData=fixture(opts);
 const previousFetch=globalThis.fetch,previousCrypto=globalThis.crypto;
 try{
  globalThis.fetch=fixtureData.fetchMock;
  globalThis.crypto=webcrypto;
  await reporter.scheduled({
   cron:"0 0 * * *",scheduledTime:Date.parse("2026-10-29T00:00:00Z")
  },fixtureData.env);
 }finally{
  globalThis.fetch=previousFetch;
  globalThis.crypto=previousCrypto;
 }
 return fixtureData;
}
test("one synthetic LINE post combines own teams and approved partner company (no revenue)",async()=>{
 const data=await run({live:true});
 assert.equal(data.sent.length,1,
   "two companies sharing one hub must not post duplicate morning messages");
 const body=data.sent[0];
 assert.equal(body.to,"group_test");
 const text=body.messages[0].text;
 for(const label of ["自社1班","自社所属協力店","協力店A","協力店1班",
   "合計目標：29件","合計実績：9件"]){
  assert.match(text,new RegExp(label));
 }
 for(const privateTerm of ["150000","90000","50000","30000","40000",
   "20000","totalRevenue","revenuePerUnit","cashback","単価","売上"]){
  assert.equal(text.includes(privateTerm),false,
   "LINE must never expose private field or monetary value");
 }
 assert.deepEqual(data.dispatches.map(x=>x.kind),["reserve","sent"]);
});
test("DRY RUN produces no LINE sends and no Firestore notification writes",async()=>{
 const data=await run({live:false});
 assert.equal(data.sent.length,0);
 assert.equal(data.dispatches.length,0);
});
