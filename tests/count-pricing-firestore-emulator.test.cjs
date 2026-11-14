"use strict";
const {test,before,beforeEach,after}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

// Never initialize an SDK, clear data or load Rules outside this exact demo
// project and loopback emulator. All users/rates/history below are fictional.
const PROJECT="demo-sales-support";
if(!/^(?:127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST||"")||
 process.env.FIREBASE_PROJECT_ID!==PROJECT||process.env.GCLOUD_PROJECT!==PROJECT||
 ["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON","FIREBASE_TOKEN",
  "GOOGLE_OAUTH_ACCESS_TOKEN"].some(name=>Boolean(process.env[name])))
 throw Error("STOP_PRICING_TEST_REQUIRES_LOCAL_DEMO_WITH_ZERO_PRODUCTION_CREDENTIALS");

const {initializeTestEnvironment}=require("@firebase/rules-unit-testing");
const {doc,setDoc,getDocFromServer,getDocsFromServer,collection,query,where,
 runTransaction,serverTimestamp,Timestamp}=require("firebase/firestore");
const html=fs.readFileSync(process.env.SALES_HTML||path.join(__dirname,"../index.html"),"utf8").replace(/\r\n/g,"\n");
const rules=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
const company="company-a",RATE=10000;
let env;
const members={
 owner:{companyRole:"owner",role:"leader",teamId:"a",canViewRevenue:true,canViewUnitPrice:true},
 leaderA:{role:"leader",teamId:"a",canViewRevenue:true,canViewUnitPrice:true},
 leaderB:{role:"leader",teamId:"b",canViewRevenue:true,canViewUnitPrice:true},
 helper:{role:"member",teamId:"b",canViewRevenue:true,canViewUnitPrice:true},
 inactive:{role:"member",teamId:"b",active:false,canViewRevenue:true},
 foreign:{role:"member",teamId:"foreign-team",companyId:"company-b",canViewRevenue:true}
};
const dbFor=uid=>env.authenticatedContext(uid,{email:uid+"@example.test",email_verified:true}).firestore();
const key=(date,uid="helper")=>company+"_"+uid+"_"+date;
const product=format=>({companyId:company,name:"匿名商材（名称変更後）",revenue:RATE,
 cashbackOptions:[0],pricingOptions:format==="explicit"?[{cashback:0,revenuePerUnit:RATE}]:[],
 active:true,sortOrder:0,createdAt:Timestamp.fromMillis(1),updatedAt:Timestamp.fromMillis(1)});
const result=(count,unit=RATE)=>count?{sku__cb_0:{productId:"sku",productName:"匿名商材",
 cashback:0,count,revenuePerUnit:unit}}:{};
function source(name){
 let start=html.indexOf("function "+name+"(");
 assert(start>=0,"Missing actual index function "+name);
 if(html.slice(start-6,start)==="async ")start-=6;
 const end=html.indexOf("\n}",start);assert(end>start);
 return html.slice(start,end+2);
}
const names=["getProductPricingOptions","verifyNewRecordPricing","verifyChangedRecordPricing",
 "normalizeExistingResultMap","resultVariantKey","parseLegacyCashbackProductName",
 "normalizeCashbackOptions","toHalfWidthNumberText","validateFinancialRecordForSave",
 "recordRevision","recordConflict","persistDailyRecord"];
