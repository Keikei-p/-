import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
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
function fixture({live=true,consent=true,mutate=undefined,dryRunValidate=false,notificationEnabled=true,lineEnabled=true}={}){
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
      uid:"hub-u1",reportStatus:"submitted",totalCount:4,totalRevenue:150000,results:{a:{count:4,revenuePerUnit:10000,cashback:40000}}}),
    firestoreDoc("records/hub-r2",{companyId:"hub",date:"2026-10-29",teamId:"hub-partner",
      uid:"hub-partner-u1",reportStatus:"submitted",totalCount:2,totalRevenue:50000,results:{a:{count:2,revenuePerUnit:8000,cashback:20000}}})
   ]
  },
  partner:{
   teams:[firestoreDoc("teams/p1",{companyId:"partner",name:"協力店1班",active:true})],
   goals:[firestoreDoc("goals/goal-p1",{companyId:"partner",month:"2026-10",
     teamId:"p1",targets:{a:12}})],
   records:[firestoreDoc("records/p-r1",{companyId:"partner",date:"2026-10-29",teamId:"p1",
     uid:"partner-u1",reportStatus:"submitted",totalCount:3,totalRevenue:90000,results:{a:{count:3,revenuePerUnit:30000}}})]
  }
 };
 if(typeof mutate==="function")mutate(byCompany);
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
    const original=cid==="partner"&&!consent
      ?{...settings.partner,countsShareApproved:false}:settings[cid];
    const s={...original,enabled:notificationEnabled,lineEnabled};
    return ok(firestoreDoc("companies/"+cid+"/settings/notifications",s));
   }
  }
  if(method==="GET"&&u.pathname.endsWith("/documents/companies/hub/members"))
   return ok({documents:[
    firestoreDoc("companies/hub/members/hub-u1",{uid:"hub-u1",active:true,teamId:"hub-team"}),
    firestoreDoc("companies/hub/members/hub-u2",{uid:"hub-u2",active:true,teamId:"hub-team"}),
    firestoreDoc("companies/hub/members/hub-partner-u1",{uid:"hub-partner-u1",active:true,teamId:"hub-partner"})
   ]});
  if(method==="GET"&&u.pathname.endsWith("/documents/companies/partner/members"))
   return ok({documents:[
    firestoreDoc("companies/partner/members/partner-u1",{uid:"partner-u1",active:true,teamId:"p1"})
   ]});
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
   REPORT_DRY_RUN_VALIDATE:dryRunValidate?"true":"false",
   FIREBASE_PROJECT_ID:project,
   FIREBASE_SERVICE_ACCOUNT_JSON:secret,
   LINE_CHANNEL_ACCESS_TOKEN:"synthetic-line-token"
 }};
}
async function run(opts){
 const fixtureData=fixture(opts);
 const previousFetch=globalThis.fetch;
 try{
  globalThis.fetch=fixtureData.fetchMock;
  await reporter.scheduled({
   cron:opts?.cron??"0 0 * * *",
   scheduledTime:Date.parse(opts?.cron==="5 10 * * *"
     ?"2026-10-29T10:05:00Z":opts?.cron==="0 10 * * *"
       ?"2026-10-29T10:00:00Z":"2026-10-29T00:00:00Z")
  },fixtureData.env);
 }finally{
  globalThis.fetch=previousFetch;
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


test("revoked cross-company consent never sends partner data to the main hub",async()=>{
 const data=await run({live:true,consent:false});
 assert.equal(data.sent.some(x=>x.to==="group_test"),false);
 assert(data.sent.every(x=>x.to!=="group_test"));
 for(const item of data.sent){
  const text=item.messages[0].text;
  assert.doesNotMatch(text,/自社1班|自社所属協力店/);
 }
});

test("LINE report refuses corrupted or cross-company source instead of sending a plausible total",async()=>{
 const cases=[
  by=>{by.hub.records[0].fields.companyId={stringValue:"other"};},
  by=>{by.hub.records[0].fields.date={stringValue:"2026-09-29"};},
  by=>{by.hub.records[0].fields.totalCount={nullValue:null};},
  by=>{by.hub.records[0].fields.teamId={stringValue:"missing-team"};},
  by=>{by.hub.records.push(structuredClone(by.hub.records[0]));},
  by=>{by.hub.goals.push(structuredClone(by.hub.goals[0]));}
 ];
 for(const mutate of cases){
  const result=await run({live:true,mutate});
  assert.equal(result.sent.length,0,"corrupt reports must not reach LINE");
  assert.equal(result.dispatches.length,0,"corrupt reports must not reserve sends");
 }
});
test("dry-run never writes to Firestore or sends to LINE, even when reports are valid",async()=>{
 const result=await run({live:false});
 assert.equal(result.sent.length,0);
 assert.equal(result.dispatches.length,0);
});

test("disabled delivery consumes zero privileged Firebase reads and needs no secrets",async()=>{
 const f=fixture({live:false});
 delete f.env.FIREBASE_SERVICE_ACCOUNT_JSON;
 delete f.env.LINE_CHANNEL_ACCESS_TOKEN;
 const saved=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error("network must not be accessed when OFF");};
  await reporter.scheduled({cron:"0 0 * * *",scheduledTime:Date.parse("2026-10-29T00:00:00Z")},f.env);
  assert.equal(f.calls.length,0);
  assert.equal(f.sent.length,0);
  assert.equal(f.dispatches.length,0);
 }finally{globalThis.fetch=saved;}
});
test("explicit dry-run verification may read counts but cannot send or create dispatches",async()=>{
 const f=await run({live:false,dryRunValidate:true});
 assert.ok(f.calls.some(x=>x.path.includes("/documents:runQuery")));
 assert.equal(f.sent.length,0);
 assert.equal(f.dispatches.length,0);
});

