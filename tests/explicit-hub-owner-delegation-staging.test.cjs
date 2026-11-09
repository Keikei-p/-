"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {makeExplicitHubOwnerVerifier}=require("../staging/owner-delegation-v1/verified-hub-owner.cjs");
const PRIMARY="primary_1",SECOND="second_2",CID="hub_main";
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code}
}
const principal=uid=>({uid,companyId:CID,active:true,
 companyRole:"owner",accessKind:"internal",memberType:"internal"});
const member=uid=>({...principal(uid)});
const authUser=uid=>({uid,disabled:false,emailVerified:true,
 email:uid+"@example.invalid"});
const snap=data=>({exists:data!==undefined,data:()=>data});
const userPath=u=>"users/"+u;
const companyPath=c=>"companies/"+c;
const memberPath=u=>"companies/"+CID+"/members/"+u;
function fixture({enabled=true,approvals,partner=false,authDisabled,memberRole="owner",
  primaryInactive=false,usingTransaction=false}={}){
 const users=new Map([[userPath(PRIMARY),principal(PRIMARY)],
  [userPath(SECOND),principal(SECOND)]]);
 if(primaryInactive)users.set(userPath(PRIMARY),{...principal(PRIMARY),active:false});
 const company={active:true,ownerUid:PRIMARY,companyKind:partner?"partner":"internal"};
 if(approvals!==undefined)company.approvedHubOwnerUids=approvals;
 const values=new Map();
 // Explicitly copy documents; no test mutates them during verification.
 for(const [k,v] of users)values.set(k,v);
 values.set(companyPath(CID),company);
 values.set(memberPath(PRIMARY),member(PRIMARY));
 values.set(memberPath(SECOND),{...member(SECOND),companyRole:memberRole});
 const reads=[];
 const makeRef=p=>({path:p,get:async()=>{reads.push(p);return snap(values.get(p))}});
 const db={collection:name=>({
  doc:id=>{
   const root=name+"/"+id;
   return {
    ...makeRef(root),
    collection:child=>({doc:uid=>makeRef(root+"/"+child+"/"+uid)})
   };
  }
 })};
 const identity={
  verifyIdToken:async bearer=>{
   if(bearer!=="testing-token-abcdefghijklmnopqrstuvwxyz")throw Error("bad token");
   return {uid:currentUID,email:currentUID+"@example.invalid",email_verified:true};
  },
  getUser:async uid=>{
   const a=authUser(uid);
   if(authDisabled===uid)a.disabled=true;
   return a;
  }
 };
 let currentUID=PRIMARY;
 const verify=makeExplicitHubOwnerVerifier({db,getAuth:()=>identity,HttpsError,enabled:()=>enabled});
 function request(uid=PRIMARY,data={date:"2026-11-09",partnerCompanyId:"partnerA"}){
  currentUID=uid;
  return {
   auth:{uid,token:{email:uid+"@example.invalid",email_verified:true}},
   rawRequest:{headers:{authorization:"Bearer testing-token-abcdefghijklmnopqrstuvwxyz"}},
   data
  };
 }
 const tx=usingTransaction?{get:r=>r.get()}:null;
 return {verify,request,values,company,tx,reads};
}
const rejected=(promise,code="permission-denied")=>
 assert.rejects(promise,e=>e instanceof HttpsError&&e.code===code);
test("existing primary Owner keeps unchanged access with no allowlist field",async()=>{
 const f=fixture();
 const r=await f.verify(f.request(),f.tx);
 assert.deepEqual(r,{kind:"hub",role:"owner",uid:PRIMARY,hubId:CID,ownerGrant:"primary"});
 assert.equal(f.company.ownerUid,PRIMARY);
 assert.equal(f.company.approvedHubOwnerUids,undefined);
});
test("two existing owner roles alone DO NOT authorize delegated Owner",async()=>{
 const f=fixture();
 await rejected(f.verify(f.request(SECOND),f.tx));
 assert.equal(f.company.ownerUid,PRIMARY);
});
test("only a precise explicit grant AND verified current primary allow delegated Owner",async()=>{
 const f=fixture({approvals:[SECOND],usingTransaction:true});
 const r=await f.verify(f.request(SECOND),f.tx);
 assert.deepEqual(r,{kind:"hub",role:"owner",uid:SECOND,hubId:CID,ownerGrant:"explicit-delegate"});
 assert(f.reads.includes(userPath(PRIMARY)));
 assert(f.reads.includes(memberPath(PRIMARY)));
 assert.equal(f.company.ownerUid,PRIMARY);
});
test("wrong primary proof, disabled authentication, revoked membership, partner role all fail",async()=>{
 for(const options of [
  {approvals:[SECOND],primaryInactive:true},
  {approvals:[SECOND],authDisabled:PRIMARY},
  {approvals:[SECOND],memberRole:"member"},
  {approvals:[SECOND],partner:true},
  {approvals:[SECOND,SECOND]},
  {approvals:[SECOND,PRIMARY]},
  {approvals:[]}
 ]){
  const f=fixture(options);
  await rejected(f.verify(f.request(SECOND)));
 }
 const revokedSelf=fixture({approvals:[SECOND],authDisabled:SECOND});
 await rejected(revokedSelf.verify(revokedSelf.request(SECOND)),"unauthenticated");
});
test("feature flag is OFF by default, never publish this candidate automatically",async()=>{
 const f=fixture({enabled:false,approvals:[SECOND]});
 await rejected(f.verify(f.request(SECOND)),"unavailable");
 assert.equal(f.reads.length,0);
});
test("no impersonation or client-supplied Owner/Company identity",async()=>{
 const f=fixture({approvals:[SECOND]});
 await rejected(f.verify(f.request(SECOND,{uid:PRIMARY})),"unauthenticated");
 await rejected(f.verify(f.request(SECOND,{ownerUid:PRIMARY})),"unauthenticated");
 await rejected(f.verify(f.request(SECOND,{workspaceCompanyId:CID})),"unauthenticated");
 await rejected(f.verify(f.request(SECOND,{codeSessionToken:"fake"})),"unauthenticated");
 const req=f.request(SECOND);
 req.rawRequest.headers.authorization="Bearer wrong";
 await rejected(f.verify(req),"unauthenticated");
});
test("no data mutation, finance field, background production deployment or raw UID logging",()=>{
 const src=readFileSync(require.resolve("../staging/owner-delegation-v1/verified-hub-owner.cjs"),"utf8");
 assert.doesNotMatch(src,/\.(?:set|update|delete|create|add|runTransaction)\s*\(/);
 assert.doesNotMatch(src,/\.collection\("(?:products|records|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
 assert.doesNotMatch(src,/console\.log|firebase deploy|setCustomUserClaims|createCustomToken/);
 assert.match(src,/approvedHubOwnerUids/);
 assert.match(src,/NEVER ENABLED BY THIS MODULE/);
});
