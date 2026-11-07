"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const path=require("node:path");
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
function fixture({workspaceEnabled=true}={}){
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
 const clock=()=>Date.parse("2026-11-07T19:00:00+09:00");
 const workspace=makeWorkspace({db,getAuth:auth,FieldValue,
  Timestamp:{fromMillis:ms=>({toMillis:()=>ms})},
  HttpsError:CallError,enabled:()=>workspaceEnabled,now:clock});
 // Read the actual count-only backend as the same verified bearer/UID.
 // A disabled or incompatible backend must block handoff BEFORE writing.
 const service=buildService({db,getAuth:auth,FieldValue,HttpsError:CallError,
  readCountWorkspace:request=>workspace.view(request),now:clock});
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
 assert.equal(result.countPathReadOnlyPreflightPassed,true);
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

test("missing or disabled count-only backend prevents both preview and primary transfer; zero writes",async()=>{
 const {db,service,req}=fixture({workspaceEnabled:false});
 const original=db.snapshot();
 await assert.rejects(service.preview(req("s",{workspaceCompanyId:"partner"})),
  e=>e.code==="failed-precondition");
 await assert.rejects(service.commit(req("s",{workspaceCompanyId:"partner",consent:CONSENT})),
  e=>e.code==="failed-precondition");
 assert.deepEqual(db.snapshot(),original);
});

test("existing incompatible shared count source blocks handoff without overwriting old reports",async()=>{
 const {db,service,req}=fixture();
 const summary="companies/hub/partnerWorkCountDays/2026-11-07/reports/partner";
 const amounts=Object.fromEntries(KEYS.map(k=>[k,0]));
 db.seed(summary,{source:"company-quick-v0",hubCompanyId:"hub",partnerCompanyId:"partner",
  date:"2026-11-07",counts:amounts,totalCount:0});
 const before=db.snapshot();
 await assert.rejects(service.preview(req("s",{workspaceCompanyId:"partner"})),
  e=>e.code==="failed-precondition");
 await assert.rejects(service.commit(req("s",{workspaceCompanyId:"partner",consent:CONSENT})),
  e=>e.code==="failed-precondition");
 assert.deepEqual(db.snapshot(),before);
});

test("inconsistent staff/day summary blocks the same UID from losing its internal input rights",async()=>{
 const {db,service,req}=fixture();
 const entry="companies/partner/partnerWorkEntries/2026-11-07__s";
 const summary="companies/hub/partnerWorkCountDays/2026-11-07/reports/partner";
 const zero=Object.fromEntries(KEYS.map(k=>[k,0])),two={...zero,[KEYS[0]]:2};
 db.seed(summary,{source:"staff-entries-v1",hubCompanyId:"hub",partnerCompanyId:"partner",
  date:"2026-11-07",counts:zero,totalCount:0});
 db.seed(entry,{staffId:"s",companyId:"partner",date:"2026-11-07",
  counts:two,totalCount:2,version:1,privateCounts:{},privateTotalCount:0});
 const before=db.snapshot();
 await assert.rejects(service.preview(req("s",{workspaceCompanyId:"partner"})));
 await assert.rejects(service.commit(req("s",{workspaceCompanyId:"partner",consent:CONSENT})));
 assert.deepEqual(db.snapshot(),before);
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
 const candidate=readFileSync(path.join(__dirname,"../staging/partner-primary-handoff/handoff.cjs"),"utf8");
 const production=readFileSync(path.join(__dirname,"../functions-partner-workspace/index.js"),"utf8");
 const rules=readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
 assert.ok(!production.includes("buildService"));
 assert.ok(!production.includes("secondaryPrimaryHandoff"));
 assert.ok(!rules.includes("partnerHistoricalTransfers"));
 assert.match(candidate,/STAGING ONLY/);
 assert.doesNotMatch(candidate,/firebase deploy|cloudfunctions\.net|setDoc\(/);
 for(const table of ["records","products","recordCorrections","revenueGoals",
  "partnerWorkEntries","partnerQuickCountDays"])
  assert.doesNotMatch(candidate,new RegExp('collection\\("'+table+'"\\)'));
});


test("actual STAGED handoff transaction closes original finance GET/LIST under current Emulator Rules without changing source originals",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST
},async()=>{
 // This joins the REAL buildService.commit() output with Firestore Rules.
 // The earlier Rules fixture modeled a hypothetical migration by hand.
 // All writes remain on an isolated demo Firestore emulator.
 const {initializeTestEnvironment,assertSucceeds,assertFails}=
  require("@firebase/rules-unit-testing");
 const {doc,setDoc,getDoc,collection,query,where,getDocsFromServer}=
  require("firebase/firestore");
 const {db,service,workspace,req}=fixture();
 const before=db.snapshot();
 const rules=readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
 const env=await initializeTestEnvironment({
  projectId:"demo-nico-secondary-handoff",firestore:{rules}
 });
 const self=env.authenticatedContext("s",{
  email:"s@example.com",email_verified:true
 }).firestore();
 const owner=env.authenticatedContext("h",{
  email:"h@example.com",email_verified:true
 }).firestore();
 const getRef=(firestore,p)=>doc(firestore,...p.split("/"));
 const money=["products","records","recordCorrections","revenueGoals"];
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const firestore=ctx.firestore();
   for(const [p,v] of Object.entries(before)){
    await setDoc(getRef(firestore,p),v);
   }
  });
  // PROVE existing primary/internal access for the same secondary partner UID:
  // permissions are still present before any approved self-handoff.
  for(const p of financialPaths.slice(0,3)){
   await assertSucceeds(getDoc(getRef(self,p)));
   await assertSucceeds(getDocsFromServer(query(
    collection(self,p.split("/")[0]),where("companyId","==","hub")
   )));
  }
  await assertFails(getDoc(getRef(self,financialPaths[3])));
  const beforePreview=db.snapshot();
  const preview=await service.preview(req("s",{
   workspaceCompanyId:"partner"
  }));
  assert.equal(preview.eligible,true);
  assert.deepEqual(db.snapshot(),beforePreview);
  const result=await service.commit(req("s",{
   workspaceCompanyId:"partner",consent:CONSENT
  }));
  assert.equal(result.transferred,true);
  assert.equal(result.historyArchived,true);
  const after=db.snapshot();
  const changed=Object.keys(after).filter(p=>
   JSON.stringify(after[p])!==JSON.stringify(before[p]));
  assert.deepEqual(changed.sort(),[
   "users/s","companies/hub/members/s",
   "partnerWorkspaceContexts/s","partnerHistoricalTransfers/s"
  ].sort());
  for(const p of financialPaths)
   assert.deepEqual(after[p],before[p],"financial document changed: "+p);
  // Apply ONLY the four exact documents produced by the actual handoff logic
  // to the local emulator, not any manually fabricated replacement.
  await env.withSecurityRulesDisabled(async ctx=>{
   const firestore=ctx.firestore();
   for(const p of changed)
    await setDoc(getRef(firestore,p),after[p]);
  });
  for(const p of financialPaths){
   await assertFails(getDoc(getRef(self,p)));
   await assertFails(getDocsFromServer(query(
    collection(self,p.split("/")[0]),where("companyId","==","hub")
   )));
   let retained;
   await env.withSecurityRulesDisabled(async ctx=>{
    retained=(await getDoc(getRef(ctx.firestore(),p))).data();
   });
   assert.deepEqual(retained,before[p],"old source changed after transfer: "+p);
   // Internal owner rights remain valid; no person is lost.
   await assertSucceeds(getDoc(getRef(owner,p)));
  }
  await assertFails(getDoc(getRef(self,"partnerHistoricalTransfers/s")));
  let archived;
  await env.withSecurityRulesDisabled(async ctx=>{
   archived=(await getDoc(getRef(ctx.firestore(),
    "partnerHistoricalTransfers/s"))).data();
  });
  assert.deepEqual(archived.originalUser,before["users/s"]);
  assert.deepEqual(archived.originalMember,before["companies/hub/members/s"]);
  assert.deepEqual(archived.originalContext,before["partnerWorkspaceContexts/s"]);
  assert.equal(after["companies/hub/members/s"].active,false);
  assert.equal(after["partnerWorkspaceContexts/s"].active,false);
  assert.equal(after["users/s"].companyId,"partner");
  assert.equal(after["users/s"].canViewRevenue,false);
  assert.equal(after["users/s"].canViewUnitPrice,false);
  const ownWorkspace=await workspace.view(req("s",{
   date:"2026-11-07"
  }));
  assert.equal(ownWorkspace.role,"member");
  assert.equal(ownWorkspace.companyName,"協力店");

  // Crucial release gate: the same UID that lost raw financial reads must
  // still submit and edit the count-only partner ledger after actual handoff.
  // This is the real isolated workspace service (Admin-backed in production),
  // not a copy of a fabricated Firestore counts report.
  const allZero=Object.fromEntries(KEYS.map(key=>[key,0]));
  const firstCounts={...allZero,[KEYS[0]]:2};
  const first=await workspace.submit(req("s",{
   date:"2026-11-07",staffId:"s",expectedVersion:0,counts:firstCounts
  }));
  assert.equal(first.saved,true);
  assert.equal(first.version,1);
  assert.equal(first.totalCount,2);
  const entries="companies/partner/partnerWorkEntries/2026-11-07__s";
  const summary="companies/hub/partnerWorkCountDays/2026-11-07/reports/partner";
  const audit1="companies/partner/partnerWorkAudits/2026-11-07__s__v1";
  const audit2="companies/partner/partnerWorkAudits/2026-11-07__s__v2";
  assert.equal(db.map.get(entries).totalCount,2);
  assert.equal(db.map.get(summary).source,"staff-entries-v1");
  assert.equal(db.map.get(summary).totalCount,2);
  assert.deepEqual(db.map.get(audit1).counts,firstCounts);
  assert.equal(db.map.get(audit2),undefined);
  const refreshed=await workspace.view(req("s",{date:"2026-11-07"}));
  assert.equal(refreshed.role,"member");
  assert.equal(refreshed.records.length,1);
  assert.equal(refreshed.records[0].totalCount,2);
  const staleBefore=db.snapshot();
  await assert.rejects(workspace.submit(req("s",{
   date:"2026-11-07",staffId:"s",expectedVersion:0,counts:firstCounts
  })),e=>e.code==="aborted");
  assert.deepEqual(db.snapshot(),staleBefore,
   "version conflict MUST NOT write count or financial documents");
  const nextCounts={...allZero,[KEYS[0]]:3};
  const edited=await workspace.submit(req("s",{
   date:"2026-11-07",staffId:"s",expectedVersion:1,counts:nextCounts
  }));
  assert.equal(edited.saved,true);
  assert.equal(edited.version,2);
  assert.equal(edited.totalCount,3);
  assert.equal(db.map.get(entries).version,2);
  assert.equal(db.map.get(summary).totalCount,3);
  assert.deepEqual(db.map.get(audit1).counts,firstCounts,
   "earlier count audit must remain immutable");
  assert.deepEqual(db.map.get(audit2).previousCounts,firstCounts);
  assert.deepEqual(db.map.get(audit2).counts,nextCounts);
  const afterEdit=await workspace.view(req("s",{date:"2026-11-07"}));
  assert.equal(afterEdit.records[0].totalCount,3);
  const hubAfterEdit=await workspace.view(req("h",{date:"2026-11-07"}));
  assert.equal(hubAfterEdit.role,"hub");
  for(const p of financialPaths)
   assert.deepEqual(db.map.get(p),before[p],
    "post-migration count submit/edit may not mutate old financial records: "+p);
  assert.deepEqual(db.map.get("partnerHistoricalTransfers/s").originalUser,before["users/s"]);
  // Emulate ONLY the count-only documents actually saved by the backend.
  // Neither the owner's old raw originals nor Firestore Rules are modified.
  await env.withSecurityRulesDisabled(async ctx=>{
   const firestore=ctx.firestore();
   for(const p of [entries,summary,audit1,audit2])
    await setDoc(getRef(firestore,p),db.map.get(p));
  });
  for(const p of financialPaths){
   await assertFails(getDoc(getRef(self,p)));
   await assertFails(getDocsFromServer(query(
    collection(self,p.split("/")[0]),where("companyId","==","hub")
   )));
   await assertSucceeds(getDoc(getRef(owner,p)));
  }
  // GET/LIST denial is a LOCAL EMULATOR proof, not production UID proof.
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST!==undefined,true);
  assert.equal(money.length,4);
 }finally{await env.cleanup()}
});
