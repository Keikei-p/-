"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {makeCompanyCodeAuth,CODE,newCode,passwordValid}=require("../functions-partner-workspace/company-code-auth.cjs");
const {makeWorkspace,KEYS}=require("../functions-partner-workspace/service.cjs");
const NOW=Date.parse("2026-11-01T09:00:00+09:00");
class Ref{
 constructor(db,p){this.db=db;this.path=p;this.id=p.split("/").at(-1)}
 collection(n){return new Coll(this.db,this.path+"/"+n)}
 async get(){const d=this.db.store.get(this.path);return {exists:d!==undefined,id:this.id,data:()=>d}}
 async create(d){if(this.db.store.has(this.path))throw Error("duplicate");this.db.store.set(this.path,d)}
}
class Coll{
 constructor(db,p){this.db=db;this.path=p}
 doc(n){return new Ref(this.db,this.path+"/"+(n||"auto"+(++this.db.serial)))}
 limit(n){return {get:async()=>({docs:[...this.db.store.entries()].filter(([p])=>p.startsWith(this.path+"/")&&!p.slice(this.path.length+1).includes("/")).slice(0,n).map(([p,v])=>({id:p.split("/").at(-1),data:()=>v})),size:0})}}
 where(k,op,v){return {limit:n=>({get:async()=>{const docs=[...this.db.store.entries()].filter(([p,d])=>p.startsWith(this.path+"/")&&!p.slice(this.path.length+1).includes("/")&&d[k]===v).slice(0,n).map(([p,d])=>({id:p.split("/").at(-1),data:()=>d}));return {size:docs.length,docs}}})}}
}
class DB{
 constructor(){this.store=new Map();this.serial=0}
 collection(n){return new Coll(this,n)}
 seed(p,d){this.store.set(p,d)}
 async runTransaction(cb){
  const changes=[];
  const tx={get:r=>r.get(),create:(r,d)=>changes.push(["create",r.path,d]),update:(r,d)=>changes.push(["update",r.path,d])};
  const result=await cb(tx);
  for(const [kind,p] of changes){
   if(kind==="create"&&this.store.has(p))throw Error("duplicate");
   if(kind==="update"&&!this.store.has(p))throw Error("missing");
  }
  for(const [kind,p,d] of changes)this.store.set(p,kind==="create"?d:{...this.store.get(p),...d});
  return result;
 }
}
class CallError extends Error{constructor(code,message){super(message);this.code=code}}
function fixture(){
 const db=new DB(),tokens=[];
 db.seed("companies/hub",{name:"自社",ownerUid:"h",active:true,companyKind:"internal"});
 db.seed("users/h",{uid:"h",companyId:"hub",active:true,companyRole:"owner",accessKind:"internal"});
 db.seed("companies/hub/members/h",{uid:"h",companyId:"hub",active:true,companyRole:"owner",accessKind:"internal"});
 db.seed("records/historical",{uid:"retired",companyId:"hub",totalRevenue:250000,unitPrice:12000});
 let principal="",companyId="",codeSessionToken="";
 const getAuth=()=>({
  getUser:async uid=>uid==="h"?{uid,disabled:false,emailVerified:true,email:"owner@example.com"}:
   {uid,disabled:false,emailVerified:false},
  verifyIdToken:async token=>token==="O".repeat(30)?
   {uid:"h",email_verified:true,email:"owner@example.com"}:
   {uid:principal,partnerCodeAuth:true,partnerCodeCompanyId:companyId,partnerCodeVersion:1},
  createCustomToken:async(uid,claims)=>{tokens.push({uid,claims});return "signed_custom_token_for_test"}
 });
 const FieldValue={serverTimestamp:()=>({seconds:NOW/1000}),delete:()=>({__deleteField:true})};
 const Timestamp={fromMillis:ms=>({toMillis:()=>ms})};
 const service=makeCompanyCodeAuth({db,getAuth,FieldValue,Timestamp,HttpsError:CallError,enabled:()=>true,now:()=>NOW});
 const workspace=makeWorkspace({db,getAuth,FieldValue,Timestamp,HttpsError:CallError,enabled:()=>true,now:()=>NOW});
 const hubReq=data=>({auth:{uid:"h",token:{email:"owner@example.com",email_verified:true}},
 rawRequest:{headers:{authorization:"Bearer "+"O".repeat(30)}},data});
 const codeReq=data=>({auth:null,rawRequest:{headers:{}},
  data:{...data,codeSessionToken}});
 return {db,service,workspace,tokens,hubReq,codeReq,setIdentity:(uid,cid)=>{principal=uid;companyId=cid},setSession:v=>{codeSessionToken=v}};
}
test("random unique server-generated company codes, strong minimum passwords",()=>{
 const a=newCode(),b=newCode();
 assert.match(a,CODE);assert.match(b,CODE);assert.notEqual(a,b);
 assert.equal(passwordValid("short"),false);
 assert.equal(passwordValid("LongPassword#2026"),true);
});
test("only verified internal owner can generate company code with name",async()=>{
 const {service,hubReq}=fixture();
 await assert.rejects(service.issue({data:{companyName:"協力会社"}}),e=>e.code==="unauthenticated");
 const invite=await service.issue(hubReq({companyName:"株式会社 協力会社"}));
 assert.match(invite.companyCode,CODE);
 assert.equal(invite.expiresAt,NOW+7*86400000);
});
test("company enters server-issued code, chooses password, can save counts without email",async()=>{
 const f=fixture(),before=f.db.store.get("records/historical");
 const invite=await f.service.issue(f.hubReq({companyName:"株式会社 協力会社"}));
 const activation=await f.service.activate({data:{
  companyCode:invite.companyCode,password:"LongSharedPassword#2026"
 }});
 assert.equal(activation.activated,true);
 const cid=activation.companyId,cred=f.db.store.get("partnerCodeCredentials/"+cid);
 f.setIdentity(cred.principalUid,cid);
 assert.equal(cred.companyCode,invite.companyCode);
 assert.equal(f.db.store.get("companies/"+cid).companyCodePrincipalUid,cred.principalUid);
 assert.deepEqual(f.db.store.get("records/historical"),before);
 assert(!JSON.stringify([...f.db.store]).includes("LongSharedPassword#2026"));
 await assert.rejects(f.service.activate({data:{companyCode:invite.companyCode,password:"AnotherVeryLongPassword2026"}}));
 await assert.rejects(f.service.login({data:{companyCode:invite.companyCode,password:"WrongPassword#2026"}}),e=>e.code==="permission-denied");
 assert.equal(f.tokens.length,0);
 const login=await f.service.login({data:{companyCode:invite.companyCode,password:"LongSharedPassword#2026"}});
 assert.match(login.sessionToken,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(f.tokens.length,0,"company-only login never creates Firebase Auth tokens");
 f.setSession(login.sessionToken);
 const team=(await f.workspace.manage(f.codeReq({action:"addTeam",name:"第1班"}))).teamId;
 const staffId=(await f.workspace.manage(f.codeReq({action:"addManaged",teamId:team,name:"協力店スタッフ"}))).staffId;
 const counts=Object.fromEntries(KEYS.map(x=>[x,0]));counts.NURO=3;
 const day="2026-11-01";
 const result=await f.workspace.submit(f.codeReq({date:day,staffId,counts,expectedVersion:0}));
 assert.equal(result.version,1);
 const view=await f.workspace.view(f.codeReq({date:day}));
 assert.equal(view.role,"owner");assert.equal(view.records[0].totalCount,3);
 const report=f.db.store.get("companies/hub/partnerWorkCountDays/"+day+"/reports/"+cid);
 assert.equal(report.totalCount,3);
 assert.deepEqual(f.db.store.get("records/historical"),before);
 assert.equal(JSON.stringify(view).includes("unitPrice"),false);
 await f.service.logout({data:{codeSessionToken:login.sessionToken}});
 await assert.rejects(f.workspace.view(f.codeReq({date:day})),e=>e.code==="unauthenticated");
 assert.deepEqual(f.db.store.get("records/historical"),before);
});

test("previously registered partner keeps owner, members and historic count entries",async()=>{
 const f=fixture(),cid="existingPartner",oldOwner="previousOwner";
 f.db.seed("companies/"+cid,{name:"既存協力店",ownerUid:oldOwner,masterUid:oldOwner,
  companyKind:"partner",hubCompanyId:"hub",active:true});
 f.db.seed("partnerRelations/"+cid,{partnerCompanyId:cid,hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 f.db.seed("companies/"+cid+"/members/"+oldOwner,{uid:oldOwner,companyId:cid,
  role:"leader",companyRole:"owner",active:true,canViewRevenue:false,canViewUnitPrice:false});
 f.db.seed("companies/"+cid+"/partnerWorkEntries/2026-10-31__staff",
  {companyId:cid,hubCompanyId:"hub",date:"2026-10-31",staffId:"staff",
   totalCount:4,counts:Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?4:0])),
   version:1,teamIdSnapshot:"oldTeam"});
 const oldCompany={...f.db.store.get("companies/"+cid)};
 const oldRecords={...f.db.store.get("companies/"+cid+"/partnerWorkEntries/2026-10-31__staff")};
 const invite=await f.service.issue(f.hubReq({partnerCompanyId:cid}));
 const result=await f.service.activate({data:{
  companyCode:invite.companyCode,password:"PartnerExistingPassword#2026"
 }});
 assert.equal(result.companyId,cid);
 assert.equal(f.db.store.get("companies/"+cid).ownerUid,oldOwner);
 assert.equal(f.db.store.get("companies/"+cid).masterUid,oldOwner);
 assert.equal(f.db.store.get("companies/"+cid).companyCodePrincipalUid!=null,true);
 assert.equal(f.db.store.get("companies/"+cid).name,oldCompany.name);
 assert.deepEqual(f.db.store.get("companies/"+cid+"/partnerWorkEntries/2026-10-31__staff"),oldRecords);
 assert(f.db.store.has("companies/"+cid+"/members/"+oldOwner));
 await assert.rejects(f.service.issue(f.hubReq({partnerCompanyId:"notFound"})));
});