const auditStart=html.indexOf("const writeCorrection = existingDailyRecord");
const auditEnd=html.indexOf("await persistDailyRecord(",auditStart);
assert(auditStart>=0&&auditEnd>auditStart,"Missing actual index append-only audit callback");
const auditSource=html.slice(auditStart,auditEnd);
function app(db,actor){
 // Firestore rejects cross-VM Object prototypes. Evaluate the unchanged
 // source in the SDK's native realm, just as a browser module would, rather
 // than translating or mocking any transaction/audit value.
 const build=new Function("bindings",`
  const {db,doc,collection,query,where,runTransaction,getDocsFromServer,serverTimestamp,
   recordsCollectionQuery,currentUser,currentUserData}=bindings;
  ${names.map(source).join("\n")}
  return {${names.join(",")},makeAudit({existingDailyRecord,recordRef,data,targetUid,date}){
   ${auditSource}
   return writeCorrection;
  }};
 `);
 return build({db,doc,collection,query,where,runTransaction,getDocsFromServer,
  serverTimestamp,recordsCollectionQuery:()=>query(collection(db,"records"),where("companyId","==",company)),
  currentUser:{uid:actor},currentUserData:{uid:actor,companyId:company,name:"匿名操作者"}});
}
function update(actor,date,count){
 return {companyId:company,uid:"helper",date,teamId:"a",teamNameSnapshot:"匿名班A",
  memberNameSnapshot:"匿名担当者",workLocation:"匿名現場",results:result(count),
  totalCount:count,totalRevenue:count*RATE,reportStatus:count?"submitted":"no_result",
  reportedAt:serverTimestamp(),updatedByUid:actor,updatedAt:serverTimestamp()};
}
async function seedRecord(date,count,format="legacy",extra={}){
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,"products","sku"),product(format));
  await setDoc(doc(db,"records",key(date)),{...update("owner",date,count),
   createdByUid:"owner",createdAt:Timestamp.fromMillis(2),legacyMarker:"keep-saved-original-metadata",...extra});
 });
}
async function readRecord(db,date){
 const snap=await getDocFromServer(doc(db,"records",key(date)));
 assert.equal(snap.metadata.fromCache,false,"readback must come from actual emulator server");
 assert.equal(snap.exists(),true);return {id:snap.id,...snap.data()};
}
async function save(db,actor,date,count,{before,api=app(db,actor),catalog,data,writeCorrection}={}){
 const ref=doc(db,"records",key(date));
 before??=await readRecord(db,date);
 catalog??=[{id:"sku",...(await getDocFromServer(doc(db,"products","sku"))).data()}];
 data??=update(actor,date,count);
 const problem=api.verifyChangedRecordPricing(data.results,before.results,catalog);
 if(problem){const error=new Error("DEMO_PRICING_REJECTED");error.code="pricing-rejected";throw error;}
 api.validateFinancialRecordForSave(data);
 // The SAME audit callback used by index's real save button is passed into
 // the SAME SDK transaction as the result replacement. No parallel writer.
 const audit=api.makeAudit({existingDailyRecord:before,recordRef:ref,data,targetUid:"helper",date});
 await api.persistDailyRecord(ref,data,before,api.recordRevision(before),writeCorrection||audit);
 return readRecord(db,date);
}
async function audits(db,id){
 return (await getDocsFromServer(query(collection(db,"recordCorrections"),
  where("companyId","==",company),where("recordId","==",id)))).docs.map(s=>({id:s.id,...s.data()}));
}
async function dump(){
 return env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore(),result={};
  for(const name of ["records","recordCorrections","products","users","companies","teams"])
   result[name]=(await getDocsFromServer(collection(db,name))).docs
    .map(s=>[s.id,s.data()]).sort((a,b)=>a[0].localeCompare(b[0]));
  for(const uid of Object.keys(members)){
   const cid=members[uid].companyId||company;
   const snap=await getDocFromServer(doc(db,"companies",cid,"members",uid));
   result[cid+"/members/"+uid]=snap.data();
  }
  return result;
 });
}
before(async()=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(":");
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host,port:Number(port),rules}});
});
beforeEach(async()=>{
 await env.clearFirestore(); // Exact demo / localhost guards above run first.
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,"companies",company),{ownerUid:"owner",masterUid:"owner"});
  await setDoc(doc(db,"companies","company-b"),{ownerUid:"foreign"});
  for(const [uid,member] of Object.entries(members)){
   const data={uid,name:"匿名担当者",companyId:company,companyRole:"member",active:true,
    teamHistory:[{effectiveDate:"2026-10-01",fromTeamId:null,toTeamId:member.teamId}],...member};
   await setDoc(doc(db,"users",uid),data);
   await setDoc(doc(db,"companies",data.companyId,"members",uid),data);
  }
  for(const id of ["a","b","foreign-team"])await setDoc(doc(db,"teams",id),{
   companyId:id==="foreign-team"?"company-b":company,name:"匿名班"+id,active:true});
  await setDoc(doc(db,"recordCorrections","retained-audit"),{companyId:company,
   recordId:"older-original",recordUid:"helper",recordDate:"2026-09-30",
   changedByUid:"owner",changedByName:"匿名Owner",before:{totalCount:1},after:{totalCount:2},
   createdAt:Timestamp.fromMillis(1)});
 });
});
after(async()=>{await env?.cleanup();});

