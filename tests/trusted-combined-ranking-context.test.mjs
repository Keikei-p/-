import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createVerifiedRankTokenReader,createFreshCombinedRankingContext}
 from "../ranking/trusted-combined-ranking-context.mjs";
import {createStagedCombinedRankReadHandler}
 from "../ranking/combined-rank-only-handler.mjs";
import {createOwnerProductVisibilityStore}
 from "../ranking/owner-product-visibility-firestore.mjs";

const clone=x=>JSON.parse(JSON.stringify(x));
const baseDocs=()=>{
 const d=new Map();
 d.set("companies/hub",{name:"自社",active:true,companyKind:"internal",ownerUid:"hubOwner"});
 d.set("companies/p1",{name:"協力店A",active:true,companyKind:"partner",
  hubCompanyId:"hub",ownerUid:"partnerOwner"});
 for(const [uid,cid,access,memberType] of [
  ["hubOwner","hub","internal","direct"],
  ["partnerOwner","p1","partner","cooperator"]
 ]){
  const user={uid,companyId:cid,email:uid+"@example.test",
   active:true,companyRole:"owner",role:"leader",accessKind:access,
   memberType,canViewRevenue:access==="internal",
   canViewUnitPrice:access==="internal"};
  d.set("users/"+uid,user);
  d.set("companies/"+cid+"/members/"+uid,clone(user));
 }
 d.set("partnerRelations/p1",{
  hubCompanyId:"hub",partnerCompanyId:"p1",active:true,
  countSharingApproved:true,
  combinedRankingApprovedByHub:true,combinedRankingApprovedByPartner:true,
  individualNamesApprovedByHub:true,individualNamesApprovedByPartner:true
 });
 for(const [cid,uid] of [["hub","hubOwner"],["p1","partnerOwner"]])
  d.set("companies/"+cid+"/rankingApprovals/"+(cid==="hub"?"p1":"hub"),{
   companyId:cid,hubCompanyId:"hub",partnerCompanyId:"p1",
   approvedByUid:uid,active:true,scope:"combined_rank_only",version:1,
   combinedRankingApproved:true,individualNamesApproved:true
  });
 return d;
};
class Ref{
 constructor(path){this.path=path;this.id=path.split("/").at(-1);}
 collection(x){return new Coll(this.path+"/"+x);}
}
class Coll{
 constructor(path,filter=()=>true,limit=Infinity){
  this.path=path;this.filter=filter;this.max=limit;
 }
 doc(id){return new Ref(this.path+"/"+id);}
 where(key,operator,value){
  assert.equal(operator,"==");
  return new Coll(this.path,v=>this.filter(v)&&v[key]===value,this.max);
 }
 limit(n){return new Coll(this.path,this.filter,n);}
}
function fakeDb(initial=baseDocs()){
 const docs=initial,ops=[];
 const db={collection:x=>new Coll(x),
  runTransaction:async (fn,options)=>{
   ops.push({kind:"transaction",options});
   const tx={get:async ref=>{
    ops.push({kind:"get",path:ref.path});
    if(ref instanceof Ref){
     const row=docs.get(ref.path);
     return {id:ref.id,exists:row!==undefined,data:()=>clone(row)};
    }
    const rows=[...docs].filter(([p,v])=>p.startsWith(ref.path+"/")&&
       !p.slice(ref.path.length+1).includes("/")&&ref.filter(v))
      .slice(0,ref.max).map(([p,row])=>({
       id:p.split("/").at(-1),exists:true,data:()=>clone(row)
      }));
    return {docs:rows,size:rows.length};
   }};
   return fn(tx);
  }};
 return {db,docs,ops};
}
const makeAuth=(overrides={})=>({
 verifyIdToken:async (_token,checkRevoked)=>{
  assert.equal(checkRevoked,true);
  if(overrides.revoked)throw Error("revoked");
  return {uid:overrides.uid||"hubOwner",
   email:(overrides.uid||"hubOwner")+"@example.test",
   email_verified:overrides.tokenEmailVerified!==false};
 },
 getUser:async uid=>({
  uid,email:uid+"@example.test",
  disabled:overrides.disabled===true,
  emailVerified:overrides.authEmailVerified!==false,
  ...(overrides.authMailMismatch?{email:"wrong@example.test"}:{})
 })
});
const verified=async(uid="hubOwner")=>createVerifiedRankTokenReader({
 auth:makeAuth({uid})})("x".repeat(32));
