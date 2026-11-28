import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const {makeWorkspaceIdentity}=createRequire(import.meta.url)(
 "../functions-partner-workspace/workspace-identity.cjs"
);
const CODE="A".repeat(43);
const COMPANY_CODE="NICO-"+"B".repeat(24);
const NOW=Date.parse("2026-11-19T09:00:00Z");
class AuthError extends Error {constructor(code,message){super(message);this.code=code;}}
class Ref {
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 collection(name){return new Ref(this.db,this.path+"/"+name);}
 async get(){
  this.db.reads.push(this.path);
  const obj=this.db.docs.get(this.path);
  return {exists:obj!==undefined,data:()=>obj};
 }
}
class MockFirestore {
 constructor(){
  this.docs=new Map();this.reads=[];this.writes=0;
 }
 collection(name){return new Ref(this,name);}
 seed(path,value){this.docs.set(path,value);}
 transaction(){
  return {get:ref=>ref.get(),set:()=>{this.writes++;throw Error("NO_WRITE");},
   update:()=>{this.writes++;throw Error("NO_WRITE");},
   create:()=>{this.writes++;throw Error("NO_WRITE");},
   delete:()=>{this.writes++;throw Error("NO_WRITE");}};
 }
 snapshot(){return JSON.stringify([...this.docs.entries()].sort(([a],[b])=>a.localeCompare(b)));}
}
function fixture(){
 const db=new MockFirestore();
 db.seed("partnerCodeSessions/"+createHash("sha256").update(CODE).digest("hex"),{
  active:true,principalUid:"codePrincipal",companyId:"partner",companyCode:COMPANY_CODE,
  version:1,expiresAt:{toMillis:()=>NOW+60_000}
 });
 db.seed("partnerCodeCredentials/partner",{
  active:true,companyId:"partner",principalUid:"codePrincipal",companyCode:COMPANY_CODE,version:1
 });
 db.seed("partnerCodeLogins/"+COMPANY_CODE,{
  status:"active",principalUid:"codePrincipal",partnerCompanyId:"partner",version:1
 });
 db.seed("users/codePrincipal",{
  uid:"codePrincipal",companyId:"partner",active:true,authKind:"partner_code_shared",
  accessKind:"partner",memberType:"cooperator",companyRole:"owner",
  canViewRevenue:false,canViewUnitPrice:false
 });
 db.seed("companies/partner",{
  name:"協力店",active:true,companyKind:"partner",hubCompanyId:"hub",
  companyCodePrincipalUid:"codePrincipal"
 });
 db.seed("companies/partner/members/codePrincipal",{
  uid:"codePrincipal",companyId:"partner",active:true,
  authKind:"partner_code_shared",accessKind:"partner",memberType:"cooperator",
  companyRole:"owner",canViewRevenue:false,canViewUnitPrice:false
 });
 db.seed("partnerRelations/partner",{
  active:true,countSharingApproved:true,hubCompanyId:"hub",partnerCompanyId:"partner"
 });
 // This legacy identity is intentionally disabled. It must not be reactivated,
 // reused as a ranking principal, or consulted to grant financial access.
 db.seed("users/disabledOld",{
  uid:"disabledOld",companyId:"hub",active:false,companyRole:"member"
 });
 db.seed("companies/hub/members/disabledOld",{
  uid:"disabledOld",companyId:"hub",active:false,accessKind:"internal"
 });
 db.seed("records/legacy", {amount:120000,uid:"disabledOld"});
 db.seed("products/private", {unitPrice:10000});
 let authCalls=0;
 const identity=makeWorkspaceIdentity({
  db,getAuth:()=>{authCalls++;throw Error("UNEXPECTED_FIREBASE_AUTH_ACCESS");},
  HttpsError:AuthError,enabled:()=>true,now:()=>NOW
 });
 return {db,identity,authCalls:()=>authCalls};
}
function protectedReads(db){
 return db.reads.filter(path=>/^(?:records|products|recordCorrections|revenueGoals)(?:\/|$)/.test(path));
}
test("valid isolated partner code can read count scope without reviving a disabled old identity",async()=>{
 const {db,identity,authCalls}=fixture(),before=db.snapshot();
 const scope=await identity.readCountViewer({token:CODE,tx:db.transaction()});
 assert.deepEqual(scope,{
  kind:"partner",uid:"codePrincipal",cid:"partner",hubId:"hub",
  companyName:"協力店",role:"owner",teamId:null
 });
 assert.equal(authCalls(),0,"company code must not require old Firebase email Auth");
 assert.equal(db.writes,0);
 assert.equal(db.snapshot(),before,"existing counts, financial records and identity untouched");
 assert.deepEqual(protectedReads(db),[]);
 assert(!db.reads.some(path=>path.includes("disabledOld")));
});
test("revoked, expired, replaced or invalid company-code proof fails closed",async()=>{
 const scenarios=[
  db=>{db.docs.get("partnerCodeSessions/"+createHash("sha256").update(CODE).digest("hex")).active=false;},
  db=>{db.docs.get("partnerCodeSessions/"+createHash("sha256").update(CODE).digest("hex")).expiresAt={toMillis:()=>NOW-1};},
  db=>{db.docs.get("partnerCodeCredentials/partner").version=2;},
  db=>{db.docs.get("partnerCodeLogins/"+COMPANY_CODE).status="revoked";},
  db=>{db.docs.get("partnerRelations/partner").countSharingApproved=false;},
  db=>{db.docs.get("companies/partner/members/codePrincipal").active=false;}
 ];
 for(const mutate of scenarios){
  const {db,identity,authCalls}=fixture();
  mutate(db);const before=db.snapshot();
  await assert.rejects(identity.readCountViewer({token:CODE,tx:db.transaction()}),
   /権限・入力内容を確認できません/);
  assert.equal(db.snapshot(),before);
  assert.equal(db.writes,0);
  assert.equal(authCalls(),0);
  assert.deepEqual(protectedReads(db),[]);
 }
});
test("a code principal cannot obtain financial grants or spoof an old hub workspace",async()=>{
 for(const path of ["users/codePrincipal","companies/partner/members/codePrincipal"]){
  const {db,identity}=fixture();
  db.docs.get(path).canViewRevenue=true;
  await assert.rejects(identity.readCountViewer({token:CODE,tx:db.transaction()}));
  assert.deepEqual(protectedReads(db),[]);
 }
 const {db,identity}=fixture();
 await assert.rejects(identity.readCountViewer({
  token:CODE,workspaceCompanyId:"hub",tx:db.transaction()
 }));
 assert.equal(db.writes,0);
});
test("disabled old email credentials are never silently converted into code sessions",async()=>{
 const {db,identity,authCalls}=fixture(),before=db.snapshot();
 await assert.rejects(identity.readCountViewer({
  token:"longInvalidEmailTokenHeader.longPayload.longSignature",
  tx:db.transaction()
 }));
 assert.equal(authCalls(),1,"email route must still require Firebase ID verification");
 assert.equal(db.snapshot(),before);
 assert.deepEqual(protectedReads(db),[]);
});