test("actual Rules + SDK + index pricing/persist: Owner, team Leader and self staff save and SERVER-reload 5→6, 5→4, 0→1",{timeout:120000},async()=>{
 let index=0;
 const ownerDb=dbFor("owner"),oldAudit=(await getDocFromServer(doc(ownerDb,"recordCorrections","retained-audit"))).data();
 for(const format of ["legacy","explicit"])for(const actor of ["owner","leaderA","helper"])
  for(const [count,next] of [[5,6],[5,4],[0,1]]){
   const date="2026-10-"+String(++index).padStart(2,"0"),db=dbFor(actor);
   await seedRecord(date,count,format);
   const before=await readRecord(db,date),catalog=(await getDocFromServer(doc(db,"products","sku"))).data();
   const saved=await save(db,actor,date,next);
   assert.equal(saved.id,key(date));assert.equal(saved.companyId,company);assert.equal(saved.uid,"helper");
   assert.equal(saved.teamId,before.teamId);assert.equal(saved.date,date);assert.equal(saved.totalCount,next);
   assert.equal(saved.totalRevenue,next*RATE);assert.equal(saved.results.sku__cb_0.revenuePerUnit,RATE);
   assert.deepEqual(saved.createdAt,before.createdAt);assert.equal(saved.createdByUid,before.createdByUid);
   assert.equal(saved.legacyMarker,before.legacyMarker);
   assert.notDeepEqual(saved.updatedAt,before.updatedAt);
   const exact=await getDocsFromServer(query(collection(db,"records"),where("companyId","==",company),
    where("uid","==","helper"),where("date","==",date)));
   assert.equal(exact.size,1,"never create another same-day canonical/legacy report");
   const history=await audits(ownerDb,key(date));assert.equal(history.length,1);
   assert.equal(history[0].changedByUid,actor);assert.equal(history[0].before.totalCount,count);
   assert.equal(history[0].after.totalCount,next);assert.equal(history[0].after.totalRevenue,next*RATE);
   assert.deepEqual((await getDocFromServer(doc(db,"products","sku"))).data(),catalog);
   assert.deepEqual((await getDocFromServer(doc(ownerDb,"recordCorrections","retained-audit"))).data(),oldAudit);
  }
});

test("actual Rules + SDK: bad prices, unknown rates, unapproved scopes and failed audit leave every original unchanged",{timeout:120000},async()=>{
 const date="2026-10-20",ownerDb=dbFor("owner");await seedRecord(date,5);
 const before=await readRecord(ownerDb,date);
 for(const catalog of [
  {...product("explicit"),id:"sku",pricingOptions:[{cashback:0,revenuePerUnit:RATE+1}]},
  {...product("explicit"),id:"sku",pricingOptions:[{cashback:0,revenuePerUnit:RATE},{cashback:0,revenuePerUnit:RATE}]},
  {...product("explicit"),id:"sku",pricingOptions:[{cashback:0,revenuePerUnit:null}]}
 ])for(const count of [6,4]){
  const original=await dump();
  await assert.rejects(save(ownerDb,"owner",date,count,{before,catalog:[catalog]}),{code:"pricing-rejected"});
  assert.deepEqual(await dump(),original);
 }
 const badTotals=update("owner",date,6);badTotals.totalRevenue++;
 let original=await dump();
 await assert.rejects(save(ownerDb,"owner",date,6,{before,data:badTotals}),{code:"record-conflict"});
 assert.deepEqual(await dump(),original);
 for(const actor of ["leaderB","inactive","foreign"]){
  const db=dbFor(actor);original=await dump();
  await assert.rejects(save(db,actor,date,6,{before,catalog:[{id:"sku",...product("legacy")}]}),
   error=>error.code==="permission-denied");
  assert.deepEqual(await dump(),original);
 }
 // Replacing an existing append-only audit is denied by the ACTUAL Rules;
 // the accompanying records update must roll back in the same transaction.
 original=await dump();
 await assert.rejects(save(ownerDb,"owner",date,6,{before,writeCorrection:tx=>
  tx.set(doc(ownerDb,"recordCorrections","retained-audit"),{companyId:company,changedByUid:"owner"})}),
  error=>error.code==="permission-denied");
 assert.deepEqual(await dump(),original);
 for(const unknown of [null,""]){
  await seedRecord(date,5,"explicit",{results:{sku__cb_0:{...result(5).sku__cb_0,revenuePerUnit:unknown}}});
  const stored=await readRecord(ownerDb,date);original=await dump();
  await assert.rejects(save(ownerDb,"owner",date,5,{before:stored}),{code:"pricing-rejected"});
  assert.deepEqual(await dump(),original);
 }
});

test("actual SDK transactions: simultaneous editors and double-submit commit only one saved version and one audit",{timeout:120000},async()=>{
 for(const [index,actors] of [[0,["owner","leaderA"]],[1,["helper","helper"]]]){
  const date="2026-10-"+(25+index);await seedRecord(date,5);
  const dbs=actors.map(dbFor),before=await readRecord(dbs[0],date);
  const outcome=await Promise.allSettled(dbs.map((db,i)=>save(db,actors[i],date,i?4:6,{before})));
  assert.equal(outcome.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(outcome.filter(x=>x.status==="rejected"&&x.reason.code==="record-conflict").length,1);
  const ownerDb=dbFor("owner"),saved=await readRecord(ownerDb,date),history=await audits(ownerDb,key(date));
  assert([4,6].includes(saved.totalCount));assert.equal(saved.totalRevenue,saved.totalCount*RATE);
  assert.equal(saved.results.sku__cb_0.revenuePerUnit,RATE);assert.equal(history.length,1);
  assert.equal(history[0].before.totalCount,5);assert.equal(history[0].after.totalCount,saved.totalCount);
  assert.deepEqual(saved.createdAt,before.createdAt);
  assert.equal((await getDocFromServer(doc(ownerDb,"recordCorrections","retained-audit"))).exists(),true);
 }
});