test("same employee submitting two separate documents cannot hide another unreported employee",async()=>{
 const result=await run({
  live:true,cron:"5 10 * * *",mutate:by=>{
   const duplicate=structuredClone(by.hub.records[0]);
   duplicate.name=duplicate.name.replace("/hub-r1","/hub-r1-duplicate");
   by.hub.records.push(duplicate);
  }
 });
 assert.equal(result.sent.length,1);
 const message=result.sent[0].messages[0].text;
 assert.match(message,/自社1班/,"unreported coworker must remain in the reminder");
 assert.match(message,/未報告/);
 assert.equal(message.includes("totalRevenue"),false);
});
test("no missing reminder when distinct expected employees each submitted",async()=>{
 const result=await run({
  live:true,cron:"5 10 * * *",mutate:by=>{
   const another=structuredClone(by.hub.records[0]);
   another.name=another.name.replace("/hub-r1","/hub-r1-other");
   another.fields.uid={stringValue:"hub-u2"};
   by.hub.records.push(another);
  }
 });
 assert.equal(result.sent.length,0,"all real members have reported: no message");
});

test("the SAME notification ON/OFF controls morning, final and unreported LINE sends",async()=>{
 const crons=["0 0 * * *","0 10 * * *","5 10 * * *"];
 for(const cron of crons){
  const muted=await run({live:true,cron,notificationEnabled:false});
  assert.equal(muted.sent.length,0,"disabled main notification switch: "+cron);
  assert.equal(muted.dispatches.length,0,"disabled notification never reserves: "+cron);
  assert.equal(muted.calls.some(x=>x.path.includes("/documents:runQuery")),false,
   "no costly sales/goal Firestore queries on OFF: "+cron);
  const unlinked=await run({live:true,cron,lineEnabled:false});
  assert.equal(unlinked.sent.length,0,"LINE not enabled: "+cron);
  assert.equal(unlinked.dispatches.length,0,"no reserve if LINE off: "+cron);
 }
});
test("morning/final/missing all use a single approved LINE destination",async()=>{
 const crons=["0 0 * * *","0 10 * * *","5 10 * * *"];
 for(const cron of crons){
  const runData=await run({live:true,cron});
  assert(runData.sent.length<=1,"never duplicate grouped company dispatches");
  for(const delivery of runData.sent){
   assert.equal(delivery.to,"group_test");
   const message=delivery.messages[0].text;
   for(const privateTerm of ["totalRevenue","revenuePerUnit","cashback","単価","売上"])
    assert.equal(message.includes(privateTerm),false);
  }
 }
});
