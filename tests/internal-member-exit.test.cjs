"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {makeInternalMemberExit}=require("../functions-partner-workspace/internal-member-exit.cjs");
const {makeInternalSelfAccountExit}=require("../functions-partner-workspace/internal-self-account-exit.cjs");
const cp=x=>JSON.parse(JSON.stringify(x));
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
class DB{
 constructor(){this.docs=new Map();this.writes=[];}
 collection(name){return this.col(name);}
 col(path){return {doc:id=>this.ref(path+"/"+id)};}
 ref(path){return {path,collection:name=>this.col(path+"/"+name)};}
 seed(path,v){this.docs.set(path,cp(v));}
 async runTransaction(fn){
  const pending=[];
  const tx={get:async ref=>({exists:this.docs.has(ref.path),
   data:()=>cp(this.docs.get(ref.path)??null)}),
   update:(ref,data)=>pending.push([ref.path,cp(data)])};
  const out=await fn(tx);
  for(const [path] of pending)if(!this.docs.has(path))throw Error("missing");
  for(const [path,data] of pending){this.docs.set(path,{...this.docs.get(path),...data});this.writes.push(path);}
  return out;
 }
}
function setup({kind="internal",context=null}={}){
 const db=new DB();
 db.seed("users/owner",{uid:"owner",companyId:"hub",companyRole:"owner",active:true,accessKind:"internal"});
 db.seed("companies/hub",{ownerUid:"owner",companyKind:"internal",active:true});
 db.seed("companies/hub/members/owner",{uid:"owner",companyRole:"owner",active:true});
 db.seed("companies/hub/members/staff",{uid:"staff",companyId:"hub",companyRole:"member",
  active:true,memberType:kind==="managed"?"managed":"direct",teamHistory:[{teamId:"A"}]});
 if(kind==="internal")db.seed("users/staff",{uid:"staff",companyId:"hub",companyRole:"member",
  accessKind:"internal",memberType:"direct",active:true});
 if(kind==="partner"){
  db.seed("users/staff",{uid:"staff",companyId:"partner",companyRole:"member",
   accessKind:"partner",memberType:"cooperator",active:true});
  db.seed("companies/partner",{hubCompanyId:"hub",companyKind:"partner",active:true});
  db.seed("companies/partner/members/staff",{
   uid:"staff",companyId:"partner",active:true,
   accessKind:"partner",memberType:"cooperator"});
  db.seed("partnerRelations/partner",{
   hubCompanyId:"hub",partnerCompanyId:"partner",
   active:true,countSharingApproved:true});
  db.seed("partnerHistoricalTransfers/staff",{
   uid:"staff",sourceCompanyId:"hub",destinationCompanyId:"partner",
   hubCompanyId:"hub",originalUser:{uid:"staff",companyId:"hub"},
   originalMember:{uid:"staff",companyId:"hub",companyRole:"member"}});
 }
 if(context!==null)db.seed("partnerWorkspaceContexts/staff",{active:context});
 const tokens={auth:0,verified:0};
 const fakeAuth={
  getUser:async uid=>{tokens.auth++;return {uid,disabled:false,emailVerified:true,email:uid+"@example.com"};},
  verifyIdToken:async raw=>{tokens.verified++;if(raw!=="x".repeat(70))throw Error("bad");
   return {uid:"owner",email:"owner@example.com",email_verified:true};}
 };
 const api=makeInternalMemberExit({db,getAuth:()=>fakeAuth,HttpsError,
  FieldValue:{serverTimestamp:()=>({__stamp:true})},enabled:()=>true});
 const req=(data={memberId:"staff",confirmed:true})=>({
  data,auth:{uid:"owner",token:{email_verified:true,email:"owner@example.com"}},
  rawRequest:{headers:{authorization:"Bearer "+"x".repeat(70)}}});
 return {db,api,req,tokens};
}
function snapshot(db){return cp([...db.docs.entries()]);}
test("OFF state never touches credentials or documents",async()=>{
 const x=setup();let called=0;
 const gate=makeInternalMemberExit({db:x.db,getAuth:()=>{called++;throw Error("auth");},
  FieldValue:{serverTimestamp:()=>({})},HttpsError});
 await assert.rejects(gate.remove(x.req()),e=>e.code==="unavailable");
 assert.equal(called,0);assert.equal(x.db.writes.length,0);
});
test("ordinary user removal updates only status in internal user/member; preserves histories",async()=>{
 const x=setup(),old=snapshot(x.db);
 const res=await x.api.remove(x.req());
 assert.equal(res.removed,true);assert.equal(res.mode,"internal");
 assert.equal(res.loginAccountDeleted,false);
 assert.deepEqual(x.db.writes.sort(),["companies/hub/members/staff","users/staff"]);
 assert.deepEqual(x.db.docs.get("companies/hub/members/staff").teamHistory,
  old.find(e=>e[0]==="companies/hub/members/staff")[1].teamHistory);
});
test("secondary active and inactive context: block without touching primary login",async()=>{
 for(const context of [true,false]){
  const x=setup({context}),old=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()),e=>e.code==="failed-precondition");
  assert.deepEqual(snapshot(x.db),old);assert.equal(x.db.writes.length,0);
 }
});
test("fully transferred user retains current partner profile; only former member retired",async()=>{
 const x=setup({kind:"partner"}),old=cp(x.db.docs.get("users/staff"));
 const result=await x.api.remove(x.req());
 assert.equal(result.mode,"already_transferred");
 assert.deepEqual(x.db.writes,["companies/hub/members/staff"]);
 assert.deepEqual(x.db.docs.get("users/staff"),old);
});
test("full transfer is blocked unless archive, destination membership and partner relation are all valid",async()=>{
 const scenarios=[
  x=>x.db.docs.delete("partnerHistoricalTransfers/staff"),
  x=>x.db.docs.get("partnerHistoricalTransfers/staff").sourceCompanyId="foreign",
  x=>x.db.docs.get("partnerHistoricalTransfers/staff").originalUser.companyId="foreign",
  x=>x.db.docs.delete("companies/partner/members/staff"),
  x=>x.db.docs.get("companies/partner/members/staff").active=false,
  x=>x.db.docs.get("companies/partner/members/staff").accessKind="internal",
  x=>x.db.docs.delete("partnerRelations/partner"),
  x=>x.db.docs.get("partnerRelations/partner").countSharingApproved=false,
  x=>x.db.docs.get("companies/partner").active=false
 ];
 for(const change of scenarios){
  const x=setup({kind:"partner"});change(x);const old=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()),e=>e.code==="failed-precondition");
  assert.deepEqual(snapshot(x.db),old);
  assert.equal(x.db.writes.length,0);
 }
});
test("orphaned transfer archive blocks mistaken direct-user removal",async()=>{
 const x=setup();
 x.db.seed("partnerHistoricalTransfers/staff",{
  uid:"staff",sourceCompanyId:"hub",destinationCompanyId:"partner"});
 const old=snapshot(x.db);
 await assert.rejects(x.api.remove(x.req()),e=>e.code==="failed-precondition");
 assert.deepEqual(snapshot(x.db),old);
 assert.equal(x.db.writes.length,0);
});
test("managed account-less member retires without inventing or deleting Auth",async()=>{
 const x=setup({kind:"managed"}),r=await x.api.remove(x.req());
 assert.equal(r.mode,"managed");
 assert.deepEqual(x.db.writes,["companies/hub/members/staff"]);
});
test("owner impersonation, invalid identity and account markers fail before writes",async()=>{
 const mutations=[
  x=>x.db.docs.get("users/owner").companyRole="leader",
  x=>x.db.docs.get("companies/hub").ownerUid="other",
  x=>x.db.docs.get("companies/hub").masterUid="staff",
  x=>x.db.docs.get("companies/hub/members/staff").companyRole="owner",
  x=>x.db.docs.get("users/staff").accessKind="partner",
  x=>x.db.docs.get("users/staff").uid="foreign",
  x=>x.db.docs.get("users/staff").active=false,
  x=>x.db.seed("partnerWorkspaceContexts/owner",{active:false})
 ];
 for(const mutate of mutations){
  const x=setup();mutate(x);const old=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()));
  assert.deepEqual(snapshot(x.db),old);assert.equal(x.db.writes.length,0);
 }
});
test("malicious paths, fake company scope and self-removal all rejected",async()=>{
 const x=setup();
 for(const data of [
  {memberId:"../../records",confirmed:true},
  {memberId:"owner",confirmed:true},
  {memberId:"staff",confirmed:false},
  {memberId:"staff",companyId:"partner",confirmed:true},
  {memberId:"staff",collection:"records",confirmed:true}
 ]){
  await assert.rejects(x.api.remove(x.req(data)),e=>e.code==="invalid-argument");
  assert.equal(x.db.writes.length,0);
 }
});
test("unresolved account or missing membership never becomes a partial write",async()=>{
 for(const change of [
  x=>x.db.docs.delete("companies/hub/members/staff"),
  x=>x.db.docs.delete("users/staff"),
  x=>x.db.docs.get("users/staff").companyId="unknown"
 ]){
  const x=setup();change(x);const old=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()));
  assert.deepEqual(snapshot(x.db),old);
 }
});
test("existing UI calls server only; no unsafe browser batch / Auth delete",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const begin=source.indexOf("async function disableCompanyMember(");
 const finish=source.indexOf("async function changeMemberRole(",begin);
 assert(begin>0&&finish>begin);
 const body=source.slice(begin,finish);
 assert.match(body,/safeRemoveInternalMember\(\{memberId,confirmed:true\}\)/);
 assert.doesNotMatch(body,/\b(?:writeBatch|deleteUser|deleteDoc|setDoc|updateDoc)\s*\(|batch\.update/);
 assert.match(source,/removeInternalCompanyMember/);
 const idx=fs.readFileSync(path.join(__dirname,
  "../functions-partner-workspace/index.js"),"utf8");
 assert.match(idx,/SAFE_INTERNAL_MEMBER_REMOVAL_ENABLED==="enabled"/);
 assert.match(idx,/exports\.removeInternalCompanyMember=onCall/);
});

