import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 classifyOwnerRoot,classifyPartnerRelation,auditOwnerWorkspaceReadiness
} from "../tools/production/audit-owner-workspace-live-readonly.mjs";
const uid="owner_1",cid="hub_1",partner="partner_1";
const user={uid,companyId:cid,companyRole:"owner",active:true};
const company={ownerUid:uid,companyKind:"internal",active:true};
const member={uid,companyId:cid,companyRole:"owner",active:true};
const authUser={uid,email:"owner@example.invalid",emailVerified:true,disabled:false};
const relation={partnerCompanyId:partner,hubCompanyId:cid,active:true,countSharingApproved:true};
const partnerCompany={hubCompanyId:cid,companyKind:"partner",name:"協力店 A",active:true};
const team={companyId:partner,active:true,name:"営業班 A"};
const snap=(id,x,exists=true)=>({id,exists,data:()=>x});
const clone=x=>JSON.parse(JSON.stringify(x));
function makeFake({
 u=user,c=company,m=member,auth=authUser,rels=[snap(partner,relation)],
 p=partnerCompany,teams=[snap("t1",team)],ownerRows
}={}){
 const calls=[];
 const users=ownerRows??[snap(uid,u)];
 const db={collection(name){
  assert(["users","companies","partnerRelations"].includes(name),name);
  calls.push("collection:"+name);
  if(name==="users")return {where(field,operator,value){
   assert.deepEqual([field,operator,value],["companyRole","==","owner"]);
   return {limit(n){assert.equal(n,21);return {get:async()=>({docs:users})}}}
  }};
  if(name==="partnerRelations")return {where(field,operator,value){
   assert.deepEqual([field,operator,value],["hubCompanyId","==",cid]);
   return {limit(n){assert.equal(n,101);return {get:async()=>({docs:rels})}}}
  }};
  return {doc(id){
   assert([cid,partner].includes(id),id);
   const x=id===cid?c:p;
   return {
    get:async()=>snap(id,x,x!==null),
    collection(sub){
     assert(["members","partnerWorkTeams"].includes(sub),sub);
     if(sub==="members")return {doc(id2){
      assert.equal(id2,uid);
      return {get:async()=>snap(id2,m,m!==null)}
     }};
     assert.equal(id,partner);
     return {limit(n){assert.equal(n,101);return {get:async()=>({docs:teams})}}};
    }
   };
  }};
 }};
 const identity={getUser:async id=>{assert.equal(id,uid);if(auth===null)throw Error("sensitive error email");
  return auth;}};
 return {db,auth:identity,calls};
}
test("one verified Owner with one approved partner and one team: counts only, no raw identities",async()=>{
 const f=makeFake();
 const r=await auditOwnerWorkspaceReadiness(f);
 assert.equal(r.ownersScanned,1);
 assert.deepEqual(r.ownerStatuses,{ROOT_READY_METADATA_ONLY:1});
 assert.deepEqual(r.partnerStatuses,{PARTNER_READY_METADATA_ONLY:1});
 assert.equal(r.relationsScanned,1);
 assert.equal(r.firestoreWrites,0);assert.equal(r.authChanges,0);
 assert.equal(r.financeOriginalsRead,false);assert.equal(r.countEntryRecordsRead,false);
 const str=JSON.stringify(r);
 for(const secret of [uid,cid,partner,"owner@example.invalid","協力店 A"])
  assert.equal(str.includes(secret),false,secret);
 assert(f.calls.every(p=>!p.includes("records")&&!p.includes("products")));
});
test("no approved partner is a distinct metadata state, not zero reported counts",async()=>{
 const f=makeFake({rels:[]});
 const r=await auditOwnerWorkspaceReadiness(f);
 assert.deepEqual(r.partnerStatuses,{NO_PARTNER_RELATIONS:1});
 assert.equal(r.relationsScanned,0);
});
test("Owner company and membership failures never escalate into relation access",async()=>{
 const cases=[
  {u:{...user,active:false},expected:"USER_MISMATCH_OR_INACTIVE"},
  {c:{...company,ownerUid:"somebody_else"},expected:"COMPANY_OWNER_UID_DIFFERENT"},
  {c:{...company,ownerUid:null},expected:"COMPANY_OWNER_UID_MISSING"},
  {c:{...company,companyKind:"partner-other"},expected:"COMPANY_KIND_MISMATCH"},
  {m:null,expected:"MEMBER_MISSING_OR_INACTIVE"},
  {m:{...member,companyRole:"member"},expected:"MEMBER_OWNER_ROLE_MISMATCH"},
  {auth:{...authUser,emailVerified:false},expected:"AUTH_METADATA_UNVERIFIED"},
  {auth:null,expected:"AUTH_METADATA_UNVERIFIED"},
  {c:null,expected:"COMPANY_MISSING_OR_INACTIVE"}
 ];
 for(const x of cases){
  const f=makeFake(x),r=await auditOwnerWorkspaceReadiness(f);
  assert.deepEqual(r.ownerStatuses,{[x.expected]:1});
  assert.equal(r.relationsScanned,0);
  assert.equal(f.calls.includes("collection:partnerRelations"),false);
 }
});
test("partner approvals require matching keys, names, teams and active state",()=>{
 const ok={hubId:cid,id:partner,relation,company:partnerCompany,companyExists:true,
  teams:[{id:"t1",...team}]};
 assert.equal(classifyPartnerRelation(ok),"PARTNER_READY_METADATA_ONLY");
 assert.equal(classifyPartnerRelation({...ok,id:"other"}),"RELATION_KEY_MISMATCH");
 assert.equal(classifyPartnerRelation({...ok,company:{...partnerCompany,name:"売上 高"}}),
  "PARTNER_COMPANY_MALFORMED");
 assert.equal(classifyPartnerRelation({...ok,company:{...partnerCompany,active:false}}),
  "INACTIVE_PARTNER");
 assert.equal(classifyPartnerRelation({...ok,teams:[{id:"t1",...team,active:0}]}),
  "ACTIVE_TEAM_SCHEMA_MALFORMED");
});
test("owner shared partner-code principals never become hub Owner",()=>{
 assert.equal(classifyOwnerRoot({uid,user:{...user,authKind:"partner_code_shared"},
  company,member,authUser,hasCompany:true,hasMember:true}),"SKIP_PARTNER_OWNER");
});
test("bounded scans stop instead of using unlimited or partial listing",async()=>{
 const manyOwners=Array.from({length:21},(_,i)=>snap("user_"+i,user));
 await assert.rejects(auditOwnerWorkspaceReadiness(makeFake({ownerRows:manyOwners})),
  /STOP_OWNER_WORKSPACE_LIVE_READONLY_OWNER_SCOPE_EXCEEDED/);
 const manyRelations=Array.from({length:61},(_,i)=>
  snap("relation_"+i,{...relation,partnerCompanyId:"relation_"+i}));
 await assert.rejects(auditOwnerWorkspaceReadiness(makeFake({rels:manyRelations})),
  /STOP_OWNER_WORKSPACE_LIVE_READONLY_RELATIONS_SCOPE_EXCEEDED/);
});
test("script is read-only, no impersonation, no financial originals and no identity logging",()=>{
 const source=readFileSync(new URL("../tools/production/audit-owner-workspace-live-readonly.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/(?:\.set|\.update|\.delete|\.create|\.add|runTransaction|signInWith|setCustomUserClaims|verifyIdToken|httpsCallable)\s*\(/);
 assert.doesNotMatch(source,/\.collection\("(?:products|records|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
 assert.match(source,/tokenLoginTested:false/);
 assert.match(source,/maxOwners=20,maxRelations=60/);
});
