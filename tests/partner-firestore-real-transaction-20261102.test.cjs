"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createRequire}=require("node:module");
const fromPartnerPackage=createRequire(require.resolve("../functions-partner-workspace/package.json"));
const {initializeApp,getApps}=fromPartnerPackage("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=fromPartnerPackage("firebase-admin/firestore");
const {makeWorkspace,KEYS}=require("../functions-partner-workspace/service.cjs");

class CallError extends Error{constructor(code,message){super(message);this.code=code;}}
const date="2026-11-02", project="demo-nico-partner-count-save-tx",now=Date.parse("2026-11-02T12:00:00+09:00");
function request(data){return {
 auth:{uid:"owner1",token:{email:"owner1@example.com",email_verified:true}},
 rawRequest:{headers:{authorization:"Bearer "+"x".repeat(80)}},data
};}
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
test("real Firestore transaction: partner save then view, correction, audit and immutable team",async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,"emulator required; never connect to real production");
 if(!getApps().length)initializeApp({projectId:project});
 const db=getFirestore(),nonce="e2e_case_20261102";
 const hub="hub_"+nonce,partner="partner_"+nonce,person="staff_"+nonce,team="team_"+nonce;
 const owner={uid:"owner1",companyId:partner,role:"leader",companyRole:"owner",
  active:true,accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false};
 const batch=db.batch();
 batch.set(db.doc("companies/"+hub),{name:"内部会社",ownerUid:"admin",active:true,companyKind:"internal"});
 batch.set(db.doc("companies/"+partner),{name:"検証協力店",ownerUid:"owner1",
   companyKind:"partner",hubCompanyId:hub,active:true});
 batch.set(db.doc("users/owner1"),owner);
 batch.set(db.doc("companies/"+partner+"/members/owner1"),owner);
 batch.set(db.doc("partnerRelations/"+partner),{partnerCompanyId:partner,hubCompanyId:hub,
   active:true,countSharingApproved:true});
 batch.set(db.doc("companies/"+partner+"/partnerWorkTeams/"+team),{
   companyId:partner,name:"第1班",active:true});
 batch.set(db.doc("companies/"+partner+"/partnerWorkStaff/"+person),{
   companyId:partner,teamId:team,kind:"managed",name:"テスト担当",active:true});
 await batch.commit();
 const auth=()=>({
  getUser:async uid=>({uid,disabled:false,emailVerified:true,email:"owner1@example.com"}),
  verifyIdToken:async()=>({uid:"owner1",email:"owner1@example.com",email_verified:true})
 });
 const api=makeWorkspace({db,getAuth:auth,FieldValue,Timestamp,HttpsError:CallError,
  now:()=>now,enabled:()=>true});
 const counts=zero();counts.NURO=3;counts.SBMNP=1;
 const cbCounts={NURO:{"0":1,"20000":2}};
 const payload={date,staffId:person,counts,cbCounts,privateCounts:{},
   expectedVersion:0,workTeamId:team,workLocation:"大型催事"};
 const initial=await api.view(request({date}));
 assert.equal(initial.role,"owner");
 assert.equal(initial.records.length,0);
 const saved=await api.submit(request(payload));
 assert.equal(saved.saved,true);assert.equal(saved.version,1);
 const result=await api.view(request({date}));
 assert.equal(result.records.length,1);assert.equal(result.records[0].totalCount,4);
 assert.equal(result.records[0].cbCounts.NURO["20000"],2);
 const summary=await db.doc("companies/"+hub+"/partnerWorkCountDays/"+date+"/reports/"+partner).get();
 assert.equal(summary.data().source,"staff-entries-v1");
 assert.equal(summary.data().totalCount,4);
 // Retrying a version-zero save cannot double count or overwrite first save.
 await assert.rejects(api.submit(request(payload)),e=>e.code==="aborted");
 const corrected={...counts,NURO:4};const second=await api.submit(request({
  ...payload,counts:corrected,cbCounts:{NURO:{"0":1,"20000":3}},
  expectedVersion:1,workTeamId:undefined
 }));
 assert.equal(second.version,2);
 const verified=await api.view(request({date,includeAuditHistory:true}));
 assert.equal(verified.records[0].totalCount,5);
 assert.equal(verified.records[0].teamIdSnapshot,team);
 assert.equal(verified.audits.length,2);
 assert.equal(verified.audits[1].previousTotalCount,4);
 const updated=await db.doc("companies/"+hub+"/partnerWorkCountDays/"+date+"/reports/"+partner).get();
 assert.equal(updated.data().totalCount,5);
});
