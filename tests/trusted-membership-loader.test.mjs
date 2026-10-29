import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedMembershipLoader} from "../security/trusted-membership-loader.mjs";
import {createCountOnlyReadHandler} from "../security/public-count-api.mjs";
const AUTH_TIME=Math.floor(Date.parse("2026-10-29T09:00:00Z")/1000);
const auth={uid:"partnerLeader",emailVerified:true,authTime:AUTH_TIME};
const authorization=new Request("https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId=teamA",{
 headers:{Origin:"https://nico-factory.web.app",
 Authorization:"Bearer test-signed-token-mocked-with-no-real-user"}
});
function setup(){
 const doc=new Map([
  ["users/partnerLeader",{uid:"partnerLeader",companyId:"partnerCo",active:true,
    accessKind:"partner",role:"leader",companyRole:"member",teamId:"teamA",canViewRevenue:true}],
  ["companies/partnerCo",{companyKind:"partner",hubCompanyId:"hub",
    ownerUid:"partnerOwner",active:true}],
  ["companies/partnerCo/members/partnerLeader",{uid:"partnerLeader",
    companyId:"partnerCo",active:true,accessKind:"partner",role:"leader",
    companyRole:"member",teamId:"teamA",canViewRevenue:true,canViewUnitPrice:true}],
  ["teams/teamA",{companyId:"partnerCo",active:true}],
  ["teams/teamB",{companyId:"partnerCo",active:true}],
  ["partnerRelations/partnerCo",{partnerCompanyId:"partnerCo",hubCompanyId:"hub",
    active:true,countSharingApproved:true,catalogAccessApproved:true}],
  ["companies/hub",{companyKind:"internal",ownerUid:"hubOwner",active:true}]
 ]);
 let authAccount={uid:"partnerLeader",disabled:false,emailVerified:true,
   tokensValidAfterTime:"2026-10-01T00:00:00.000Z"};
 const accesses=[],authLookups=[];
 const loader=createTrustedMembershipLoader({
  readDocument:async(path)=>{
   accesses.push(path);
   assert(!/^(records|products|recordCorrections|revenueGoals)\//.test(path));
   const v=doc.get(path);return v===undefined?null:structuredClone(v);
  },
  loadAuthUser:async uid=>{authLookups.push(uid);return structuredClone(authAccount);}
 });
 return {doc,loader,accesses,authLookups,updateAuth:o=>{authAccount={...authAccount,...o};}};
}
test("partner leader financial flags are ignored; only verified company+team count scope is returned",async()=>{
 const f=setup(),scope=await f.loader("partnerLeader",auth);
 assert.deepEqual(scope,{
  uid:"partnerLeader",companyId:"partnerCo",userCompanyId:"partnerCo",
  memberCompanyId:"partnerCo",userActive:true,memberActive:true,
  companyOwnerUid:"partnerOwner",userCompanyRole:"member",
  memberCompanyRole:"member",serverVerifiedOwner:false,teamIds:["teamA"]
 });
 assert.equal(JSON.stringify(scope).includes("revenue"),false);
 assert.equal(f.authLookups.length,1);
 assert(f.accesses.includes("partnerRelations/partnerCo"));
});
test("every request rechecks current ACL and prevents revoked member, partner link and team changes",async()=>{
 const f=setup(),read=()=>f.loader("partnerLeader",auth);
 await read();
 const member=f.doc.get("companies/partnerCo/members/partnerLeader");
 member.active=false;
 await assert.rejects(read(),/not authorized/);
 member.active=true;
 f.doc.get("partnerRelations/partnerCo").countSharingApproved=false;
 await assert.rejects(read(),/not authorized/);
 f.doc.get("partnerRelations/partnerCo").countSharingApproved=true;
 f.doc.get("users/partnerLeader").teamId="teamB";
 await assert.rejects(read(),/not authorized/);
 f.doc.get("companies/partnerCo/members/partnerLeader").teamId="teamB";
 assert.deepEqual((await read()).teamIds,["teamB"]);
 f.doc.get("companies/partnerCo").active=false;
 await assert.rejects(read(),/not authorized/);
});
test("expired/revoked or disabled Auth account is rejected independently of Firestore company role",async()=>{
 const f=setup();
 f.updateAuth({disabled:true});
 await assert.rejects(f.loader("partnerLeader",auth),/not authorized/);
 f.updateAuth({disabled:false,tokensValidAfterTime:"2026-10-29T09:01:00.000Z"});
 await assert.rejects(f.loader("partnerLeader",auth),/not authorized/);
 f.updateAuth({tokensValidAfterTime:"invalid"});
 await assert.rejects(f.loader("partnerLeader",auth),/not authorized/);
 f.updateAuth({tokensValidAfterTime:"2026-10-01T00:00:00.000Z",emailVerified:false});
 await assert.rejects(f.loader("partnerLeader",auth),/not authorized/);
 await assert.rejects(f.loader("partnerLeader",{uid:"wrong",emailVerified:true,authTime:AUTH_TIME}),/not authorized/);
});
test("company hopping, stale roles, inactive teams and missing documents fail closed",async()=>{
 const f=setup(),read=()=>f.loader("partnerLeader",auth);
 for(const [path,key,value] of [
  ["users/partnerLeader","companyId","hub"],
  ["companies/partnerCo/members/partnerLeader","companyId","hub"],
  ["users/partnerLeader","accessKind","internal"],
  ["companies/partnerCo","companyKind","internal"],
  ["teams/teamA","companyId","hub"],
  ["teams/teamA","active",false],
  ["partnerRelations/partnerCo","hubCompanyId","other"],
  ["companies/hub","active",false]
 ]){
  const row=f.doc.get(path),old=row[key];row[key]=value;
  await assert.rejects(read(),/not authorized/,path+" "+key);
  row[key]=old;
 }
 const saved=f.doc.get("partnerRelations/partnerCo");
 f.doc.delete("partnerRelations/partnerCo");
 await assert.rejects(read(),/not authorized/);
 f.doc.set("partnerRelations/partnerCo",saved);
});
test("partner owner is identified by actual company.ownerUid, never the leader role",async()=>{
 const f=setup(),read=()=>f.loader("partnerLeader",auth);
 let result=await read();assert.equal(result.serverVerifiedOwner,false);
 const company=f.doc.get("companies/partnerCo"),user=f.doc.get("users/partnerLeader"),
   member=f.doc.get("companies/partnerCo/members/partnerLeader");
 user.companyRole="owner";member.companyRole="owner";
 result=await read();assert.equal(result.serverVerifiedOwner,false);
 company.ownerUid="partnerLeader";
 result=await read();assert.equal(result.serverVerifiedOwner,true);
 assert(!Object.hasOwn(result,"canViewRevenue"));
});
test("count-only API refuses cross-team requests, revoked partner access and never queries finance raw docs",async()=>{
 const f=setup(),queried=[];
 const handler=createCountOnlyReadHandler({
  enabled:true,
  authenticateBearer:async()=>auth,
  loadMembership:f.loader,
  queryPublicDocuments:async options=>{
   queried.push(options);
   return {items:[{
    companyId:"partnerCo",sourceId:"record1",uid:"partnerLeader",
    teamId:"teamA",date:"2026-10-29",totalCount:2,
    reportStatus:"submitted",memberNameSnapshot:"担当者",
    teamNameSnapshot:"A班",workLocation:"会場"
   }],readTime:"2026-10-29T09:00:00Z"};
  }
 });
 const first=await handler(authorization);
 assert.equal(first.status,200);
 const json=JSON.stringify(await first.json());
 for(const key of ["uid","totalRevenue","revenuePerUnit","canViewRevenue","cashback"])
  assert.equal(json.includes(key),false);
 const forbidden=new Request(authorization.url.replace("teamA","teamB"),{
  headers:authorization.headers
 });
 assert.equal((await handler(forbidden)).status,403);
 assert.equal(queried.length,1);
 f.doc.get("partnerRelations/partnerCo").active=false;
 assert.notEqual((await handler(authorization)).status,200);
 assert.equal(queried.length,1);
});