function selfSetup({mode="internal",context=false,archive=false,authFails=false}={}){
 const base=setup();
 const db=base.db;
 const uid="staff";
 if(mode==="owner")db.docs.get("users/staff").companyRole="owner";
 if(mode==="partner"){
  db.docs.get("users/staff").companyId="partner";
  db.docs.get("users/staff").accessKind="partner";
  db.docs.get("users/staff").memberType="cooperator";
  db.seed("companies/partner",{companyKind:"partner",hubCompanyId:"hub",active:true});
 }
 if(context)db.seed("partnerWorkspaceContexts/staff",{uid,active:context});
 if(archive)db.seed("partnerHistoricalTransfers/staff",{
  uid,sourceCompanyId:"hub",destinationCompanyId:"partner"});
 const authCalls={lookup:0,verify:0,deleted:0};
 const now=1793854800;
 const sdk={
  getUser:async who=>{authCalls.lookup++;return {
   uid:who,disabled:false,emailVerified:true,email:who+"@example.com"};
  },
  verifyIdToken:async jwt=>{authCalls.verify++;
   if(jwt!=="x".repeat(70))throw Error("bad_token");
   return {uid,email:uid+"@example.com",email_verified:true,auth_time:now-60};
  },
  deleteUser:async who=>{authCalls.deleted++;assert.equal(who,uid);
   if(authFails)throw Error("network_ambiguous");
  }
 };
 const api=makeInternalSelfAccountExit({db,getAuth:()=>sdk,
  FieldValue:{serverTimestamp:()=>({__now:true})},
  HttpsError,enabled:()=>true,nowSeconds:()=>now});
 const req=(data={confirmed:true})=>({data,
  auth:{uid,token:{email:uid+"@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+"x".repeat(70)}}});
 return {db,api,req,authCalls,sdk};
}
test("own deletion default OFF does not access Auth, Firestore or delete anything",async()=>{
 const x=selfSetup();
 const gated=makeInternalSelfAccountExit({
  db:x.db,getAuth:()=>{throw Error("unexpectedAuth");},
  FieldValue:{serverTimestamp:()=>({})},HttpsError});
 await assert.rejects(gated.remove(x.req()),e=>e.code==="unavailable");
 assert.deepEqual(x.authCalls,{lookup:0,verify:0,deleted:0});
 assert.equal(x.db.writes.length,0);
});
test("own deletion allows only verified non-owner internal identity and retains financial histories",async()=>{
 const x=selfSetup();
 x.db.seed("records/sale1",{uid:"staff",totalCount:12,totalRevenue:980000});
 x.db.seed("products/p1",{unitPrice:7000});
 x.db.seed("recordCorrections/c1",{ownerUid:"staff",before:{count:10}});
 const before=x.db.docs;
 const orig=["records/sale1","products/p1","recordCorrections/c1"]
  .map(key=>cp(before.get(key)));
 const result=await x.api.remove(x.req());
 assert.deepEqual(result,{deleted:true,uid:"staff",financeAndHistoryPreserved:true});
 assert.equal(x.authCalls.deleted,1);
 assert.deepEqual(x.db.writes.sort(),["companies/hub/members/staff","users/staff"]);
 assert.equal(x.db.docs.get("users/staff").active,false);
 assert.equal(x.db.docs.get("users/staff").accountRemovalStatus,"auth_pending");
 assert.deepEqual(x.db.docs.get("companies/hub/members/staff").teamHistory,[{teamId:"A"}]);
 for(const [i,key] of ["records/sale1","products/p1","recordCorrections/c1"].entries())
  assert.deepEqual(x.db.docs.get(key),orig[i]);
});
test("own deletion blocks secondary partner context active or inactive, transfer archive and partner root",async()=>{
 for(const config of [
  {context:true},{context:"inactive"},{archive:true},{mode:"partner"},{mode:"owner"}
 ]){
  const x=selfSetup(config),before=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()),e=>e.code==="failed-precondition");
  assert.deepEqual(snapshot(x.db),before);
  assert.deepEqual(x.authCalls,{lookup:1,verify:1,deleted:0});
  assert.equal(x.db.writes.length,0);
 }
});
test("legacy owner and master identities are blocked even with missing or stale roles",async()=>{
 for(const patch of [
  x=>x.db.docs.get("companies/hub").ownerUid="staff",
  x=>x.db.docs.get("companies/hub").masterUid="staff",
  x=>x.db.docs.get("users/staff").companyRole="owner",
  x=>{delete x.db.docs.get("users/staff").companyRole;},
  x=>x.db.docs.get("companies/hub/members/staff").companyRole="owner",
  x=>{delete x.db.docs.get("companies/hub/members/staff").companyRole;}
 ]){
  const x=selfSetup();patch(x);const saved=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()),e=>e.code==="failed-precondition");
  assert.deepEqual(snapshot(x.db),saved);
  assert.equal(x.db.writes.length,0);
  assert.equal(x.authCalls.deleted,0);
 }
});
test("own deletion requires recent reauth (auth_time <= 5 min), verified email and exact UID",async()=>{
 for(const change of [
  sdk=>{const original=sdk.verifyIdToken;sdk.verifyIdToken=async arg=>({
   ...await original(arg),auth_time:1793854800-301});},
  sdk=>{const original=sdk.verifyIdToken;sdk.verifyIdToken=async arg=>({
   ...await original(arg),uid:"other"});},
  sdk=>{const original=sdk.getUser;sdk.getUser=async arg=>({
   ...await original(arg),disabled:true});},
  sdk=>{const original=sdk.getUser;sdk.getUser=async arg=>({
   ...await original(arg),emailVerified:false});}
 ]){
  const x=selfSetup();change(x.sdk);const before=snapshot(x.db);
  await assert.rejects(x.api.remove(x.req()),e=>e.code==="unauthenticated");
  assert.deepEqual(snapshot(x.db),before);assert.equal(x.db.writes.length,0);
  assert.equal(x.authCalls.deleted,0);
 }
});
test("self-delete can never pick another uid, target company, or unconfirmed operation",async()=>{
 const x=selfSetup();
 for(const data of [
  {confirmed:false},{confirmed:true,memberId:"owner"},
  {confirmed:true,companyId:"partner"},
  {confirmed:true,collection:"records"},{}
 ]){
  await assert.rejects(x.api.remove(x.req(data)),e=>e.code==="invalid-argument");
 }
 assert.equal(x.authCalls.deleted,0);
 assert.equal(x.db.writes.length,0);
});
test("ambiguous Auth deletion failure is reported as error and identity remains locked, never restored",async()=>{
 const x=selfSetup({authFails:true});
 await assert.rejects(x.api.remove(x.req()),e=>e.code==="internal");
 assert.equal(x.authCalls.deleted,1);
 assert.equal(x.db.docs.get("users/staff").active,false);
 assert.equal(x.db.docs.get("companies/hub/members/staff").active,false);
 assert.equal(x.db.docs.get("users/staff").accountRemovalStatus,"auth_pending");
});
test("self account UI has no client-side Firestore removal or Auth deleteUser",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const start=html.indexOf("deleteOwnAccountButton.onclick =");
 const end=html.indexOf("/* =====================================================\n   ★ リアルタイム監視",start);
 assert(start>0&&end>start);
 const body=html.slice(start,end);
 assert.match(body,/safeDeleteOwnInternalAccount\(\{confirmed:true\}\)/);
 assert.match(body,/reauthenticateWithCredential/);
 assert.doesNotMatch(body,/\b(?:writeBatch|batch\.update|deleteUser|deleteDoc|setDoc|updateDoc)\s*\(/);
 const fn=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/index.js"),"utf8");
 assert.match(fn,/SAFE_INTERNAL_SELF_ACCOUNT_DELETE_ENABLED==="enabled"/);
 assert.match(fn,/exports\.deleteOwnInternalAccountSafely=onCall/);
});
