"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {makeRankingOwnerCallables}=require("../functions-ranking-approvals/controller.cjs");
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code;}
}
const body=(data={},extra={})=>({
 data,auth:{uid:"owner",token:{email_verified:true,email:"owner@example.test"}},
 rawRequest:{headers:{authorization:"Bearer "+"x".repeat(40)}},
 ...extra
});
const args=(overrides={})=>{
 const counts={modules:0,token:0,status:0,save:0};
 const db={runTransaction:async fn=>fn({})};
 const FieldValue={serverTimestamp:()=>null};
 const settings={enabled:()=>true,db,FieldValue,HttpsError,
  getAuth:()=>({}),
  modules:async()=>{
   counts.modules++;
   return [
    {createVerifiedRankTokenReader:()=>async token=>{
      counts.token++;
      assert.equal(token,"x".repeat(40));
      return overrides.principal||{uid:"owner",email:"owner@example.test",emailVerified:true};
    }},
    {createOwnerRankingConsentStatusReader:()=>async principal=>{
      counts.status++;
      assert.equal(principal.uid,"owner");
      return overrides.status||{schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
       partners:[{partnerCompanyId:"partner",companyName:"協力店A",
        ownApproved:false,otherApproved:false,canEdit:true,version:0}]};
    }},
    {createRankingOwnerConsentService:()=>async input=>{
      counts.save++;
      if(overrides.onSave)return overrides.onSave(input);
      return {saved:true,partnerCompanyId:input.partnerCompanyId,
       enabled:input.enable,version:input.expectedVersion+1};
    }}
   ];
  },...overrides.settings
 };
 return {service:makeRankingOwnerCallables(settings),counts};
};
async function denies(work,code){
 await assert.rejects(work,(e)=>{
  assert.equal(e.code,code);
  assert(!/password|unitPrice|cashback|records|uid/.test(e.message));
  return true;
 });
}
test("environment flag defaults OFF: no auth, Firestore, services or server module access",async()=>{
 const counts={reads:0},s=makeRankingOwnerCallables({
  db:{runTransaction:()=>{counts.reads++;}},
  FieldValue:{serverTimestamp:()=>{}},getAuth:()=>{counts.reads++;},
  HttpsError,modules:async()=>{counts.reads++;return []}
 });
 await denies(s.status(body()),"failed-precondition");
 await denies(s.save(body({partnerCompanyId:"partner",enable:true,expectedVersion:0})),"failed-precondition");
 assert.equal(counts.reads,0);
});
test("status and save authenticate revoked real bearer and return ONLY approved fields",async()=>{
 const {service,counts}=args();
 assert.deepEqual(await service.status(body()),{
  schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
  partners:[{partnerCompanyId:"partner",companyName:"協力店A",
   ownApproved:false,otherApproved:false,version:0,canEdit:true}]
 });
 const response=await service.save(body({
  partnerCompanyId:"partner",enable:true,expectedVersion:0
 }));
 assert.deepEqual(response,{saved:true,partnerCompanyId:"partner",enabled:true,version:1});
 assert.equal(counts.status,1);assert.equal(counts.save,1);
 assert.equal(counts.token,2);
 assert.equal(counts.modules,1,"imports are cached for each Functions instance");
});
test("non-authenticated requests, invalid bearer and cross-UID/email claims are rejected",async()=>{
 for(const bad of [
  {auth:null},
  {auth:{uid:"notSafe",token:{email_verified:false,email:"owner@example.test"}}},
  {auth:{uid:"owner",token:{email_verified:true,email:"someone@example.test"}}},
  {rawRequest:{headers:{}}},
  {rawRequest:{headers:{authorization:"Basic abc"}}},
  {rawRequest:{headers:{authorization:"Bearer "+"/".repeat(50)}}}
 ]){
  const {service,counts}=args();
  await denies(service.status(body({},bad)),"unauthenticated");
  assert.equal(counts.status,0);
 }
 for(const principal of [
  {uid:"forged",email:"owner@example.test",emailVerified:true},
  {uid:"owner",email:"other@example.test",emailVerified:true}
 ]){
  const {service,counts}=args({principal});
  await denies(service.status(body()),"unauthenticated");
  assert.equal(counts.status,0);
 }
});
test("forged approval flags, workspace ID, partner code or unexpected data keys cannot reach database",async()=>{
 for(const data of [
  {partnerCompanyId:"partner",enable:true,expectedVersion:0,approvedByUid:"owner"},
  {partnerCompanyId:"partner",enable:true,expectedVersion:0,workspaceCompanyId:"hub"},
  {partnerCompanyId:"partner",enable:true,expectedVersion:0,codeSessionToken:"secret"},
  {partnerCompanyId:"partner",enable:true,expectedVersion:0,count:999999},
  {partnerCompanyId:"partner",enable:true,expectedVersion:0,totalRevenue:50000},
  {partnerCompanyId:"../../company",enable:true,expectedVersion:0},
  {partnerCompanyId:"partner",enable:"true",expectedVersion:0},
  {partnerCompanyId:"partner",enable:true,expectedVersion:-1},
  {partnerCompanyId:"partner",enable:true,expectedVersion:999}
 ]){
  const {service,counts}=args();
  await denies(service.save(body(data)),"invalid-argument");
  assert.equal(counts.save,0);
 }
 const {service}=args();
 await denies(service.status(body({partnerCompanyId:"partner"})),"invalid-argument");
});
test("financial and unexpected fields in status or save are discarded / refused",async()=>{
 const bad=args({status:{
  schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
  partners:[{partnerCompanyId:"partner",companyName:"協力店A",
   ownApproved:true,otherApproved:true,version:3,canEdit:true,unitPrice:50000}]
 }});
 await denies(bad.service.status(body()),"permission-denied");
 const evil=args({status:{
  schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
  partners:[],totalRevenue:50000
 }});
 await denies(evil.service.status(body()),"permission-denied");
 const save=args({onSave:async()=>({
  saved:true,partnerCompanyId:"partner",enabled:true,version:1,cashback:4000
 })});
 await denies(save.service.save(body({
  partnerCompanyId:"partner",enable:true,expectedVersion:0
 })),"permission-denied");
});
test("wrong version, unexpected save response or forged company cause fail closed",async()=>{
 const cases=[
  {saved:true,partnerCompanyId:"partner",enabled:true,version:2},
  {saved:true,partnerCompanyId:"other",enabled:true,version:1},
  {saved:true,partnerCompanyId:"partner",enabled:false,version:1},
  {saved:false,partnerCompanyId:"partner",enabled:true,version:1},
  {saved:true,partnerCompanyId:"partner",enabled:true,version:"1"}
 ];
 for(const out of cases){
  const {service}=args({onSave:async()=>out});
  await denies(service.save(body({
   partnerCompanyId:"partner",enable:true,expectedVersion:0
  })),"permission-denied");
 }
});
test("approved server errors never leak unexpected business details",async()=>{
 const {service,counts}=args({onSave:async()=>{throw Error("partner@example.com: 90000円");}});
 await denies(service.save(body({partnerCompanyId:"partner",enable:true,expectedVersion:0})),"permission-denied");
 assert.equal(counts.save,1);
});
test("isolation and no production side effects are explicit in the new Firebase codebase",()=>{
 const source=readFileSync(new URL("../functions-ranking-approvals/index.js",`file://${__filename}`),"utf8");
 assert.match(source,/NICO_RANKING_OWNER_SETTINGS_ENABLED/);
 assert.match(source,/getRankingOwnerConsentStatus/);
 assert.match(source,/setRankingOwnerConsent/);
 assert.doesNotMatch(source,/submitPartnerWorkspaceCounts|firebase deploy|firebase-admin\/database/);
});
