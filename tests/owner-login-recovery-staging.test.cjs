"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {makeOwnerLoginRecovery}=require("../staging/owner-login-recovery-v1/service.cjs");
const CID="verified_company",PRIMARY="main_owner",TARGET="disabled_staff",EMAIL="staff@example.invalid";
const REQ={auth:{uid:PRIMARY,token:{email_verified:true}},data:{}};
const REQUEST={...REQ,data:{
 targetUid:TARGET,emailConfirmation:EMAIL,userVersion:11,memberVersion:13,
 reasonCode:"PERSONALLY_VERIFIED_RETURN",
 confirmation:"OWNER_CONFIRMS_PERSON_AND_REASON"
}};
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code}
}
const snap=(value,ms,id)=>({
 id,exists:value!==undefined,updateTime:{toMillis:()=>ms},data:()=>value
});
function fake({
 user,member,authUser,authError=null,actor=null,maxUsers=1,
 missingUser=false,missingMember=false
}={}){
 const dataUser=user??{
  uid:TARGET,companyId:CID,name:"確認済みスタッフ",
  email:EMAIL,active:false,companyRole:"member",
  role:"member",accessKind:"internal",teamId:"team_1",historicalCounts:55
 };
 const dataMember=member??{
  uid:TARGET,companyId:CID,name:"確認済みスタッフ",
  active:false,companyRole:"member",role:"member",teamId:"team_1",
  history:[{date:"2026-10-01",note:"preserve"}]
 };
 const authRecord=authUser??{uid:TARGET,email:EMAIL,emailVerified:true,disabled:false};
 const targetUser=snap(missingUser?undefined:dataUser,11,TARGET);
 const targetMember=snap(missingMember?undefined:dataMember,13,TARGET);
 const refs={user:{key:"users/"+TARGET},member:{key:"companies/"+CID+"/members/"+TARGET}};
 const changes=[],audit=[],lookups=[],authCalls=[];
 const db={
  collection(name){
   if(name==="users")return{
    doc(id){assert.equal(id,TARGET);return refs.user},
    where(field,op,id){
     assert.deepEqual([field,op,id],["companyId","==",CID]);
     return {limit:n=>{assert.equal(n,61);return{get:async()=>({
      docs:maxUsers===1?[targetUser]:
       Array.from({length:maxUsers},(_,i)=>snap(
        {...dataUser,uid:"staff_"+i},11,"staff_"+i))
     })}}};
    }
   };
   if(name==="companies")return {doc:id=>{
    assert.equal(id,CID);return{
     collection:sub=>{
      assert.equal(sub,"members");return {
       doc:uid=>{assert.equal(uid,TARGET);return refs.member}
      };
     }
    };
   }};
   if(name==="loginReactivationAudit")return{
    doc:()=>({key:"loginReactivationAudit/new-entry"})
   };
   throw Error("UNEXPECTED_COLLECTION_"+name);
  },
  async runTransaction(handler){
   const tx={
    get:async ref=>{
     lookups.push(ref.key);
     if(ref===refs.user)return targetUser;
     if(ref===refs.member)return targetMember;
     throw Error("UNEXPECTED_TX_GET");
    },
    update:(ref,value)=>{changes.push({path:ref.key,value})},
    create:(ref,value)=>{audit.push({path:ref.key,value})}
   };
   return handler(tx);
  }
 };
 const auth={getUser:async uid=>{
  authCalls.push(uid);assert.equal(uid,TARGET);
  if(authError)throw Object.assign(Error("redacted"),{code:authError});
  return authRecord;
 }};
 const trusted=actor??{kind:"hub",role:"owner",ownerGrant:"primary",uid:PRIMARY,hubId:CID};
 const verifier=async(request,tx)=>{
  assert.equal(request.auth.uid,PRIMARY);
  return trusted;
 };
 const service=flags=>makeOwnerLoginRecovery({
  db,getAuth:()=>auth,HttpsError,
  FieldValue:{serverTimestamp:()=>({type:"serverTimestamp"})},
  verifyHubOwner:verifier,
  enabledRead:()=>flags?.read===true,
  enabledWrite:()=>flags?.write===true
 });
 return {db,service,changes,audit,lookups,authCalls};
}
test("feature defaults OFF and failed requests cannot write",async()=>{
 const f=fake(),closed=f.service();
 await assert.rejects(closed.list(REQ),{code:"unavailable"});
 await assert.rejects(closed.reactivate(REQUEST),{code:"unavailable"});
 assert.equal(f.changes.length,0);assert.equal(f.audit.length,0);
});
test("primary Owner may list only verified already-disabled internal staff; no writes",async()=>{
 const f=fake(),s=f.service({read:true,write:false});
 const x=await s.list(REQ);
 assert.equal(x.kind,"owner-reviewed-internal-login-recovery");
 assert.equal(x.candidates.length,1);
 assert.equal(x.candidates[0].uid,TARGET);
 assert.equal(x.candidates[0].maskedEmail,"s***@example.invalid");
 assert.equal(x.candidates[0].userVersion,11);
 assert.equal(x.candidates[0].memberVersion,13);
 assert.equal(x.writeEnabled,false);
 assert.equal(x.financeRead,false);
 assert.equal(f.changes.length,0);
 assert.equal(f.audit.length,0);
 await assert.rejects(s.reactivate(REQUEST),{code:"unavailable"});
 assert.equal(f.changes.length,0);
});
test("explicit primary Owner acknowledgment updates only active flags and appends an audit",async()=>{
 const f=fake(),s=f.service({read:true,write:true});
 const result=await s.reactivate(REQUEST);
 assert.deepEqual(result,{
  restored:true,uid:TARGET,userActive:true,memberActive:true,
  authAccountUnchanged:true,financialOriginalsUnchanged:true,historyRetained:true
 });
 assert.deepEqual(f.changes.map(x=>x.path),[
  "users/"+TARGET,"companies/"+CID+"/members/"+TARGET
 ]);
 for(const change of f.changes){
  assert.deepEqual(Object.keys(change.value).sort(),["active","updatedAt"]);
  assert.equal(change.value.active,true);
 }
 assert.equal(f.audit.length,1);
 assert.equal(f.audit[0].path,"loginReactivationAudit/new-entry");
 assert.equal(f.audit[0].value.targetUid,TARGET);
 assert.equal(f.audit[0].value.ownerUid,PRIMARY);
 assert.equal(f.audit[0].value.authAccountUnchanged,true);
 assert(!Object.hasOwn(f.audit[0].value,"email"));
 assert(!Object.hasOwn(f.audit[0].value,"financialRecord"));
 assert.equal(f.authCalls.length,2);
});
test("disabled Auth account, missing target and partner/cooperator cannot recover",async()=>{
 const situations=[
  {authUser:{uid:TARGET,email:EMAIL,emailVerified:true,disabled:true}},
  {missingUser:true},{missingMember:true},
  {user:{uid:TARGET,companyId:CID,email:EMAIL,active:false,
   accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false}},
  {user:{uid:TARGET,companyId:CID,email:EMAIL,active:false,companyRole:"owner"}},
  {member:{uid:TARGET,companyId:CID,active:false,companyRole:"owner"}},
  {user:{uid:TARGET,companyId:"wrong_company",email:EMAIL,active:false}},
  {member:{uid:TARGET,companyId:"wrong_company",active:false}},
  {user:{uid:TARGET,companyId:CID,email:EMAIL,active:true}},
  {member:{uid:TARGET,companyId:CID,active:true}},
  {user:{uid:TARGET,companyId:CID,email:"different@example.invalid",active:false}},
  {authUser:{uid:TARGET,email:"changed@example.invalid",emailVerified:true,disabled:false}}
 ];
 for(const opts of situations){
  const f=fake(opts),s=f.service({read:true,write:true});
  await assert.rejects(s.reactivate(REQUEST));
  assert.equal(f.changes.length,0,JSON.stringify(opts));
  assert.equal(f.audit.length,0,JSON.stringify(opts));
 }
});
test("explicit primary Owner only, never secondary or role-asserted client",async()=>{
 for(const actor of [
  {kind:"hub",role:"owner",ownerGrant:"explicit-delegate",uid:PRIMARY,hubId:CID},
  {kind:"partner",role:"owner",ownerGrant:"primary",uid:PRIMARY,hubId:CID},
  {kind:"hub",role:"member",ownerGrant:"primary",uid:PRIMARY,hubId:CID}
 ]){
  const f=fake({actor}),s=f.service({read:true,write:true});
  await assert.rejects(s.list(REQ),{code:"permission-denied"});
  await assert.rejects(s.reactivate(REQUEST),{code:"permission-denied"});
  assert.equal(f.changes.length,0);
 }
});
test("must reject stale document versions and wrong e-mail confirmation",async()=>{
 const variants=[
  {userVersion:10},{memberVersion:99},
  {emailConfirmation:"other@example.invalid"},
  {emailConfirmation:"Staff@example.invalid"},
  {confirmation:"YES"},
  {reasonCode:"OTHER_REASON"},
  {targetUid:"wrong-user"},{additionalRole:"owner"}
 ];
 for(const change of variants){
  const f=fake(),s=f.service({read:true,write:true});
  await assert.rejects(s.reactivate({...REQUEST,data:{...REQUEST.data,...change}}));
  assert.equal(f.changes.length,0);
 }
});
test("LIST only allows empty object; cannot return more than a bounded user population",async()=>{
 const f=fake(),s=f.service({read:true,write:false});
 for(const data of [undefined,{uid:TARGET},{workspaceCompanyId:CID},{codeSessionToken:"token"}]){
  if(data===undefined)continue;
  await assert.rejects(s.list({...REQ,data}),{code:"invalid-argument"});
 }
 const many=fake({maxUsers:61}),limited=many.service({read:true});
 await assert.rejects(limited.list(REQ),{code:"resource-exhausted"});
});
test("source cannot delete, create account, alter Owner or any financial originals",()=>{
 const s=fs.readFileSync(path.join(__dirname,"../staging/owner-login-recovery-v1/service.cjs"),"utf8");
 assert.match(s,/STAGING ONLY \/ DEFAULT OFF/);
 assert.match(s,/ownerGrant!=="primary"/);
 assert.match(s,/memberVersion/);
 assert.match(s,/OWNER_CONFIRMS_PERSON_AND_REASON/);
 assert.match(s,/loginReactivationAudit/);
 assert.doesNotMatch(s,/\b(?:deleteUser|updateUser|createUser|createCustomToken|setCustomUserClaims|deleteDoc|setDoc|firebase deploy)\s*\(/);
 assert.doesNotMatch(s,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries|partnerWorkCountDays)"\)/);
});
