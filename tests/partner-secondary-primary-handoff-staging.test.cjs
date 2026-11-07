"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {buildService,CONSENT}=require("../staging/partner-primary-handoff/handoff.cjs");
const {makeWorkspace,KEYS}=require("../functions-partner-workspace/service.cjs");

const clone=x=>x===undefined?undefined:
 typeof x!=="object"||x===null?x:
 Array.isArray(x)?x.map(clone):Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v)]));
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1)}
 collection(k){return new Coll(this.db,this.path+"/"+k)}
 async get(){const value=this.db.map.get(this.path);return {exists:value!==undefined,data:()=>clone(value),id:this.id}}
}
class Coll{
 constructor(db,path){this.db=db;this.path=path}
 doc(id){return new Ref(this.db,this.path+"/"+id)}
 where(k,op,v){assert.equal(op,"==");return new Query(this.db,this.path,{k,v})}
 limit(n){return new Query(this.db,this.path,null,n)}
}
class Query{
 constructor(db,path,where,limit=Infinity){Object.assign(this,{db,path,where,limitCount:limit})}
 limit(n){return new Query(this.db,this.path,this.where,n)}
 async get(){
  const docs=[];
  for(const [path,value] of this.db.map){
   if(!path.startsWith(this.path+"/")||path.slice(this.path.length+1).includes("/"))continue;
   if(this.where&&value[this.where.k]!==this.where.v)continue;
   docs.push({id:path.split("/").at(-1),data:()=>clone(value)});
  }
  return {size:Math.min(docs.length,this.limitCount),docs:docs.slice(0,this.limitCount)};
 }
}
class FakeDb{
 constructor(){this.map=new Map()}
 collection(name){return new Coll(this,name)}
 seed(path,value){this.map.set(path,clone(value))}
 snapshot(){return clone(Object.fromEntries(this.map))}
 async runTransaction(fn){
  const ops=[];
  const tx={
   get:ref=>ref.get(),
   create:(ref,data)=>ops.push(["create",ref.path,clone(data)]),
   update:(ref,data)=>ops.push(["update",ref.path,clone(data)])
  };
  const result=await fn(tx);
  // All writes are atomic in this synthetic fixture: any duplicate or missing
  // document fails before applying any operation.
  for(const [op,path] of ops){
   if(op==="create"&&this.map.has(path))throw Error("duplicate");
   if(op==="update"&&!this.map.has(path))throw Error("missing");
  }
  for(const [op,path,data] of ops){
   const next=op==="create"?data:{...this.map.get(path),...data};
   for(const [key,value] of Object.entries(next)){
    if(value&&value.__deleteField===true)delete next[key];
   }
   this.map.set(path,next);
  }
  return result;
 }
}
class CallError extends Error{
 constructor(code){super("denied");this.code=code;}
}
const stamp={seconds:1794031200};
const FieldValue={
 serverTimestamp:()=>({...stamp}),
 delete:()=>({__deleteField:true})
};
function fixture(){
 const db=new FakeDb();
 db.seed("companies/hub",{name:"自社",companyKind:"internal",active:true,
  ownerUid:"h",masterUid:"h"});
 db.seed("companies/partner",{name:"協力店",companyKind:"partner",active:true,
  hubCompanyId:"hub",ownerUid:"p",masterUid:"p"});
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 db.seed("companies/partner/partnerWorkTeams/teamP",{companyId:"partner",name:"第1班",active:true});
 const user={
  uid:"s",companyId:"hub",name:"以前の社員",email:"s@example.com",active:true,
  companyRole:"member",role:"member",teamId:"oldTeam",accessKind:"internal",
  memberType:"direct",canViewRevenue:false,canViewUnitPrice:false,
  oldPreferences:{retained:"original"},legacyHistory:"do-not-remove",joinedAt:1200
 };
 const oldMember={uid:"s",companyId:"hub",email:"s@example.com",
  companyRole:"member",role:"member",teamId:"oldTeam",active:true,
  accessKind:"internal",memberType:"direct",oldTeamSnapshot:"original"};
 const pMember={uid:"s",companyId:"partner",companyRole:"member",role:"member",
  name:"協力店スタッフ",teamId:"teamP",active:true,accessKind:"partner",
  memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false,
  canCreateInvite:false};
 const ctx={uid:"s",kind:"partner_secondary",active:true,
  primaryCompanyId:"hub",partnerCompanyId:"partner",hubCompanyId:"hub",
  emailLower:"s@example.com",teamId:"teamP",role:"member"};
 db.seed("users/s",user);
 db.seed("companies/hub/members/s",oldMember);
 db.seed("companies/partner/members/s",pMember);
 db.seed("companies/partner/partnerWorkStaff/s",{
  uid:"s",companyId:"partner",name:"協力店スタッフ",kind:"account",
  role:"member",teamId:"teamP",active:true
 });
 db.seed("partnerWorkspaceContexts/s",ctx);
 db.seed("users/h",{uid:"h",companyId:"hub",companyRole:"owner",role:"leader",
  active:true,accessKind:"internal",memberType:"direct"});
 db.seed("companies/hub/members/h",{uid:"h",companyId:"hub",companyRole:"owner",
  role:"leader",active:true,accessKind:"internal",memberType:"direct"});
 db.seed("users/p",{uid:"p",companyId:"partner",companyRole:"owner",role:"leader",
  active:true,accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false});
 db.seed("companies/partner/members/p",{uid:"p",companyId:"partner",
  companyRole:"owner",role:"leader",active:true,accessKind:"partner",
  memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false});
 db.seed("products/historical",{companyId:"hub",unitPrice:10000,
  revenue:35000,cashback:5000});
 db.seed("records/old",{companyId:"hub",uid:"s",teamId:"oldTeam",
  date:"2026-10-30",totalRevenue:35000,totalCount:2,
  results:{p1:{count:2,revenuePerUnit:17500}}});
 db.seed("recordCorrections/old",{companyId:"hub",before:{totalRevenue:10000},
  after:{totalRevenue:35000}});
 db.seed("revenueGoals/old",{companyId:"hub",teamId:"oldTeam",targetRevenue:500000});
 const auth=()=>({
  getUser:async uid=>({uid,disabled:false,emailVerified:true,
   email:uid+"@example.com"}),
  verifyIdToken:async token=>({uid:token[0],email:token[0]+"@example.com",
   email_verified:true})
 });
 const service=buildService({db,getAuth:auth,FieldValue,HttpsError:CallError});
 const workspace=makeWorkspace({db,getAuth:auth,FieldValue,
  Timestamp:{fromMillis:ms=>({toMillis:()=>ms})},
  HttpsError:CallError,enabled:()=>true,now:()=>Date.parse("2026-11-07T19:00:00+09:00")});
 const req=(uid="s",data={})=>({data,auth:{uid,token:{
  email:uid+"@example.com",email_verified:true
 }},rawRequest:{headers:{authorization:"Bearer "+uid.repeat(40)}}});
 return {db,service,workspace,req};
}
const financialPaths=["products/historical","records/old",
 "recordCorrections/old","revenueGoals/old"];

