import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditOwnerTopology} from "../tools/production/audit-owner-topology-live-readonly.mjs";

const HUB="company_MAIN",PRIMARY="owner_primary",OTHER1="owner_second",OTHER2="owner_third";
const entry=(uid,hub=HUB)=>({uid,companyId:hub,companyRole:"owner",
 active:true,accessKind:"internal"});
const member=(uid,hub=HUB)=>({...entry(uid,hub)});
const authRecord=uid=>({uid,email:uid+"@example.invalid",emailVerified:true,disabled:false});
const snapshot=(id,object)=>({id,exists:object!=null,data:()=>object});
function fixture({users,companies,members,auth,ownerRowCount}={}){
 const userMap=users??new Map([
  [PRIMARY,entry(PRIMARY)],[OTHER1,entry(OTHER1)],[OTHER2,entry(OTHER2)]
 ]);
 const companiesMap=companies??new Map([[HUB,{ownerUid:PRIMARY,companyKind:"internal",active:true}]]);
 const memberMap=members??new Map([...userMap].map(([uid,u])=>[u.companyId+"|"+uid,member(uid,u.companyId)]));
 const authMap=auth??new Map([...userMap.keys()].map(uid=>[uid,authRecord(uid)]));
 const reads=[];
 const db={collection(name){
  assert(["users","companies"].includes(name),name);
  reads.push("collection:"+name);
  if(name==="users")return {
   where(k,op,v){
    assert.deepEqual([k,op,v],["companyRole","==","owner"]);
    return {limit(n){assert.equal(n,21);return {get:async()=>({
     docs:ownerRowCount?Array.from({length:ownerRowCount},(_,i)=>snapshot("extra_"+i,entry("extra_"+i))):
      [...userMap].filter(([id,u])=>u.companyRole==="owner").map(([id,u])=>snapshot(id,u))
    })}}};
   },
   doc(uid){reads.push("users.doc");return {get:async()=>snapshot(uid,userMap.get(uid))}}
  };
  return {doc(cid){
   reads.push("company.doc");
   return {
    get:async()=>snapshot(cid,companiesMap.get(cid)),
    collection(sub){assert.equal(sub,"members");return {doc(uid){
     reads.push("company.members.doc");
     return {get:async()=>snapshot(uid,memberMap.get(cid+"|"+uid))}
    }}}
   };
  }};
 }};
 const identity={getUser:async uid=>{
  reads.push("auth.getUser");
  if(!authMap.has(uid))throw Error("provider secret error");
  return authMap.get(uid);
 }};
 return {db,auth:identity,reads};
}
test("root Owner is verified; two valid secondary owner-role users share same primary company",async()=>{
 const f=fixture();
 const r=await auditOwnerTopology(f);
 assert.equal(r.ownersScanned,3);
 assert.equal(r.ownerStatusCounts.ROOT_READY_METADATA_ONLY,1);
 assert.equal(r.ownerStatusCounts.COMPANY_OWNER_UID_DIFFERENT,2);
 assert.equal(r.ownerStatusCounts.DIFFERENT_UID_SECONDARY_FULLY_VALID,2);
 assert.equal(r.ownerStatusCounts.DIFFERENT_UID_POINTS_TO_VALID_PRIMARY,2);
 assert.equal(r.mismatchCompanyGroupCounts.SAME_COMPANY_HAS_VERIFIED_OWNER,1);
 assert.equal(r.mismatchCompanyGroupCounts.MULTIPLE_MISMATCHES_SAME_COMPANY,1);
 assert.equal(r.mismatchCompanyGroupCounts.MULTIPLE_OWNER_ROLE_USERS_SAME_COMPANY,1);
 assert.equal(r.authImpersonation,false);
 assert.equal(r.firestoreWrites,0);
 assert.equal(r.roleUpdates,0);
 assert.equal(r.countsRead,false);
 assert.equal(r.financeOriginalsRead,false);
 assert.equal(r.realUserBrowserLoginTested,false);
 const serialized=JSON.stringify(r);
 for(const secret of [PRIMARY,OTHER1,OTHER2,HUB,"@example.invalid"])
  assert(!serialized.includes(secret),secret);
 assert(f.reads.every(s=>!s.includes("records")&&!s.includes("products")));
});
test("missing or invalid primary Owner blocks automatic entitlement change",async()=>{
 const base=fixture(),badAuth=new Map([[OTHER1,authRecord(OTHER1)],[OTHER2,authRecord(OTHER2)]]);
 const f=fixture({auth:badAuth});
 const r=await auditOwnerTopology(f);
 assert.equal(r.ownerStatusCounts.DIFFERENT_UID_PRIMARY_NOT_VERIFIED,2);
 assert.equal(r.suggestedAutomaticRoleChange,false);
 const badUserMap=new Map([
  [PRIMARY,entry(PRIMARY)],[OTHER1,entry(OTHER1)],
  [OTHER2,{...entry(OTHER2),active:false}]
 ]);
 const r2=await auditOwnerTopology(fixture({users:badUserMap}));
 assert.equal(r2.ownerStatusCounts.DIFFERENT_UID_SECONDARY_FULLY_VALID,1);
 assert.equal(r2.ownerStatusCounts.DIFFERENT_UID_SECONDARY_NOT_VERIFIED,1);
});
test("different root companies do not get silently combined",async()=>{
 const users=new Map([[PRIMARY,entry(PRIMARY)],[OTHER1,entry(OTHER1,"company_OTHER")]]);
 const companies=new Map([
  [HUB,{ownerUid:PRIMARY,companyKind:"internal",active:true}],
  ["company_OTHER",{ownerUid:"other_root",companyKind:"internal",active:true}]
 ]);
 const r=await auditOwnerTopology(fixture({users,companies}));
 assert.equal(r.groupedCompanyCount,2);
 assert.equal(r.mismatchCompanyGroupCounts.NO_VERIFIED_OWNER_IN_SAMPLED_OWNERS,1);
});
test("over-limit and unsupported collection access fail before writing",async()=>{
 await assert.rejects(auditOwnerTopology(fixture({ownerRowCount:21})),
  /STOP_OWNER_TOPOLOGY_READONLY_OWNER_LIMIT_EXCEEDED/);
 await assert.rejects(auditOwnerTopology({db:{},auth:{}}),
  /STOP_OWNER_TOPOLOGY_READONLY_DEPENDENCIES/);
});
test("standalone live adapter only reads metadata and never outputs identity fields",()=>{
 const source=readFileSync(new URL("../tools/production/audit-owner-topology-live-readonly.mjs",import.meta.url),"utf8");
 assert.match(source,/--read-only/);
 assert.match(source,/GITHUB_REF!=="refs\/heads\/main"/);
 assert.doesNotMatch(source,/\.(?:set|update|delete|create|add|runTransaction)\s*\(/);
 assert.doesNotMatch(source,/\.collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries)"\)/);
 assert.doesNotMatch(source,/signInWith|createCustomToken|setCustomUserClaims|firebase deploy|httpsCallable/);
 assert.match(source,/identitiesLogged:false/);
});
