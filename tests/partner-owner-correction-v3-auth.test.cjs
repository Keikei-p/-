"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
 makeTrustedHubOwnerVerifier,makeAuthenticatedOwnerCorrectionV3
}=require("../staging/partner-owner-correction-v3/trusted-auth.cjs");

const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
class Ref{
 constructor(db,id){this.db=db;this.path=id;this.id=id.split("/").at(-1);}
 collection(name){return new Coll(this.db,this.path+"/"+name);}
 async get(){
  const v=this.db.store.get(this.path);
  return {exists:v!==undefined,id:this.id,data:()=>clone(v)};
 }
}
class Coll{
 constructor(db,p){this.db=db;this.path=p;}
 doc(name){assert.ok(name);return new Ref(this.db,this.path+"/"+name);}
 where(field,op,value){assert.equal(op,"==");return new Query(this.db,this.path,field,value);}
}
class Query{
 constructor(db,p,field,value){Object.assign(this,{db,p,field,value});}
 limit(n){this.cap=n;return this;}
 async get(){
  const docs=[...this.db.store].filter(([p,v])=>
   p.startsWith(this.p+"/")&&!p.slice(this.p.length+1).includes("/")&&
   v[this.field]===this.value).slice(0,this.cap).map(([p,v])=>({
    id:p.split("/").at(-1),data:()=>clone(v)
   }));
  return {size:docs.length,docs};
 }
}
class DB{
 constructor(){this.store=new Map();this.writes=[];this.txReads=[];}
 collection(name){return new Coll(this,name);}
 seed(p,v){this.store.set(p,clone(v));}
 async runTransaction(fn){
  const staged=[];
  const tx={
   get:async r=>{this.txReads.push(r.path);return r.get();},
   update:(r,v)=>staged.push(["update",r.path,clone(v)]),
   create:(r,v)=>staged.push(["create",r.path,clone(v)])
  };
  const result=await fn(tx);
  for(const [op,p] of staged){
   if(op==="update"&&!this.store.has(p))throw Error("MISSING_DOC");
   if(op==="create"&&this.store.has(p))throw Error("AUDIT_ALREADY_EXISTS");
  }
  for(const [op,p,v] of staged){
   const old=this.store.get(p);
   this.store.set(p,op==="create"?v:{...old,...v});
   this.writes.push({op,path:p});
  }
  return result;
 }
}
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code;}
}
const day="2026-10-31",token="a".repeat(40);
const counts=()=>({
 NURO:1,SBMNP:0,YMMNP:0,"YM純新規":0,"SB光・AIR":5,
 "ウォーター":0,"つばさ・HTB":0,"太陽光・蓄電池AP":0,"U-NEXT":0
});
function fixture(){
 const db=new DB(),authFlags={revoked:false,disabled:false,emailVerified:true},
 calls=[];
 db.seed("users/owner",{
  uid:"owner",companyId:"hub",active:true,companyRole:"owner",
  accessKind:"internal",memberType:"internal"
 });
 db.seed("companies/hub",{
  active:true,ownerUid:"owner",companyKind:"internal",name:"NICO"
 });
 db.seed("companies/hub/members/owner",{
  uid:"owner",companyId:"hub",active:true,companyRole:"owner",
  accessKind:"internal",memberType:"internal"
 });
 db.seed("companies/partner",{
  active:true,name:"協力店 A",companyKind:"partner",hubCompanyId:"hub"
 });
 db.seed("partnerRelations/partner",{
  active:true,hubCompanyId:"hub",partnerCompanyId:"partner",countSharingApproved:true
 });
 db.seed("companies/partner/partnerWorkEntries/"+day+"__s1",{
  date:day,staffId:"s1",staffNameSnapshot:"担当者A",
  teamIdSnapshot:"t1",companyId:"partner",hubCompanyId:"hub",
  version:1,counts:counts(),totalCount:6,privateCounts:{secret:3},
  privateTotalCount:3
 });
 db.seed("companies/hub/partnerWorkCountDays/"+day+"/reports/partner",{
  source:"staff-entries-v1",date:day,hubCompanyId:"hub",
  partnerCompanyId:"partner",counts:counts(),totalCount:6
 });
 db.seed("products/secret",{companyId:"hub",unitPrice:10000});
 db.seed("records/secret",{companyId:"hub",totalRevenue:100000});
 const auth={
  verifyIdToken:async(t,check)=>{
   calls.push(["verify",t,check]);
   if(t!==token||check!==true||authFlags.revoked)throw Error("revoked or forged");
   return {uid:"owner",email:"owner@example.com",email_verified:true};
  },
  getUser:async(uid)=>{
   calls.push(["getUser",uid]);
   if(uid!=="owner")throw Error("unknown");
   return {uid,email:"owner@example.com",emailVerified:authFlags.emailVerified,
    disabled:authFlags.disabled};
  }
 };
 const enabled=()=>true;
 const args={db,getAuth:()=>auth,FieldValue:{serverTimestamp:()=>({server:true})},
  HttpsError,enabled,now:()=>Date.parse("2026-11-07T07:00:00+09:00")};
 const request=(data={date:day,partnerCompanyId:"partner"})=>({
  auth:{uid:"owner",token:{email:"owner@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+token}},
  data
 });
 return {db,authFlags,calls,args,request};
}
test("server-verified hub owner succeeds: token revocation checked and live 3-doc scope read",async()=>{
 const f=fixture();
 const verify=makeTrustedHubOwnerVerifier(f.args);
 assert.deepEqual(await verify(f.request()),{
  kind:"hub",role:"owner",uid:"owner",hubId:"hub"
 });
 assert.ok(f.calls.some(c=>c[0]==="verify"&&c[2]===true));
 assert.equal(f.db.writes.length,0);
 const read=[];
 const tx={get:async r=>{read.push(r.path);return r.get();}};
 assert.equal((await verify(f.request(),tx)).hubId,"hub");
 assert.deepEqual(read.sort(),[
  "users/owner","companies/hub","companies/hub/members/owner"].sort());
});
test("staged authenticated adapter lists counts only and corrects a known row",async()=>{
 const f=fixture(),service=makeAuthenticatedOwnerCorrectionV3(f.args);
 const beforeFinance=clone([...f.db.store].filter(([k])=>/^(records|products)\//.test(k)));
 const view=await service.list(f.request());
 assert.equal(view.role,"hub");
 assert.equal(view.entries.length,1);
 assert.equal(view.entries[0].totalCount,6);
 assert.deepEqual(view.entries[0].sbBreakdown,{
  "SB光":0,"SB AIR":0,"旧未分類":5
 });
 assert.equal(f.db.writes.length,0);
 assert.doesNotMatch(JSON.stringify(view),/unitPrice|revenue|privateCounts|secret/i);
 const updated={...counts(),NURO:2};
 const saved=await service.correct(f.request({
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:1,
  counts:updated,sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":1},
  correctionReason:"営業担当者の報告を確認済み"
 }));
 assert.equal(saved.version,2);
 assert.equal(saved.totalCount,7);
 assert.equal(f.db.writes.length,3);
 assert.deepEqual(f.db.writes.map(x=>x.op),["update","update","create"]);
 assert.deepEqual(f.db.writes.map(x=>x.path),[
  "companies/partner/partnerWorkEntries/"+day+"__s1",
  "companies/hub/partnerWorkCountDays/"+day+"/reports/partner",
  "companies/partner/partnerWorkAudits/"+day+"__s1__v2"
 ]);
 assert.equal(f.db.store.get("companies/partner/partnerWorkEntries/"+day+"__s1").privateCounts.secret,3);
 assert.deepEqual(clone([...f.db.store].filter(([k])=>/^(records|products)\//.test(k))),beforeFinance);
 assert.equal((await service.list(f.request())).entries[0].version,2);
});
test("forged bearer, mismatched email, code auth and partner context never read or write",async()=>{
 const f=fixture(),verify=makeTrustedHubOwnerVerifier(f.args);
 const base=f.request(),bad=[
  {...base,auth:{...base.auth,uid:"partner"}},
  {...base,auth:{...base.auth,token:{email:"fake@example.com",email_verified:true}}},
  {...base,auth:{...base.auth,token:{email:"owner@example.com",email_verified:false}}},
  {...base,auth:{...base.auth,token:{email:"owner@example.com",email_verified:"true"}}},
  {...base,rawRequest:{headers:{authorization:"Bearer "+"b".repeat(40)}}},
  {...base,rawRequest:{headers:{}}},
  {...base,rawRequest:{headers:{authorization:"Basic "+token}}},
  {...base,data:{...base.data,codeSessionToken:"forged"}},
  {...base,data:{...base.data,workspaceCompanyId:"partner"}},
  {data:base.data,uid:"owner"}
 ];
 for(const req of bad)await assert.rejects(verify(req),HttpsError);
 assert.equal(f.db.writes.length,0);
});
test("disabled, revoked or stale principal never authorizes, even if request claims owner",async()=>{
 const f=fixture(),verify=makeTrustedHubOwnerVerifier(f.args);
 for(const changes of [
  ()=>{f.authFlags.revoked=true;},
  ()=>{f.authFlags.revoked=false;f.authFlags.disabled=true;},
  ()=>{f.authFlags.disabled=false;f.authFlags.emailVerified=false;}
 ]){
  changes();
  await assert.rejects(verify(f.request()),HttpsError);
 }
 assert.equal(f.db.writes.length,0);
 const denied=makeTrustedHubOwnerVerifier({...f.args,enabled:()=>false});
 await assert.rejects(denied(f.request()),e=>e.code==="unavailable");
});
test("server-side membership checks deny partner, leader, revoked or cross-company owner",async()=>{
 const original=fixture();
 const mutations=[
  db=>{db.store.get("users/owner").companyId="partner";},
  db=>{db.store.get("users/owner").active=false;},
  db=>{db.store.get("users/owner").authKind="partner_code_shared";},
  db=>{db.store.get("users/owner").accessKind="partner";},
  db=>{db.store.get("users/owner").companyRole="leader";},
  db=>{db.store.get("companies/hub").active=false;},
  db=>{db.store.get("companies/hub").companyKind="partner";},
  db=>{db.store.get("companies/hub").ownerUid="another";},
  db=>{db.store.get("companies/hub/members/owner").active=false;},
  db=>{db.store.get("companies/hub/members/owner").companyRole="member";},
  db=>{db.store.get("companies/hub/members/owner").companyId="other";},
  db=>{db.store.get("companies/hub/members/owner").accessKind="partner";},
  db=>{db.store.delete("users/owner");},
  db=>{db.store.delete("companies/hub/members/owner");}
 ];
 for(const mutate of mutations){
  const f=fixture(),verify=makeTrustedHubOwnerVerifier(f.args);
  mutate(f.db);
  const saved=clone([...f.db.store]);
  await assert.rejects(verify(f.request()),HttpsError);
  assert.equal(f.db.writes.length,0);
  assert.deepEqual(clone([...f.db.store]),saved);
 }
 assert.equal(original.db.writes.length,0);
});
test("recheck inside transaction blocks owner revocation after initial verification",async()=>{
 const f=fixture();
 // First verification passes and initial business checks pass.
 const verify=makeTrustedHubOwnerVerifier(f.args);
 assert.equal((await verify(f.request())).role,"owner");
 // Permission is removed before transactional revalidation.
 f.db.store.get("companies/hub/members/owner").active=false;
 const service=makeAuthenticatedOwnerCorrectionV3(f.args);
 const saved=clone([...f.db.store]);
 await assert.rejects(service.correct(f.request({
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:1,
  counts:{...counts(),NURO:2},correctionReason:"担当者の数を訂正する"
 })),HttpsError);
 assert.deepEqual(clone([...f.db.store]),saved);
 assert.equal(f.db.writes.length,0);
});
test("adapter is default-disabled, and staging only: no original workspace export or production writes",async()=>{
 const f=fixture();
 const verify=makeTrustedHubOwnerVerifier({...f.args,enabled:undefined});
 // undefined explicitly inherits the disabled default
 await assert.rejects(verify(f.request()),e=>e.code==="unavailable");
 const source=fs.readFileSync(path.join(__dirname,
  "../staging/partner-owner-correction-v3/trusted-auth.cjs"),"utf8");
 assert.match(source,/STAGING ONLY \/ NO DEPLOY/);
 assert.match(source,/verifyIdToken\(bearer,true\)/);
 assert.match(source,/getUser\(uid\)/);
 assert.match(source,/tx\?tx\.get\(ref\):ref\.get\(\)/);
 assert.doesNotMatch(source,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|getFirestore\(/);
 assert.doesNotMatch(source,/console\.|logger\.|Bearer \+token/);
 assert.equal(f.db.writes.length,0);
});
