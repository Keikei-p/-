"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {makeOwnerDelegateApproval}=require("../staging/owner-delegation-v1/owner-approval-service.cjs");
const {makeExplicitHubOwnerVerifier}=require("../staging/owner-delegation-v1/verified-hub-owner.cjs");
const CID="company_INTERNAL",PRIMARY="primary_123",ONE="coowner_1",TWO="coowner_2";
const deep=v=>JSON.parse(JSON.stringify(v));
const PATHS={
 company:"companies/"+CID,
 user:id=>"users/"+id,
 member:id=>"companies/"+CID+"/members/"+id
};
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code}
}
const user=id=>({uid:id,companyId:CID,active:true,companyRole:"owner",accessKind:"internal"});
const member=id=>({uid:id,companyId:CID,active:true,companyRole:"owner",accessKind:"internal"});
const authUser=id=>({uid:id,disabled:false,emailVerified:true,email:id+"@example.invalid",displayName:id});
function fixture({
 ownerUid=PRIMARY,disabledAuth=[],invalidMember=[],
 startDelegates=[],startVersion=0,enabled=true
}={}){
 const state=new Map([
  [PATHS.company,{active:true,ownerUid,companyKind:"internal",
   approvedHubOwnerUids:startDelegates,ownerGrantVersion:startVersion}],
  ...[PRIMARY,ONE,TWO].map(id=>[PATHS.user(id),user(id)]),
  ...[PRIMARY,ONE,TWO].map(id=>[PATHS.member(id),
   {...member(id),...(invalidMember.includes(id)?{companyRole:"member"}:{})}])
 ]);
 const audit=[];let uidOfRequest=PRIMARY,n=0,transactionWrites=0;
 const snap=path=>({exists:state.has(path),data:()=>deep(state.get(path))});
 const makeRef=path=>({
  path,get:async()=>snap(path),
  collection:child=>({doc:id=>makeRef(path+"/"+child+"/"+id)})
 });
 const db={
  collection:name=>({
   doc:id=>makeRef(name+"/"+(id??"audit_"+(++n))),
   where:(key,operator,cid)=>{
    assert.equal(name,"users");
    assert.deepEqual([key,operator,cid],["companyId","==",CID]);
    return {limit:x=>{assert.equal(x,31);return {get:async()=>({
     docs:[...state].filter(([k,v])=>k.startsWith("users/")&&v.companyId===cid)
      .map(([k,v])=>({id:k.split("/").at(-1),data:()=>deep(v)}))
    })}}};
   }
  }),
  runTransaction:async callback=>{
   const operations=[];
   const tx={
    get:ref=>ref.get(),
    update:(ref,fields)=>operations.push({op:"update",path:ref.path,fields:deep(fields)}),
    create:(ref,fields)=>operations.push({op:"create",path:ref.path,fields:deep(fields)})
   };
   const result=await callback(tx);
   for(const operation of operations){
    if(operation.op==="update"){
     assert.equal(operation.path,PATHS.company);
     assert.deepEqual(Object.keys(operation.fields).sort(),
      ["approvedHubOwnerUids","ownerGrantVersion"]);
     state.set(operation.path,{...state.get(operation.path),...operation.fields});
    }else{
     assert(operation.path.startsWith("ownerDelegateAudit/"));
     assert(!state.has(operation.path));
     state.set(operation.path,operation.fields);audit.push(operation.fields);
    }
   }
   transactionWrites+=operations.length;
   return result;
  }
 };
 const auth={
  verifyIdToken:async bearer=>{
   if(bearer!=="testing-token-abcdefghijklmnopqrstuvwxyz")throw Error("invalid bearer");
   return {uid:uidOfRequest,email:uidOfRequest+"@example.invalid",email_verified:true};
  },
  getUser:async uid=>{
   const result=authUser(uid);
   if(disabledAuth.includes(uid))result.disabled=true;
   return result;
  }
 };
 const getAuth=()=>auth;
 const verifyHubOwner=makeExplicitHubOwnerVerifier({
  db,getAuth,HttpsError,enabled:()=>enabled
 });
 const service=makeOwnerDelegateApproval({
  db,getAuth,FieldValue:{serverTimestamp:()=>({__stamp:"NOW"})},
  HttpsError,verifyHubOwner,enabled:()=>enabled
 });
 const request=(uid=PRIMARY,data={})=>{
  uidOfRequest=uid;
  return {auth:{uid,token:{email:uid+"@example.invalid",email_verified:true}},
   rawRequest:{headers:{authorization:"Bearer testing-token-abcdefghijklmnopqrstuvwxyz"}},data};
 };
 return {service,request,state,audit,get transactionWrites(){return transactionWrites}};
}
const denied=(promise,code="permission-denied")=>
 assert.rejects(promise,e=>e instanceof HttpsError&&e.code===code);
