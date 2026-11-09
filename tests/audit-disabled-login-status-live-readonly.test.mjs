import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 classifyDisabledAccount,auditDisabledLoginStatus
} from "../tools/production/audit-disabled-login-status-live-readonly.mjs";
const uid="staff_disabled",cid="hub_internal";
const user=()=>({uid,companyId:cid,active:false,accessKind:"internal"});
const member=()=>({uid,companyId:cid,active:false});
const auth=()=>({uid,emailVerified:true,disabled:false,email:uid+"@example.invalid"});
const company=()=>({active:true,companyKind:"internal",ownerUid:"primary"});
const check=x=>classifyDisabledAccount({
 uid,user:user(),auth:auth(),companyExists:true,
 company:company(),memberExists:true,member:member(),...x
});
const snap=(id,val)=>({id,exists:val!==undefined,data:()=>val});
function mock({users,members,companies,authUsers,authError}={}){
 const us=users??new Map([[uid,user()]]);
 const ms=members??new Map([[cid+"|"+uid,member()]]);
 const cs=companies??new Map([[cid,company()]]);
 const au=authUsers??new Map([[uid,auth()]]);
 const reads=[];
 const db={collection:name=>{
  if(name==="users")return {
   where:(k,op,v)=>{assert.deepEqual([k,op,v],["active","==",false]);return {
    limit:n=>{assert.equal(n,11);return {get:async()=>({
     docs:[...us].map(([id,x])=>snap(id,x))
    })}}
   }}
  };
  if(name!=="companies")throw Error("UNEXPECTED_COLLECTION");
  return {doc:id=>{
   reads.push("company");
   return {get:async()=>snap(id,cs.get(id)),
    collection:child=>{assert.equal(child,"members");return {
     doc:memberUid=>{reads.push("member");return {
      get:async()=>snap(memberUid,ms.get(id+"|"+memberUid))
     }}
    }}
   };
  }};
 }};
 const identity={getUser:async id=>{
  reads.push("auth");
  if(au.has(id))return au.get(id);
  throw Object.assign(Error("redacted"),{code:authError??"auth/user-not-found"});
 }};
 return {db,auth:identity,reads};
}
test("disabled account with disabled member remains disabled and must never auto-recover",()=>{
 assert.equal(check({}),"DISABLED_USER_AND_MEMBER_BOTH_INACTIVE");
 assert.equal(check({member:{...member(),active:true}}),
  "DISABLED_USER_WITH_ACTIVE_MEMBER");
 assert.equal(check({memberExists:false}),"DISABLED_INTERNAL_MEMBER_MISSING");
 assert.equal(check({companyExists:false}),"DISABLED_COMPANY_NOT_FOUND");
 assert.equal(check({company:{...company(),active:false}}),"DISABLED_COMPANY_NOT_ACTIVE");
});
test("inconsistent roles, disabled Auth, missing company references are separated",()=>{
 assert.equal(check({auth:{...auth(),disabled:true}}),
  "FIREBASE_AUTH_DISABLED_OR_MISMATCHED");
 assert.equal(check({auth:{...auth(),emailVerified:false}}),
  "FIREBASE_EMAIL_NOT_VERIFIED");
 assert.equal(check({user:{...user(),companyId:null}}),
  "DISABLED_NO_VALID_COMPANY_REFERENCE");
 assert.equal(check({member:{...member(),uid:"other"}}),
  "DISABLED_INTERNAL_MEMBER_ID_MISMATCH");
});
test("partner email profile cannot accidentally gain finance access during diagnosis",()=>{
 const partner={...user(),accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false};
 assert.equal(check({user:partner,memberExists:false}),
  "DISABLED_PARTNER_COUNT_ONLY_PROFILE");
 assert.equal(check({user:{...partner,canViewRevenue:true},memberExists:false}),
  "DISABLED_PARTNER_FLAG_CONFLICT");
});
test("live adapter reads only auth, company and member; returns anonymous aggregate counts",async()=>{
 const f=mock();
 const r=await auditDisabledLoginStatus(f);
 assert.equal(r.disabledProfilesFound,1);
 assert.equal(r.categoryCounts.DISABLED_USER_AND_MEMBER_BOTH_INACTIVE,1);
 assert.equal(r.firestoreWrites,0);
 assert.equal(r.accountsReactivated,0);
 assert.equal(r.intentionalDisablementReasonKnown,false);
 assert.equal(r.recordsOrFinancialOriginalsRead,false);
 assert.deepEqual(f.reads,["auth","company","company","member"]);
 const json=JSON.stringify(r);
 for(const secret of [uid,cid,"@example.invalid"])assert(!json.includes(secret));
});
test("Firebase provider error must fail, never classify unknown status as safe",async()=>{
 const f=mock({authUsers:new Map(),authError:"auth/insufficient-permission"});
 await assert.rejects(auditDisabledLoginStatus(f),
  /STOP_DISABLED_LOGIN_AUDIT_AUTH_METADATA_UNAVAILABLE/);
});
test("more than ten disabled rows fails rather than hiding an incomplete report",async()=>{
 const users=new Map(Array.from({length:11},(_,i)=>[
  "disabled_"+i,{...user(),uid:"disabled_"+i}
 ]));
 await assert.rejects(auditDisabledLoginStatus(mock({users})),
  /STOP_DISABLED_LOGIN_AUDIT_SCOPE_EXCEEDED/);
});
test("code is GET-only, does not retrieve originals, re-enable user or write a role",()=>{
 const s=readFileSync(new URL("../tools/production/audit-disabled-login-status-live-readonly.mjs",import.meta.url),"utf8");
 assert.match(s,/--read-only/);
 assert.match(s,/DISABLED_LOGIN_LIVE_READONLY/);
 assert.doesNotMatch(s,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
 assert.doesNotMatch(s,/\b(?:updateUser|deleteUser|createUser|setCustomUserClaims|createCustomToken|signInWithEmailAndPassword|firebase deploy)\s*\(/);
 assert.doesNotMatch(s,/\b(?:tx|ref|document|batch)\.(?:set|update|delete|create|add)\s*\(/);
});
