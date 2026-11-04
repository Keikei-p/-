"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {makeAccountErasure}=require("../functions-account-erasure/service.cjs");
const NOW=Date.parse("2026-11-04T02:00:00Z");
const clone=x=>x===undefined?undefined:structuredClone(x);
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Coll(this.db,this.path+"/"+name);}
 async get(){const value=this.db.store.get(this.path);
  return {exists:value!==undefined,data:()=>clone(value),id:this.id};}
}
class Coll{
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(field,operation,value){assert.equal(operation,"==");return new Query(this.db,this.path,field,value);}
}
class Query{
 constructor(db,root,field,value,cap=Infinity){this.db=db;this.root=root;this.field=field;this.value=value;this.cap=cap;}
 limit(n){return new Query(this.db,this.root,this.field,this.value,n);}
 async get(){
  const docs=[];
  for(const [path,record] of this.db.store){
   if(path.startsWith(this.root+"/")&&
      !path.slice(this.root.length+1).includes("/")&&
      record[this.field]===this.value){
    docs.push({id:path.split("/").at(-1),data:()=>clone(record)});
   }
  }
  const rows=docs.slice(0,this.cap);
  return {size:rows.length,docs:rows};
 }
}
class DB{
 constructor(){this.store=new Map();this.writes=[];}
 collection(name){return new Coll(this,name);}
 seed(path,data){this.store.set(path,clone(data));}
 async runTransaction(callback){
  const ops=[];
  const tx={
   get:ref=>ref.get(),
   create:(ref,value)=>ops.push(["create",ref.path,clone(value)]),
   set:(ref,value)=>ops.push(["set",ref.path,clone(value)]),
   update:(ref,value)=>ops.push(["update",ref.path,clone(value)]),
   delete:ref=>ops.push(["delete",ref.path,null])
  };
  const result=await callback(tx);
  for(const [op,path] of ops){
   if(op==="create"&&this.store.has(path))throw Error("already exists");
   if((op==="update"||op==="set"||op==="delete")&&!this.store.has(path))throw Error("missing");
  }
  for(const [op,path,data] of ops){
   if(op==="delete"){this.store.delete(path);this.writes.push([op,path]);continue;}
   const next=op==="create"||op==="set"?data:{...clone(this.store.get(path)),...data};
   for(const [key,val] of Object.entries(next))if(val?.__deleteField)delete next[key];
   this.store.set(path,next);this.writes.push([op,path]);
  }
  return result;
 }
}
class ErrorCode extends Error{constructor(code,message){super(message);this.code=code;}}
function setup({authAgeSec=0,featureEnabled=true}={}){
 const db=new DB(),people=new Map(),events=[];let throwOnDelete=false;
 const account=(uid,email=uid+"@example.com")=>people.set(uid,{uid,email,
  emailVerified:true,disabled:false,metadata:{creationTime:"2025-01-01T00:00:00.000Z"}});
 for(const uid of ["owner","staff","powner","pleader","pmember","pother","foreign","another"])
  account(uid);
 db.seed("companies/hub",{name:"自社",ownerUid:"owner",companyKind:"internal",active:true});
 db.seed("companies/hub/members/owner",{uid:"owner",companyId:"hub",companyRole:"owner",role:"leader",active:true,accessKind:"internal"});
 db.seed("users/owner",{uid:"owner",companyId:"hub",companyRole:"owner",role:"leader",active:true,accessKind:"internal"});
 db.seed("companies/hub/members/staff",{uid:"staff",companyId:"hub",companyRole:"member",role:"member",active:true,
  email:"staff@example.com",teamId:"former-team",
  teamHistory:[{effectiveDate:"2026-10-01",fromTeamId:"before",toTeamId:"former-team"}]});
 db.seed("users/staff",{uid:"staff",companyId:"hub",companyRole:"member",role:"member",active:true,
  name:"山田 太郎",email:"staff@example.com",accessKind:"internal",teamId:"former-team",
  teamHistory:[{effectiveDate:"2026-10-01",fromTeamId:"before",toTeamId:"former-team"}]});
 db.seed("companies/partner",{name:"協力店",ownerUid:"powner",companyKind:"partner",hubCompanyId:"hub",active:true});
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",active:true,countSharingApproved:true});
 for(const [uid,role,companyRole,teamId] of [["powner","leader","owner","a"],["pleader","leader","member","a"],
  ["pmember","member","member","a"],["pother","member","member","b"]]){
  const x={uid,name:uid==="pmember"?"田中 花子":uid,email:uid+"@example.com",
   companyId:"partner",companyRole,role,teamId,active:true,
   accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false};
  db.seed("users/"+uid,x);
  db.seed("companies/partner/members/"+uid,x);
  db.seed("companies/partner/partnerWorkStaff/"+uid,{uid,name:x.name,email:x.email,companyId:"partner",
    kind:"account",role,teamId,active:true,
    teamHistory:[{effectiveDate:"2026-10-01",fromTeamId:"before",toTeamId:teamId}]});
 }
 db.seed("products/money",{companyId:"hub",price:70000,unitPrice:9000});
 db.seed("records/old",{companyId:"hub",totalCount:7,totalRevenue:100000,
  results:{product:{count:7,unitPrice:9000}},teamId:"oldTeam",uid:"staff"});
 db.seed("recordCorrections/original",{uid:"staff",oldTotalCount:6,newTotalCount:7,oldRevenue:90000,newRevenue:100000});
 db.seed("companies/partner/partnerWorkEntries/2026-11-03__pmember",
  {companyId:"partner",staffId:"pmember",teamIdSnapshot:"a",staffNameSnapshot:"田中 花子",
   totalCount:3,counts:{NURO:3},cbCounts:{NURO:{"20000":3}}});
 const auth={
  getUser:async uid=>{if(!people.has(uid)){const e=Error("not found");e.code="auth/user-not-found";throw e;}
   return clone(people.get(uid));},
  verifyIdToken:async token=>{const uid=token.split("-")[0];return {uid,email:uid+"@example.com",
   email_verified:true,auth_time:NOW/1000-authAgeSec};},
  setCustomUserClaims:async(uid,claims)=>{
   events.push(["claims",uid]);
   const user=people.get(uid);
   if(!user)throw Error("Auth user no longer exists");
   user.customClaims=clone(claims);
  },
  updateUser:async(uid,patch)=>{events.push(["disable",uid,patch]);const u=people.get(uid);
   if(!u)throw Object.assign(Error("missing"),{code:"auth/user-not-found"});Object.assign(u,patch);},
  deleteUser:async uid=>{events.push(["delete",uid]);if(throwOnDelete)throw Error("network");
   if(!people.has(uid))throw Object.assign(Error("missing"),{code:"auth/user-not-found"});
   people.delete(uid);}
 };
 const request=(uid,data={})=>({auth:{uid,token:{email:uid+"@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+uid+"-".repeat(35)}},data});
 const service=makeAccountErasure({
  db,getAuth:()=>auth,HttpsError:ErrorCode,FieldValue:{
   serverTimestamp:()=>({__serverTimestamp:true}),delete:()=>({__deleteField:true})
  },enabled:()=>featureEnabled,now:()=>NOW
 });
 return{db,people,events,service,request,
  failDeletion:()=>{throwOnDelete=true;},restoreDeletion:()=>{throwOnDelete=false;},
  history:()=>["products/money","records/old","recordCorrections/original",
   "companies/partner/partnerWorkEntries/2026-11-03__pmember"]
   .map(path=>[path,clone(db.store.get(path))])
 };
}
test("owner preview is read-only and confirms irreversible Auth/profile erasure without touching business history",async()=>{
 const s=setup(),original=s.history(),before=clone([...s.db.store]);
 const p=await s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"}));
 assert.equal(p.ready,true);assert.equal(p.targetName,"山田 太郎");
 assert.deepEqual([...s.db.store],before);
 const result=await s.service.confirm(s.request("owner",{action:"confirm",targetUid:"staff",
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"}));
 assert.equal(result.complete,true);
 assert.equal(result.authDeleted,true);
 assert.equal(s.people.has("staff"),false);
 assert.equal(s.db.store.has("users/staff"),false);
 assert.equal(s.db.store.has("companies/hub/members/staff"),false);
 assert.deepEqual(s.history(),original);
 assert.equal(s.db.store.size,before.length-1,"one receipt created; former user and membership removed");
 const receipt=[...s.db.store].find(([k])=>k.startsWith("accountErasureJobs/"))?.[1];
 assert.equal(receipt.status,"complete");
 assert.deepEqual(receipt.businessHistory.userTeamHistory,
  [{effectiveDate:"2026-10-01",fromTeamId:"before",toTeamId:"former-team"}]);
 assert.ok(!JSON.stringify(receipt).includes("山田"));
 assert.ok(!JSON.stringify(receipt).includes("staff@example.com"));
 const again=await s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"}));
 assert.equal(again.completed,true);
});
test("partner leader may delete same-team member, but staff history stays as anonymous tombstone",async()=>{
 const s=setup(),original=s.history();
 s.db.store.get("companies/partner/partnerWorkStaff/pmember").privatePhone="090-0000-0000";
 const before=await s.service.preview(s.request("pleader",{action:"preview",targetUid:"pmember"}));
 assert.equal(before.ready,true);assert.equal(before.targetName,"田中 花子");
 const result=await s.service.confirm(s.request("pleader",{action:"confirm",targetUid:"pmember",
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"田中 花子"}));
 assert.equal(result.complete,true);
 assert.equal(s.people.has("pmember"),false);
 assert.equal(s.db.store.has("users/pmember"),false);
 assert.equal(s.db.store.has("companies/partner/members/pmember"),false);
 assert.deepEqual(s.db.store.get("companies/partner/partnerWorkStaff/pmember").name,"退会済み");
 assert.equal(s.db.store.get("companies/partner/partnerWorkStaff/pmember").email,undefined);
 assert.equal(s.db.store.get("companies/partner/partnerWorkStaff/pmember").uid,null);
 assert.equal(s.db.store.get("companies/partner/partnerWorkStaff/pmember").privatePhone,undefined);
 assert.deepEqual(s.history(),original,"all previously saved count and finance snapshots unchanged");
});
test("partner leader cannot delete another team or another leader, owner cannot delete self",async()=>{
 const s=setup(),snapshot=clone([...s.db.store]);
 for(const [caller,target] of [["pleader","pother"],["pleader","powner"],["owner","owner"],
  ["owner","pmember"],["pmember","pleader"]]){
  await assert.rejects(s.service.preview(s.request(caller,{action:"preview",targetUid:target})));
 }
 assert.deepEqual([...s.db.store],snapshot);
 assert.equal(s.events.length,0);
});
test("dual-company context or historical transfer prevents unsafe cross-company account erasure",async()=>{
 for(const block of ["partnerWorkspaceContexts/staff","partnerHistoricalTransfers/staff"]){
  const s=setup(),snapshot=clone([...s.db.store]);
  s.db.seed(block,{uid:"staff",sourceCompanyId:"hub"});
  const now=clone([...s.db.store]);
  await assert.rejects(s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"})),e=>e.code==="failed-precondition");
  assert.deepEqual([...s.db.store],now);
  assert.equal(s.events.length,0);
  assert.notDeepEqual(now,snapshot);
 }
});
test("mismatched Firebase Authentication email or Firestore identity blocks erasure",async()=>{
 for(const alter of [
  s=>{s.people.get("staff").email="different@example.com";},
  s=>{s.db.store.get("users/staff").companyId="partner";},
  s=>{s.db.store.get("companies/hub/members/staff").uid="foreign";}
 ]){
  const s=setup();alter(s);
  const before=clone([...s.db.store]);
  await assert.rejects(s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"})));
  assert.deepEqual([...s.db.store],before);
  assert.equal(s.events.length,0);
 }
});
test("failed Auth deletion retains a resumable pending job and all saved business records",async()=>{
 const s=setup(),history=s.history();s.failDeletion();
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",targetUid:"staff",
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),e=>e.code==="unavailable");
 assert.equal(s.people.has("staff"),true);
 assert.equal(s.db.store.get("users/staff").active,false);
 assert.deepEqual(s.history(),history);
 const pending=await s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"}));
 assert.equal(pending.pending,true);
 s.restoreDeletion();
 const resumed=await s.service.confirm(s.request("owner",{action:"confirm",targetUid:"staff",
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"}));
 assert.equal(resumed.complete,true);
 assert.equal(s.people.has("staff"),false);
 assert.deepEqual(s.history(),history);
});
test("malformed confirmation or foreign uid cannot write or delete any account",async()=>{
 const s=setup(),start=clone([...s.db.store]);
 for(const data of [
  {action:"confirm",targetUid:"staff",confirmation:"wrong",confirmName:"山田 太郎"},
  {action:"confirm",targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"別人"},
  {action:"confirm",targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎",companyId:"partner"}
 ]){
  await assert.rejects(s.service.confirm(s.request("owner",data)));
 }
 assert.deepEqual([...s.db.store],start);
 assert.equal(s.events.length,0);
});


test("previously suspended company member can have Auth and live account deleted without changing sales",async()=>{
 const s=setup(),history=s.history();
 s.db.store.get("users/staff").active=false;
 s.db.store.get("companies/hub/members/staff").active=false;
 s.people.get("staff").disabled=true;
 const preview=await s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"}));
 assert.equal(preview.ready,true);
 const result=await s.service.confirm(s.request("owner",{action:"confirm",targetUid:"staff",
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"}));
 assert.equal(result.complete,true);
 assert.equal(s.people.has("staff"),false);
 assert.deepEqual(s.history(),history);
});
test("stale administrator authentication cannot erase any Firebase account or business data",async()=>{
 const s=setup({authAgeSec:360}),before=clone([...s.db.store]);
 const p=await s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"}));
 assert.equal(p.ready,true);
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",targetUid:"staff",
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),e=>e.code==="failed-precondition");
 assert.deepEqual([...s.db.store],before);
 assert.equal(s.events.length,0);
});
test("erasure feature is disabled by default on nonreviewed deployments",async()=>{
 const s=setup({featureEnabled:false}),before=clone([...s.db.store]);
 await assert.rejects(s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"})),e=>e.code==="unavailable");
 assert.deepEqual([...s.db.store],before);
 assert.equal(s.events.length,0);
});


test("manager can find suspended pending erasure after browser reload and safely resume",async()=>{
 const s=setup(),history=s.history();
 s.failDeletion();
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),
  e=>e.code==="unavailable");
 const pending=await s.service.listPending(s.request("owner",{action:"listPending"}));
 assert.deepEqual(pending.pending,[{targetUid:"staff",targetName:"山田 太郎"}]);
 const preview=await s.service.preview(s.request("owner",{action:"preview",targetUid:"staff"}));
 assert.equal(preview.pending,true);
 assert.equal(preview.targetName,"山田 太郎");
 const recorded=clone([...s.db.store]); // listing and preview are strictly read-only
 await s.service.listPending(s.request("owner",{action:"listPending"}));
 assert.deepEqual([...s.db.store],recorded);
 s.restoreDeletion();
 const response=await s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"}));
 assert.equal(response.complete,true);
 assert.deepEqual((await s.service.listPending(s.request("owner",{action:"listPending"}))).pending,[]);
 const receipt=[...s.db.store].find(([path])=>path.startsWith("accountErasureJobs/"))[1];
 assert.equal(receipt.status,"complete");
 assert.equal(receipt.targetUid,undefined);
 assert.equal(receipt.targetName,undefined);
 assert.equal(receipt.targetAuthHash,undefined);
 assert.deepEqual(s.history(),history);
});
test("a newly recreated Auth UID cannot be deleted using the earlier pending erasure approval",async()=>{
 const s=setup(),history=s.history();s.failDeletion();
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),e=>e.code==="unavailable");
 s.people.set("staff",{uid:"staff",email:"staff@example.com",disabled:false,emailVerified:true,
  metadata:{creationTime:"2026-11-04T00:00:00.000Z"}});
 s.restoreDeletion();const events=s.events.length;
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),e=>e.code==="failed-precondition");
 assert.equal(s.events.length,events,"new Firebase account must not receive updateUser/deleteUser");
 assert.equal(s.people.has("staff"),true);
 assert.deepEqual(s.history(),history);
});
test("if previous attempt deleted Auth but not Firestore, retry safely completes only profile cleanup",async()=>{
 const s=setup(),history=s.history();s.failDeletion();
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),e=>e.code==="unavailable");
 s.people.delete("staff");
 const events=s.events.length;
 s.restoreDeletion();
 const finished=await s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"}));
 assert.equal(finished.complete,true);
 assert.equal(s.events.length,events,"Auth already missing: do not attempt deletion again");
 assert.equal(s.db.store.has("users/staff"),false);
 assert.equal(s.db.store.has("companies/hub/members/staff"),false);
 assert.deepEqual(s.history(),history);
});
test("pending erasure list only exposes original requesting owner and never other partner/company identities",async()=>{
 const s=setup();s.failDeletion();
 await assert.rejects(s.service.confirm(s.request("pleader",{action:"confirm",
  targetUid:"pmember",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"田中 花子"})),e=>e.code==="unavailable");
 assert.deepEqual((await s.service.listPending(s.request("owner",{action:"listPending"}))).pending,[]);
 assert.deepEqual((await s.service.listPending(s.request("powner",{action:"listPending"}))).pending,[]);
 const own=await s.service.listPending(s.request("pleader",{action:"listPending"}));
 assert.deepEqual(own.pending,[{targetUid:"pmember",targetName:"田中 花子"}]);
});


test("reused UID with identical email and creationTime is blocked without original Auth proof",async()=>{
 const s=setup(),history=s.history();
 s.failDeletion();
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),
  e=>e.code==="unavailable");
 const original=clone(s.people.get("staff"));
 assert.ok(original.customClaims?.nicoErasureProofV1);
 s.people.set("staff",{uid:"staff",email:original.email,
  emailVerified:true,disabled:false,
  metadata:clone(original.metadata)});
 s.restoreDeletion();
 const opsBefore=s.events.length;
 await assert.rejects(s.service.confirm(s.request("owner",{action:"confirm",
  targetUid:"staff",confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"山田 太郎"})),
  e=>e.code==="failed-precondition");
 assert.equal(s.events.length,opsBefore,"recreated Auth record must not be disabled or removed");
 assert.equal(s.people.get("staff").disabled,false);
 assert.equal(s.people.has("staff"),true);
 assert.deepEqual(s.history(),history);
});