test("primary Owner may list existing eligible co-owners, but grants are not automatic",async()=>{
 const f=fixture();
 const result=await f.service.list(f.request(PRIMARY,{}));
 assert.equal(result.scope,"explicit-additional-hub-owners");
 assert.equal(result.role,"primary-owner");
 assert.equal(result.ownerGrantVersion,0);
 assert.equal(result.financeIncluded,false);
 assert.equal(result.candidates.length,2);
 assert(result.candidates.every(x=>x.approved===false));
 assert.equal(f.transactionWrites,0);
 assert.equal(f.audit.length,0);
});
test("primary Owner approves ONE existing verified co-owner in single atomic transaction with audit",async()=>{
 const f=fixture();
 const r=await f.service.change(f.request(PRIMARY,{
  approved:true,expectedVersion:0,targetUid:ONE
 }));
 assert.deepEqual(r,{updated:true,ownerGrantVersion:1,delegatedOwnerUid:ONE,approved:true});
 const company=f.state.get(PATHS.company);
 assert.equal(company.ownerUid,PRIMARY);
 assert.deepEqual(company.approvedHubOwnerUids,[ONE]);
 assert.equal(company.ownerGrantVersion,1);
 assert.equal(f.transactionWrites,2);
 assert.equal(f.audit.length,1);
 assert.equal(f.audit[0].action,"approve");
 assert.equal(f.audit[0].primaryOwnerUid,PRIMARY);
 assert.equal(f.audit[0].delegatedOwnerUid,ONE);
 const second=await f.service.list(f.request(PRIMARY,{}));
 assert.equal(second.candidates.find(x=>x.uid===ONE).approved,true);
 assert.equal(second.candidates.find(x=>x.uid===TWO).approved,false);
});
test("approval revoke is audited, never deletes user, member, original Owner or older audit",async()=>{
 const f=fixture({startDelegates:[ONE],startVersion:1});
 const oldKeys=[...f.state.keys()].sort();
 const result=await f.service.change(f.request(PRIMARY,{
  approved:false,expectedVersion:1,targetUid:ONE
 }));
 assert.equal(result.approved,false);
 assert.deepEqual(f.state.get(PATHS.company).approvedHubOwnerUids,[]);
 assert.equal(f.state.get(PATHS.company).ownerUid,PRIMARY);
 assert.equal(f.audit[0].action,"revoke");
 for(const key of oldKeys)assert(f.state.has(key));
});
test("second co-owner and forged UID cannot grant itself access or revoke others",async()=>{
 const f=fixture({startDelegates:[ONE]});
 await denied(f.service.change(f.request(ONE,{
  approved:true,expectedVersion:0,targetUid:TWO
 })));
 await denied(f.service.change(f.request(ONE,{
  approved:false,expectedVersion:0,targetUid:ONE
 })));
 assert.equal(f.transactionWrites,0);
});
test("revoked target identity, bad membership, primary mismatch, stale version and no-ops fail closed",async()=>{
 for(const options of [
  {disabledAuth:[ONE]},
  {invalidMember:[ONE]},
  {ownerUid:"another_primary"}
 ]){
  const f=fixture(options);
  await denied(f.service.change(f.request(PRIMARY,{
   approved:true,expectedVersion:0,targetUid:ONE
  })));
  assert.equal(f.transactionWrites,0);
 }
 const stale=fixture({startVersion:2});
 await denied(stale.service.change(stale.request(PRIMARY,{
  approved:true,expectedVersion:1,targetUid:ONE
 })),"aborted");
 const noOp=fixture({startDelegates:[ONE]});
 await denied(noOp.service.change(noOp.request(PRIMARY,{
  approved:true,expectedVersion:0,targetUid:ONE
 })),"already-exists");
 const self=fixture();
 await denied(self.service.change(self.request(PRIMARY,{
  approved:true,expectedVersion:0,targetUid:PRIMARY
 })));
});
test("default OFF blocks every change before beginning transaction",async()=>{
 const f=fixture({enabled:false});
 await denied(f.service.change(f.request(PRIMARY,{
  approved:true,expectedVersion:0,targetUid:ONE
 })),"unavailable");
 assert.equal(f.transactionWrites,0);
});
test("only exact validated three request keys accepted",async()=>{
 const f=fixture();
 for(const args of [
  {approved:true,expectedVersion:0,targetUid:ONE,companyId:CID},
  {approved:true,expectedVersion:0,targetUid:ONE,uid:PRIMARY},
  {approved:"true",expectedVersion:0,targetUid:ONE},
  {approved:true,expectedVersion:-1,targetUid:ONE}
 ])await denied(f.service.change(f.request(PRIMARY,args)),"invalid-argument");
 assert.equal(f.transactionWrites,0);
});
test("staged service uses one transaction and append audit; never updates financial or identity documents",()=>{
 const src=readFileSync(require.resolve("../staging/owner-delegation-v1/owner-approval-service.cjs"),"utf8");
 assert.match(src,/runTransaction\(async tx=>/);
 assert.match(src,/tx\.update\(ref/);
 assert.match(src,/tx\.create\(auditRef/);
 assert.doesNotMatch(src,/\b(?:tx|ref|db)\.delete\s*\(|firebase deploy|setCustomUserClaims|createUser\(/);
 assert.doesNotMatch(src,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
});