const load=(docs)=>createFreshCombinedRankingContext({db:docs.db});
const refuse=/RANKING_IDENTITY_OR_OWNER_CONSENT_UNVERIFIED/;

test("trusted fresh hub and partner owners see the same fully approved linked set",async()=>{
 const a=fakeDb();
 for(const uid of ["hubOwner","partnerOwner"]){
  const auth=await verified(uid);
  const ctx=await load(a)(auth);
  assert.equal(ctx.viewerUid,uid);
  assert.equal(ctx.hubCompanyId,"hub");
  assert.equal(ctx.viewerCompanyId,uid==="hubOwner"?"hub":"p1");
  assert.deepEqual(ctx.approvedCompanyIds,["hub","p1"]);
  for(const flag of ["serverVerified","userActive","memberActive",
   "companyActive","activeCountSharingVerified",
   "completeSnapshotBudgetApproved"])
   assert.equal(ctx[flag],true);
  assert.deepEqual(ctx.publicNameCompanyIds,["hub","p1"]);
  assert.equal(Object.hasOwn(ctx,"reciprocalOwnersApproved"),false);
  assert.equal(Object.hasOwn(ctx,"individualNamesApproved"),false);
  assert.equal(Object.isFrozen(ctx.publicNameCompanyIds),true);
  assert.equal(Object.isFrozen(ctx),true);
 }
 assert.equal(a.ops.filter(x=>x.kind==="transaction").length,2);
 assert(a.ops.every(x=>x.kind!=="transaction"||x.options.readOnly===true));
 assert(a.ops.every(x=>x.kind!=="get"||
  !/\/(?:records|products|recordCorrections|revenueGoals)\//.test(x.path)));
});
test("Firebase Auth must have fresh verified matching email, unrevoked token",async()=>{
 for(const bad of [{revoked:true},{disabled:true},
  {tokenEmailVerified:false},{authEmailVerified:false},
  {authMailMismatch:true}]){
  const fn=createVerifiedRankTokenReader({auth:makeAuth(bad)});
  await assert.rejects(fn("x".repeat(32)),refuse);
 }
 await assert.rejects(
  createVerifiedRankTokenReader({auth:makeAuth()})("short"),refuse);
});

test("existing active count sharing works without any additional ranking or name approval",async()=>{
 const f=fakeDb(),relation=f.docs.get("partnerRelations/p1");
 for(const key of ["combinedRankingApprovedByHub","combinedRankingApprovedByPartner",
  "individualNamesApprovedByHub","individualNamesApprovedByPartner"])delete relation[key];
 f.docs.delete("companies/hub/rankingApprovals/p1");
 f.docs.delete("companies/p1/rankingApprovals/hub");
 const before=clone([...f.docs]);
 for(const uid of ["hubOwner","partnerOwner"]){
  const ctx=await load(f)(await verified(uid));
  assert.deepEqual(ctx.approvedCompanyIds,["hub","p1"]);
  assert.equal(ctx.activeCountSharingVerified,true);
  assert.deepEqual(ctx.publicNameCompanyIds,[uid==="hubOwner"?"hub":"p1"]);
 }
 assert.deepEqual([...f.docs],before);
 assert(!f.ops.some(x=>x.kind==="get"&&x.path.includes("/rankingApprovals/")),
  "missing additional approvals never trigger a required consent read");
});

test("optional existing name approvals are strict display permissions, never count gates",async()=>{
 for(const path of ["companies/hub/rankingApprovals/p1","companies/p1/rankingApprovals/hub"]){
  for(const mutate of [
   f=>f.docs.delete(path),
   ...[["active",false],["approvedByUid","otherOwner"],["individualNamesApproved",false],
    ["scope","counts"],["version",0],["companyId","other"],["hubCompanyId","other"],
    ["partnerCompanyId","other"]].map(([key,value])=>f=>{f.docs.get(path)[key]=value;})
  ]){
   const f=fakeDb();mutate(f);const before=clone([...f.docs]);
   const ctx=await load(f)(await verified());
   assert.deepEqual(ctx.approvedCompanyIds,["hub","p1"]);
   assert.deepEqual(ctx.publicNameCompanyIds,["hub"]);
   assert.deepEqual([...f.docs],before);
  }
 }
 const f=fakeDb();
 for(const side of ["Hub","Partner"])f.docs.get("partnerRelations/p1")["combinedRankingApprovedBy"+side]=false;
 for(const path of ["companies/hub/rankingApprovals/p1","companies/p1/rankingApprovals/hub"])
  f.docs.get(path).combinedRankingApproved=false;
 const ctx=await load(f)(await verified());
 assert.deepEqual(ctx.approvedCompanyIds,["hub","p1"]);
 assert.deepEqual(ctx.publicNameCompanyIds,["hub","p1"],
  "existing individual-name approval is independent of obsolete ranking consent");
});

test("an unclaimed linked partner remains count-eligible without impersonating its Owner",async()=>{
 for(const ownerUid of [undefined,null,""]){
  const f=fakeDb();if(ownerUid===undefined)delete f.docs.get("companies/p1").ownerUid;
  else f.docs.get("companies/p1").ownerUid=ownerUid;
  const ctx=await load(f)(await verified("hubOwner"));
  assert.deepEqual(ctx.approvedCompanyIds,["hub","p1"]);
  assert.deepEqual(ctx.publicNameCompanyIds,["hub"]);
  await assert.rejects(load(f)(await verified("partnerOwner")),refuse,
   "a viewer still needs the company's actual Owner identity");
 }
});

test("revoked company, falsified profile, money-capable partner and stale secondary are denied",async()=>{
 const scenarios=[
  d=>{d.get("companies/hub").ownerUid="notHubOwner";},
  d=>{d.get("companies/hub").active=false;},
  d=>{d.get("companies/p1").ownerUid="otherOwner";},
  d=>{d.get("companies/p1").hubCompanyId="otherHub";},
  d=>{d.get("companies/p1").active=false;},
  d=>{d.get("users/hubOwner").active=false;},
  d=>{d.get("users/hubOwner").accessKind="partner";},
  d=>{d.get("companies/hub/members/hubOwner").active=false;},
  d=>{d.get("users/hubOwner").companyRole="member";},
  d=>{d.get("companies/hub/members/hubOwner").companyRole="member";},
  d=>{d.get("users/hubOwner").email="other@example.test";},
  d=>{d.set("partnerWorkspaceContexts/hubOwner",{active:true,kind:"partner_secondary"});},
  d=>{d.set("partnerWorkspaceContexts/hubOwner",{active:"false"});},
  d=>{d.get("partnerRelations/p1").combinedRankingApprovedByPartner=false;
   d.get("companies/p1").companyKind="internal";},
  d=>{d.get("users/partnerOwner").canViewRevenue=true;},
  d=>{d.get("companies/p1/members/partnerOwner").canViewUnitPrice=true;}
 ];
 for(let i=0;i<scenarios.length;i++){
  const f=fakeDb();scenarios[i](f.docs);
  const uid=i===2||i>=13?"partnerOwner":"hubOwner";
  await assert.rejects(load(f)(await verified(uid)),refuse,"mutation "+i);
 }
});
test("unapproved relation is deliberately excluded, but partner viewer never omitted",async()=>{
 const f=fakeDb();f.docs.get("partnerRelations/p1").countSharingApproved=false;
 const hub=await load(f)(await verified("hubOwner"));
 assert.deepEqual(hub.approvedCompanyIds,["hub"]);
 await assert.rejects(load(f)(await verified("partnerOwner")),refuse);
});
test("missing or duplicated relation, scan above 100, approval above 29 fail closed",async()=>{
 const a=fakeDb();a.docs.get("partnerRelations/p1").partnerCompanyId="other";
 await assert.rejects(load(a)(await verified()),refuse);
 const many=fakeDb();
 for(let i=0;i<101;i++){
  many.docs.set("partnerRelations/new"+i,{
   hubCompanyId:"hub",partnerCompanyId:"new"+i,active:false
  });
 }
 await assert.rejects(load(many)(await verified()),refuse);
});
test("legacy rank-only fixture requires the independently verified all-name policy",async()=>{
 const f=fakeDb(),auth=makeAuth();
 const verifiedToken=createVerifiedRankTokenReader({auth});
 const contextReader=load(f);
 const handler=createStagedCombinedRankReadHandler({
  enabled:true,verifyFirebaseToken:verifiedToken,
  // This unregistered legacy fixture requires its old all-name contract.
  // The current canonical count HTTP path consumes the new context directly.
  loadFreshApprovedContext:async principal=>{
   const ctx=await contextReader(principal);
   if(!ctx.approvedCompanyIds.every(cid=>ctx.publicNameCompanyIds.includes(cid)))
    throw Error("LEGACY_ALL_NAME_POLICY_UNVERIFIED");
   return {...ctx,reciprocalOwnersApproved:ctx.activeCountSharingVerified,
    individualNamesApproved:true};
  },
  loadCompletePublicCountSources:async({month,context})=>({
   period:month,hubCompanyId:context.hubCompanyId,
   approvedCompanyIds:context.approvedCompanyIds,
   sources:context.approvedCompanyIds.map(cid=>({
    companyId:cid,kind:cid==="hub"?"own":"partner",
    companyLabel:cid==="hub"?"自社":"協力店A",
    consentVerified:true,isComplete:true,readTime:"2026-11-08T02:00:00Z",
    teams:[],records:[],lines:[],products:[]
   })),productGroups:[]
  })
 });
 const get=(search="month=2026-11")=>new Request(
  "https://nico-factory.web.app/v1/combined-ranks?"+search,
  {headers:{Origin:"https://nico-factory.web.app",
   Authorization:"Bearer "+"x".repeat(32)}});
 const success=await handler(get());
 assert.equal(success.status,200);
 const body=await success.json();
 assert.equal(body.schema,"nico-combined-rank-only-v1");
 assert(!/"(?:count|totalRevenue|unitPrice|cashback|uid)"/.test(JSON.stringify(body)));
 f.docs.get("companies/p1/rankingApprovals/hub").active=false;
 const denied=await handler(get());
 assert.equal(denied.status,503);
 assert.deepEqual(await denied.json(),{error:"request_blocked"});
 assert.equal((await handler(get("month=2026-11&companyId=hub"))).status,400);
});
test("new approval collections are denied by unchanged client Firestore Rules",()=>{
 const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
 assert.doesNotMatch(rules,/match\s+\/rankingApprovals\//);
 assert.doesNotMatch(rules,/allow\s+(?:read|write)\s*:\s*if\s+true/);
});


test("fresh Auth-backed owner context directly binds the existing Firestore publication reader (no client role)",async()=>{
 const f=fakeDb();
 const store=createOwnerProductVisibilityStore({db:f.db,
  FieldValue:{serverTimestamp:()=>{throw Error("NO_WRITES_ALLOWED")}}});
 for(const [uid,expectedRole] of [
  ["hubOwner","hub_owner"],["partnerOwner","partner_owner"]
 ]){
  const ctx=await load(f)(await verified(uid));
  assert.equal(ctx.role,expectedRole);
  assert.equal(ctx.viewerUid,uid);
  const published=await store.readForRanking({context:ctx,mappingsReviewed:true});
  assert.equal(published.hubCompanyId,"hub");
  assert.deepEqual(published.enabledHubProductIds,[],
   "missing owner settings must never default to publishing every SKU");
  assert.equal(published.ownerUidVerified,true);
  assert.equal(published.productMappingsReviewed,true);
 }
 assert(f.ops.every(x=>x.kind!=="transaction"||x.options.readOnly===true),
  "both identity and owner publication reads must be read-only");
 assert(f.ops.every(x=>x.kind!=="get"||
  !["records","recordCorrections","revenueGoals"].some(name=>
   x.path.includes("/"+name+"/"))),
  "never query raw finance documents");
 const forged={...(await load(f)(await verified("partnerOwner"))),role:"hub_owner"};
 await assert.rejects(store.readForRanking({context:forged,mappingsReviewed:true}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
});


test("a partner without existing audience-name approval sees only its own company names",async()=>{
 const f=fakeDb();
 f.docs.set("companies/p2",{name:"協力店B",active:true,companyKind:"partner",hubCompanyId:"hub",ownerUid:"otherOwner"});
 f.docs.set("partnerRelations/p2",{...f.docs.get("partnerRelations/p1"),partnerCompanyId:"p2"});
 for(const [cid,owner,other] of [["hub","hubOwner","p2"],["p2","otherOwner","hub"]])
  f.docs.set("companies/"+cid+"/rankingApprovals/"+other,{
   companyId:cid,hubCompanyId:"hub",partnerCompanyId:"p2",approvedByUid:owner,
   active:true,scope:"combined_rank_only",version:1,individualNamesApproved:true
  });
 assert.deepEqual((await load(f)(await verified("partnerOwner"))).publicNameCompanyIds,["hub","p1","p2"]);
 f.docs.get("partnerRelations/p1").individualNamesApprovedByPartner=false;
 const ctx=await load(f)(await verified("partnerOwner"));
 assert.deepEqual(ctx.approvedCompanyIds,["hub","p1","p2"]);
 assert.deepEqual(ctx.publicNameCompanyIds,["p1"],
  "another company's valid historical approval does not widen an unapproved audience");
});