test("read-only preview confirms eligibility but changes no company, money, member or count document",async()=>{
 const {db,service,req}=fixture(),before=db.snapshot();
 const result=await service.preview(req("s",{workspaceCompanyId:"partner"}));
 assert.equal(result.eligible,true);
 assert.equal(result.needsExplicitConsent,true);
 assert.equal(result.countInputReverificationRequired,true);
 assert.deepEqual(db.snapshot(),before);
 await assert.rejects(service.commit(req("s",{workspaceCompanyId:"partner"})),
  e=>e.code==="invalid-argument");
 assert.deepEqual(db.snapshot(),before);
});

test("atomic self handoff keeps every historical original and member snapshot; existing count-only service continues working",async()=>{
 const {db,service,workspace,req}=fixture();
 const original=db.snapshot();
 const before=await workspace.view(req("s",{
  date:"2026-11-07",workspaceCompanyId:"partner"
 }));
 assert.equal(before.role,"member");
 assert.equal(before.companyName,"協力店");
 const result=await service.commit(req("s",{
  workspaceCompanyId:"partner",consent:CONSENT
 }));
 assert.equal(result.transferred,true);
 assert.equal(result.historyArchived,true);
 assert.equal(db.map.get("users/s").companyId,"partner");
 assert.equal(db.map.get("users/s").accessKind,"partner");
 assert.equal(db.map.get("users/s").memberType,"cooperator");
 assert.equal(db.map.get("users/s").canViewRevenue,false);
 assert.equal(db.map.get("users/s").canViewUnitPrice,false);
 assert.equal(db.map.get("users/s").legacyHistory,undefined);
 assert.equal(db.map.get("companies/hub/members/s").active,false);
 assert.equal(db.map.get("partnerWorkspaceContexts/s").active,false);
 assert.deepEqual(db.map.get("partnerHistoricalTransfers/s").originalUser,
  original["users/s"]);
 assert.deepEqual(db.map.get("partnerHistoricalTransfers/s").originalMember,
  original["companies/hub/members/s"]);
 assert.deepEqual(db.map.get("partnerHistoricalTransfers/s").originalContext,
  original["partnerWorkspaceContexts/s"]);
 for(const path of financialPaths)
  assert.deepEqual(db.map.get(path),original[path],path);
 for(const path of ["companies/partner/members/s",
  "companies/partner/partnerWorkStaff/s","companies/hub",
  "companies/partner","partnerRelations/partner"])
  assert.deepEqual(db.map.get(path),original[path],path);
 const after=await workspace.view(req("s",{date:"2026-11-07"}));
 assert.equal(after.role,"member");
 assert.equal(after.teamId,"teamP");
 const counts=Object.fromEntries(KEYS.map((k,i)=>[k,i===0?2:0]));
 const saved=await workspace.submit(req("s",{date:"2026-11-07",
  staffId:"s",expectedVersion:0,counts}));
 assert.equal(saved.saved,true);
 assert.equal(saved.totalCount,2);
 const verified=await workspace.view(req("s",{date:"2026-11-07"}));
 assert.equal(verified.records.length,1);
 assert.equal(verified.records[0].totalCount,2);
 const owner=await workspace.view(req("h",{date:"2026-11-07"}));
 assert.equal(owner.role,"hub");
 for(const path of financialPaths)
  assert.deepEqual(db.map.get(path),original[path],path);
 assert.equal(db.map.get("partnerHistoricalTransfers/s").sourceCompanyId,"hub");
});

