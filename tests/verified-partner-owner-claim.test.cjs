"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {createPartnerOwnerClaimCallables}
 =require("../functions-partner-owner-claim/partner-owner-claim.cjs");
const hub="nicoHub",partner="partner1",owner="nicoOwner",receiver="realPartnerOwner";
const ownerEmail="hub@example.test",partnerEmail="partner@example.test";
class HttpsError extends Error{
 constructor(code,message){super(message);this.code=code;}
}
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Col(this.db,this.path+"/"+name);}
}
class Col{
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+(id||"audit"+(++this.db.index)));}
}
const T=ms=>({toMillis(){return ms;},value:ms});
function fixtures({enabled=true}={}){
 const store=new Map(),log=[],ids=new Map([[owner,ownerEmail],[receiver,partnerEmail]]),
  clock={now:1700000000000};
 const db={index:0,collection(name){
  if(["records","products","recordCorrections","revenueGoals",
      "partnerWorkEntries","partnerCodeCredentials"].includes(name))
   throw Error("FINANCE_OR_OLD_CODE_READ_FORBIDDEN");
  return new Col(db,name);
 },async runTransaction(fn,options){
  const writes=[],tx={
   async get(ref){
    if(!(ref instanceof Ref))throw Error("Unexpected transaction query");
    log.push({op:"read",path:ref.path});
    const x=store.get(ref.path);
    return {exists:x!==undefined,id:ref.id,data:()=>x};
   },
   create(ref,doc){writes.push({op:"create",path:ref.path,doc});},
   update(ref,doc){writes.push({op:"update",path:ref.path,doc});}
  };
  const out=await fn(tx);
  if(options?.readOnly===true&&writes.length)
   throw Error("Read only transaction wrote");
  for(const w of writes){
   if(w.op==="create"&&store.has(w.path))throw Error("already exists");
   if(w.op==="update"&&!store.has(w.path))throw Error("not found");
  }
  for(const w of writes){
   store.set(w.path,w.op==="create"?w.doc:{...store.get(w.path),...w.doc});
   log.push({op:w.op,path:w.path});
  }
  return out;
 }};
 const initial=[
  ["companies/"+hub,{name:"自社",companyKind:"internal",ownerUid:owner,active:true}],
  ["users/"+owner,{uid:owner,companyId:hub,companyRole:"owner",active:true,
   email:ownerEmail,accessKind:"internal",memberType:"direct"}],
  ["companies/"+hub+"/members/"+owner,{uid:owner,companyId:hub,
   companyRole:"owner",active:true,accessKind:"internal"}],
  ["companies/"+partner,{name:"協力店A",companyKind:"partner",hubCompanyId:hub,
   active:true,companyCodePrincipalUid:"pc_secret",masterUid:"pc_secret",
   createdByUid:owner}],
  ["partnerRelations/"+partner,{partnerCompanyId:partner,hubCompanyId:hub,
   active:true,countSharingApproved:true}],
  ["users/pc_secret",{uid:"pc_secret",companyId:partner,
   authKind:"partner_code_shared",canViewRevenue:false,canViewUnitPrice:false}],
  ["companies/"+partner+"/members/pc_secret",{
   uid:"pc_secret",companyId:partner,authKind:"partner_code_shared",
   canViewRevenue:false,canViewUnitPrice:false}],
  ["companies/"+partner+"/partnerWorkEntries/2026-11-10__staff",{totalCount:4}],
  ["records/original",{totalRevenue:130000,unitPrice:50000}],
  ["products/original",{revenue:50000,cashbackOptions:[1000,2500]}],
  ["recordCorrections/original",{beforeRevenue:100000}]
 ];
 for(const [path,value]of initial)store.set(path,value);
 const original=Object.fromEntries(initial.map(([p,v])=>[p,JSON.stringify(v)]));
 const authService={getUser:async uid=>{
  const email=ids.get(uid);
  if(!email)throw Error("unknown");
  return {uid,email,disabled:false,emailVerified:true};
 }};
 const counts={trusted:0,auth:0};
 const factory=createPartnerOwnerClaimCallables({
  db,FieldValue:{serverTimestamp:()=>({epoch:clock.now})},
  Timestamp:{fromMillis:T},getAuth:()=>{counts.auth++;return authService;},
  HttpsError,enabled:()=>enabled,now:()=>clock.now,
  randomBytes:()=>Buffer.alloc(32,6),
  trustedModule:async()=>{
   counts.trusted++;
   return {createVerifiedRankTokenReader:()=>async token=>{
    const uid=token===("H".repeat(40))?owner:
     token===("P".repeat(40))?receiver:null;
    if(!uid)throw Error("Auth revoked");
    return {uid,email:ids.get(uid),emailVerified:true};
   }};
  }
 });
 const req=(uid,data={})=>({
  data,auth:{uid,token:{email:ids.get(uid),email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+(uid===owner?
   "H".repeat(40):"P".repeat(40))}}
 });
 const send=()=>factory.issue(req(owner,{partnerCompanyId:partner,email:partnerEmail}));
 const writes=()=>log.filter(x=>x.op!=="read");
 const unchanged=(allowOwnerClaim=false)=>Object.entries(original).every(([p,v])=>{
  if(allowOwnerClaim&&p==="companies/"+partner){
   const updated={...store.get(p)};
   delete updated.ownerUid;
   delete updated.ownerClaimedAt;
   return JSON.stringify(updated)===v;
  }
  return JSON.stringify(store.get(p))===v;
 });
 return {factory,store,req,send,writes,unchanged,clock,counts,ids,
  async invite(){
   const r=await send();
   return r.token;
  },preview:token=>factory.preview(req(receiver,{token})),
  accept:token=>factory.accept(req(receiver,{token,displayName:"協力店オーナー",confirm:true}))
 };
}
const denied=async(fn,code)=>assert.rejects(fn,(err)=>{
 assert.equal(err.code,code);
 assert(!/email|password|token|revenue|unitPrice|records|cashback|uid/.test(err.message));
 return true;
});
test("flag OFF returns immediately without Auth, Firestore writes, random token or imports",async()=>{
 const x=fixtures({enabled:false});
 await denied(x.send(),"failed-precondition");
 await denied(x.preview("X".repeat(43)),"failed-precondition");
 await denied(x.accept("X".repeat(43)),"failed-precondition");
 assert.equal(x.counts.trusted,0);
 assert.equal(x.counts.auth,0);
 assert.equal(x.writes().length,0);
 assert(x.unchanged());
});
test("hub Owner can invite a verified separate email; no automatic identity assignment",async()=>{
 const x=fixtures(),r=await x.send();
 assert.equal(r.issued,true);
 assert.equal(r.partnerCompanyId,partner);
 assert.equal(r.expiresAt,x.clock.now+30*60*1000);
 assert.equal(x.store.get("companies/"+partner).ownerUid,undefined);
 assert.equal(x.store.get("users/"+receiver),undefined);
 assert.equal(x.writes().filter(w=>w.path.startsWith("companies/"+partner+"/partnerWorkEntries")).length,0);
 assert.equal(x.writes().filter(w=>w.path.startsWith("records/")).length,0);
 assert(x.unchanged());
});
test("verified invited Owner sees finance-free preview and confirms; source history and company-code retained",async()=>{
 const x=fixtures(),token=await x.invite();
 const preview=await x.preview(token);
 assert.deepEqual(preview,{
  schema:"nico-partner-owner-claim-preview-v1",
  companyName:"協力店A",expiresAt:x.clock.now+30*60*1000,
  needsConsent:true,futureFinancialRoleFlagsFalse:true
 });
 const r=await x.accept(token);
 assert.deepEqual(r,{claimed:true,partnerCompanyId:partner,
  companyRole:"owner",financialRoleFlagsFalse:true});
 const c=x.store.get("companies/"+partner);
 assert.equal(c.ownerUid,receiver);
 assert.equal(c.companyCodePrincipalUid,"pc_secret");
 assert.equal(c.masterUid,"pc_secret");
 const u=x.store.get("users/"+receiver);
 const m=x.store.get("companies/"+partner+"/members/"+receiver);
 assert.equal(u.uid,receiver);assert.equal(u.email,partnerEmail);
 assert.equal(u.companyId,partner);assert.equal(u.companyRole,"owner");
 assert.equal(u.authKind,"verified_partner_owner");
 for(const p of [u,m]){
  assert.equal(p.canViewRevenue,false);
  assert.equal(p.canViewUnitPrice,false);
  assert.equal(p.accessKind,"partner");
  assert.equal(p.memberType,"cooperator");
 }
 assert(x.unchanged(true),"only partner ownerUid/claimTimestamp added; old company code, count, finance, membership unchanged");
 assert(x.writes().every(w=>!["records","products","recordCorrections",
  "partnerWorkEntries"].some(s=>w.path.includes(s))));
 assert(!x.writes().some(w=>w.path==="users/pc_secret"));
 await denied(x.accept(token),"permission-denied");
});
test("third-party email, forged identity, bad scope and missing verified email cannot invite or claim",async()=>{
 const x=fixtures(),token=await x.invite();
 await denied(x.factory.preview(x.req(owner,{token})),"permission-denied");
 await denied(x.factory.accept(x.req(owner,{
  token,displayName:"悪用",confirm:true
 })),"permission-denied");
 await denied(x.factory.issue(x.req(receiver,{
  partnerCompanyId:partner,email:partnerEmail
 })),"permission-denied");
 await denied(x.factory.issue(x.req(owner,{
  partnerCompanyId:partner,email:ownerEmail
 })),"invalid-argument");
 await denied(x.factory.issue(x.req(owner,{
  partnerCompanyId:partner,email:partnerEmail,role:"owner"
 })),"invalid-argument");
 await denied(x.factory.accept(x.req(receiver,{
  token,displayName:"本人",confirm:false
 })),"invalid-argument");
 await denied(x.factory.accept({...x.req(receiver,{token,displayName:"本人",confirm:true}),
  auth:{uid:receiver,token:{email:partnerEmail,email_verified:false}}
 }),"unauthenticated");
 await denied(x.factory.preview({...x.req(receiver,{token}),
  rawRequest:{headers:{authorization:"Bearer forged"}}}),"unauthenticated");
 assert.equal(x.store.get("companies/"+partner).ownerUid,undefined);
});
test("only one pending registration, expired invite can be replaced and old token revoked",async()=>{
 const x=fixtures(),old=await x.invite();
 await denied(x.send(),"permission-denied");
 x.clock.now+=31*60*1000;
 await denied(x.preview(old),"permission-denied");
 // Deterministic test generator would repeat the old token, therefore inject
 // new service with distinct randomness in real deployment. Assert no write.
 assert.equal(x.store.get("companies/"+partner).ownerUid,undefined);
 assert(x.unchanged());
});
test("registered old user or secondary membership never overwritten or auto-migrated",async()=>{
 for(const path of ["users/"+receiver,
  "companies/"+partner+"/members/"+receiver,
  "partnerWorkspaceContexts/"+receiver]){
  const x=fixtures(),token=await x.invite();
  x.store.set(path,{uid:receiver,companyId:hub,
   active:true,canViewRevenue:true,oldHistory:"must-preserve"});
  await denied(x.accept(token),"permission-denied");
  assert.equal(x.store.get(path).oldHistory,"must-preserve");
  assert.equal(x.store.get("companies/"+partner).ownerUid,undefined);
  assert(x.unchanged());
 }
});
test("Hub Owner revoked, disabled or replaced blocks acceptance of old issue",async()=>{
 for(const bad of ["disabled","member","owner-replaced","active-secondary"]){
  const x=fixtures(),token=await x.invite();
  if(bad==="disabled")x.ids.delete(owner);
  if(bad==="member")x.store.get("users/"+owner).companyRole="member";
  if(bad==="owner-replaced")x.store.get("companies/"+hub).ownerUid="hijacked";
  if(bad==="active-secondary")x.store.set("partnerWorkspaceContexts/"+owner,
   {active:true,kind:"partner_secondary"});
  await denied(x.accept(token),"permission-denied");
  assert.equal(x.store.get("companies/"+partner).ownerUid,undefined);
  assert.equal(x.store.get("users/"+receiver),undefined);
 }
});
test("company claim or relation revoked before acceptance fails without writing old counts",async()=>{
 for(const mutation of [
  x=>x.store.get("companies/"+partner).ownerUid="alreadyOwned",
  x=>x.store.get("companies/"+partner).active=false,
  x=>x.store.get("partnerRelations/"+partner).countSharingApproved=false,
  x=>x.store.get("partnerRelations/"+partner).hubCompanyId="otherHub"
 ]){
  const x=fixtures(),token=await x.invite(),pre=x.writes().length;
  mutation(x);
  await denied(x.accept(token),"permission-denied");
  assert.equal(x.writes().length,pre);
 }
});
test("all live finance-related originals remain untouched and isolated codebase has three onCall exports",()=>{
 const idx=readFileSync(require("node:path").join(__dirname,
  "../functions-partner-owner-claim/index.js"),"utf8");
 const cfg=JSON.parse(readFileSync(require("node:path").join(__dirname,
  "../firebase.partner-owner-claim.json"),"utf8"));
 assert.equal(cfg.functions.source,"functions-partner-owner-claim");
 assert.equal(cfg.functions.codebase,"partner-owner-claim");
 assert.equal((idx.match(/exports\.(?:issue|preview|accept)PartnerOwnerClaimInvite=onCall/g)||[]).length,3);
 assert.match(idx,/NICO_PARTNER_OWNER_CLAIM_ENABLED==="enabled"/);
 assert.doesNotMatch(idx,/getVerifiedJointCountRanking|setOwnerProductVisibility|submitPartnerWorkspaceCounts/);
});
