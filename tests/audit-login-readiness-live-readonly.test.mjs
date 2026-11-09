import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditLoginReadiness,classifyLoginReadiness}
 from "../tools/production/audit-login-readiness-live-readonly.mjs";
const cid="company_local",uid="staff_1";
const basicUser=()=>({uid,companyId:cid,active:true,companyRole:"member",accessKind:"internal"});
const basicMember=()=>({uid,companyId:cid,active:true,companyRole:"member",accessKind:"internal"});
const basicCompany=()=>({active:true,companyKind:"internal",ownerUid:"primary"});
const basicAuth=()=>({uid,emailVerified:true,disabled:false,email:uid+"@example.invalid"});
const classify=overrides=>classifyLoginReadiness({
 uid,user:basicUser(),member:basicMember(),company:basicCompany(),
 auth:basicAuth(),companyExists:true,memberExists:true,...overrides
});
const snap=(id,value)=>({id,exists:value!==undefined,data:()=>value});
function mock({users,companies,members,auth,authFailCode}={}){
 const us=users??new Map([[uid,basicUser()]]);
 const cs=companies??new Map([[cid,basicCompany()]]);
 const ms=members??new Map([[cid+"|"+uid,basicMember()]]);
 const a=auth??new Map([[uid,basicAuth()]]);
 const paths=[];
 const db={collection:name=>{
  if(name==="users")return {limit:n=>{assert.equal(n,201);return {
   get:async()=>({docs:[...us].map(([id,val])=>snap(id,val))})
  }}};
  if(name==="companies")return {
   doc:id=>{
    paths.push("companies");
    return {
     get:async()=>snap(id,cs.get(id)),
     collection:sub=>{assert.equal(sub,"members");return {
      doc:memberUid=>{paths.push("members");return {
       get:async()=>snap(memberUid,ms.get(id+"|"+memberUid))
      }}
     }}
    }
   }
  };
  throw Error("UNEXPECTED_COLLECTION_"+name);
 }};
 const authProvider={getUser:async id=>{
  paths.push("auth");
  if(a.has(id))return a.get(id);
  throw Object.assign(Error("redacted"),{code:authFailCode??"auth/user-not-found"});
 }};
 return {db,auth:authProvider,paths};
}
test("verified internal metadata accepts optional legacy member companyId",()=>{
 assert.equal(classify({}),"INTERNAL_ROUTE_METADATA_READY");
 const m=basicMember();delete m.companyId;
 assert.equal(classify({member:m}),"INTERNAL_ROUTE_METADATA_READY");
});
test("Firebase disabled/unverified and user disabled are separately categorized",()=>{
 assert.equal(classify({auth:{...basicAuth(),disabled:true}}),"AUTH_DISABLED");
 assert.equal(classify({auth:{...basicAuth(),emailVerified:false}}),"AUTH_EMAIL_UNVERIFIED");
 assert.equal(classify({user:{...basicUser(),active:false}}),"USER_DISABLED");
 assert.equal(classify({auth:null}),"AUTH_USER_NOT_FOUND");
});
test("legacy membership missing, role mismatch and team mismatch are not mistaken for password failure",()=>{
 assert.equal(classify({companyExists:false}),"COMPANY_DOCUMENT_MISSING");
 assert.equal(classify({memberExists:false}),"INTERNAL_MEMBER_DOCUMENT_MISSING");
 assert.equal(classify({user:{...basicUser(),companyId:null}}),"COMPANY_SETUP_OR_INVITE_REQUIRED");
 assert.equal(classify({member:{...basicMember(),companyRole:"leader"}}),
  "INTERNAL_ROUTE_BLOCKED_ROLE_MISMATCH");
 assert.equal(classify({user:{...basicUser(),teamId:"A"},member:{...basicMember(),teamId:"B"}}),
  "INTERNAL_ROUTE_BLOCKED_TEAM_MISMATCH");
});
test("partner email profiles require all original finance-denial markers",()=>{
 const pu={...basicUser(),accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false};
 assert.equal(classify({user:pu,memberExists:false}),
  "PARTNER_EMAIL_COUNT_ONLY_ROUTE_CANDIDATE");
 assert.equal(classify({user:{...pu,canViewRevenue:true}}),
  "PARTNER_PROFILE_FLAGS_INCONSISTENT");
 assert.equal(classify({user:{...pu,memberType:"member"}}),
  "PARTNER_PROFILE_FLAGS_INCONSISTENT");
});
test("bounded live adapter never reads financial collections and does not output UID or emails",async()=>{
 const f=mock();
 const r=await auditLoginReadiness(f);
 assert.equal(r.userDocumentsScanned,1);
 assert.equal(r.categoryCounts.INTERNAL_ROUTE_METADATA_READY,1);
 assert.equal(r.productionWrites,0);
 assert.equal(r.authChanges,0);
 assert.equal(r.financialOriginalsRead,false);
 assert.equal(r.actualPasswordSignInNotTested,true);
 assert.deepEqual(f.paths,["auth","companies","members"]);
 const out=JSON.stringify(r);
 for(const v of [uid,cid,"@example.invalid"])assert(!out.includes(v),v);
});
test("missing Firebase account is reported but does not create or reset any credentials",async()=>{
 const f=mock({auth:new Map()});
 const r=await auditLoginReadiness(f);
 assert.equal(r.categoryCounts.AUTH_USER_NOT_FOUND,1);
 assert.equal(r.loginSessionsCreated,0);
});
test("Auth permission or API failure cannot be mislabeled as a deleted user",async()=>{
 const f=mock({auth:new Map(),authFailCode:"auth/insufficient-permission"});
 await assert.rejects(auditLoginReadiness(f),
  /STOP_LOGIN_READINESS_READONLY_FIREBASE_AUTH_METADATA_UNAVAILABLE/);
});
test("over 200 profiles stops rather than reporting incomplete population as fully checked",async()=>{
 const map=new Map(Array.from({length:201},(_,i)=>[
  "user_"+i,{...basicUser(),uid:"user_"+i}
 ]));
 await assert.rejects(auditLoginReadiness(mock({users:map})),
  /STOP_LOGIN_READINESS_READONLY_USER_POPULATION_OVER_LIMIT/);
});
test("source cannot sign into, create, delete, alter, or impersonate real accounts",()=>{
 const s=readFileSync(new URL("../tools/production/audit-login-readiness-live-readonly.mjs",import.meta.url),"utf8");
 assert.match(s,/--read-only/);
 assert.match(s,/LOGIN_READINESS_LIVE_READONLY/);
 assert.doesNotMatch(s,/\b(?:signInWith|createUser|updateUser|deleteUser|setCustomUserClaims|createCustomToken|firebase deploy)\s*\(/);
 assert.doesNotMatch(s,/\b(?:tx|ref|document|batch)\.(?:set|update|delete|create|add)\s*\(/);
 assert.doesNotMatch(s,/\.collection\("(?:records|products|recordCorrections|revenueGoals)"\)/);
});