test("repeat, forged actor, concurrent archive, owner, revoked partner, changed team and financial grants fail atomically",async()=>{
 const {db,service,req}=fixture();
 const good={workspaceCompanyId:"partner",consent:CONSENT};
 for(const [path,change] of [
  ["users/s",{companyRole:"owner"}],
  ["companies/hub",{ownerUid:"s"}],
  ["companies/hub/members/s",{companyRole:"owner"}],
  ["partnerWorkspaceContexts/s",{teamId:"wrong"}],
  ["companies/partner/partnerWorkTeams/teamP",{active:false}],
  ["partnerRelations/partner",{countSharingApproved:false}],
  ["companies/partner/members/s",{canViewUnitPrice:true}],
  ["companies/partner/partnerWorkStaff/s",{teamId:"otherTeam"}],
  ["users/s",{companyId:"otherHub"}],
  ["companies/partner",{active:false}]
 ]){
  const original=clone(db.map.get(path));
  db.seed(path,{...original,...change});
  const before=db.snapshot();
  await assert.rejects(service.commit(req("s",good)));
  assert.deepEqual(db.snapshot(),before,"aborted handoff must write nothing: "+path);
  db.seed(path,original);
 }
 const before=db.snapshot();
 await assert.rejects(service.commit(req("h",good)));
 assert.deepEqual(db.snapshot(),before);
 db.seed("partnerHistoricalTransfers/s",{uid:"s",alreadyArchived:true});
 const archived=db.snapshot();
 await assert.rejects(service.commit(req("s",good)));
 assert.deepEqual(db.snapshot(),archived);
 db.map.delete("partnerHistoricalTransfers/s");
 await service.commit(req("s",good));
 const after=db.snapshot();
 await assert.rejects(service.commit(req("s",good)));
 assert.deepEqual(db.snapshot(),after,"repeat call must not duplicate transfer or mutate history");
});

test("rejects forged request fields and unverified tokens without Firestore writes",async()=>{
 const {db,service,req}=fixture(),before=db.snapshot();
 for(const data of [
  {workspaceCompanyId:"partner",consent:CONSENT,uid:"h"},
  {workspaceCompanyId:"other",consent:CONSENT},
  {workspaceCompanyId:"partner",consent:"I agree"},
  {workspaceCompanyId:"partner",consent:CONSENT,amount:1}
 ]){
  await assert.rejects(service.commit(req("s",data)));
 }
 const invalid=req("s",{workspaceCompanyId:"partner",consent:CONSENT});
 invalid.auth.token.email_verified=false;
 await assert.rejects(service.commit(invalid),e=>e.code==="unauthenticated");
 const forged=req("s",{workspaceCompanyId:"partner",consent:CONSENT});
 forged.rawRequest.headers.authorization="Bearer "+"h".repeat(40);
 await assert.rejects(service.commit(forged),e=>e.code==="unauthenticated");
 assert.deepEqual(db.snapshot(),before);
});

test("candidate is unregistered, no production SDK, no historical financial mutations or deploy scope",()=>{
 const candidate=readFileSync(new URL("../staging/partner-primary-handoff/handoff.cjs",import.meta.url),"utf8");
 const production=readFileSync(new URL("../functions-partner-workspace/index.js",import.meta.url),"utf8");
 const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
 assert.ok(!production.includes("buildService"));
 assert.ok(!production.includes("secondaryPrimaryHandoff"));
 assert.ok(!rules.includes("partnerHistoricalTransfers"));
 assert.match(candidate,/STAGING ONLY/);
 assert.doesNotMatch(candidate,/firebase deploy|cloudfunctions\.net|setDoc\(/);
 for(const table of ["records","products","recordCorrections","revenueGoals",
  "partnerWorkEntries","partnerQuickCountDays"])
  assert.doesNotMatch(candidate,new RegExp('collection\\("'+table+'"\\)'));
});
