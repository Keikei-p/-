"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {requireFactory}=require("../functions/partner-company-invitations.cjs");

const NOW=Date.parse("2026-10-30T12:00:00Z");
const clone=value=>Array.isArray(value)?value.map(clone):
 value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)])):value;
class Ref {
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Collection(this.db,this.path+"/"+name);}
 async get(){const v=this.db.data.get(this.path);return {exists:v!==undefined,data:()=>clone(v),ref:this};}
}
class Collection {
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+(id||"generated"+(++this.db.serial)));}
 where(key,operator,value){
  assert.equal(operator,"==");
  return {limit:max=>({get:async()=>{
   const docs=[];
   for(const [path,data] of this.db.data){
    if(path.startsWith(this.path+"/")&&path.slice(this.path.length+1).indexOf("/")<0&&data[key]===value)
     docs.push({ref:new Ref(this.db,path),data:()=>clone(data)});
   }
   return {size:docs.slice(0,max).length,docs:docs.slice(0,max)};
  }})};
 }
}
class MemoryDB {
 constructor(){this.data=new Map();this.serial=0;}
 collection(name){return new Collection(this,name);}
 seed(path,data){this.data.set(path,clone(data));}
 async runTransaction(fn){
  const writes=[],tx={
   get:ref=>ref.get(),
   create:(ref,value)=>writes.push({kind:"create",ref,value}),
   set:(ref,value,opts)=>writes.push({kind:"set",ref,value,opts}),
   update:(ref,value)=>writes.push({kind:"update",ref,value})
  };
  const result=await fn(tx);
  for(const write of writes)if(write.kind==="create"&&this.data.has(write.ref.path))
   throw Error("must not overwrite existing record");
  for(const {kind,ref,value} of writes){
   const prev=this.data.get(ref.path)||{};
   this.data.set(ref.path,kind==="create"?clone(value):{...prev,...clone(value)});
  }
  return result;
 }
}
class CallError extends Error{constructor(code,message){super(message);this.code=code;}}
function setup({enabled=true,disabled=false,ownerRole="owner",recipientCompany=null,hubKind="internal"}={}){
 const db=new MemoryDB();
 db.seed("companies/hub",{name:"株式会社Nico Factory",ownerUid:"owner",active:true,companyKind:hubKind});
 db.seed("users/owner",{uid:"owner",email:"owner@example.com",companyId:"hub",companyRole:ownerRole,active:true,accessKind:"internal"});
 db.seed("companies/hub/members/owner",{uid:"owner",companyId:"hub",companyRole:ownerRole,role:"leader",active:true,accessKind:"internal"});
 db.seed("users/recipient",{uid:"recipient",email:"partner@example.com",name:"テスト",active:true,...(recipientCompany?{companyId:recipientCompany}:{})});
 const map={owner:{email:"owner@example.com",disabled:false},recipient:{email:"partner@example.com",disabled}};
 const jwtMap=new Map([["o".repeat(30),"owner"],["r".repeat(30),"recipient"]]);
 const auth={
  getUser:async uid=>({...map[uid],uid,emailVerified:true}),
  verifyIdToken:async token=>{
   const uid=jwtMap.get(token);
   if(!uid)throw Error("invalid token");
   return {uid,email:map[uid].email,email_verified:true};
  }
 };
 const handlers=requireFactory({
  db,getAuth:()=>auth,Timestamp:{fromMillis:ms=>({toMillis:()=>ms})},
  FieldValue:{serverTimestamp:()=>({seconds:NOW/1000})},
  HttpsError:CallError,enabled:()=>enabled,now:()=>NOW
 });
 const request=(uid,data={})=>({
  auth:{uid,token:{email:map[uid].email,email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+(uid==="owner"?"o":"r").repeat(30)}},
  data
 });
 return {db,handlers,request};
}
const createInput={email:"partner@example.com",companyName:"連携店A"};
test("disabled gate rejects before reading or writing a document",async()=>{
 const {db,handlers,request}=setup({enabled:false});
 const before=JSON.stringify([...db.data]);
 await assert.rejects(handlers.create(request("owner",createInput)),x=>x.code==="unavailable");
 assert.equal(JSON.stringify([...db.data]),before);
});
test("owner invites one verified recipient into isolated partner company without touching source data",async()=>{
 const {db,handlers,request}=setup();
 const originals=new Map(db.data);
 const invitation=await handlers.create(request("owner",createInput));
 assert.equal(invitation.kind,"partner_company");
 assert.equal(invitation.token.length,43);
 assert.equal(invitation.expiresAt,NOW+1800000);
 const doc=[...db.data].find(([k])=>k.startsWith("partnerCompanyInvitations/"))[1];
 assert.equal(doc.token,undefined);
 assert.equal(doc.status,"pending");
 assert.equal(doc.canViewRevenue,false);
 assert.equal(doc.canViewUnitPrice,false);
 const details=await handlers.preview(request("recipient",{token:invitation.token}));
 assert.equal(details.partnerCompanyName,"連携店A");
 const accepted=await handlers.accept(request("recipient",{token:invitation.token}));
 assert.notEqual(accepted.partnerCompanyId,"hub");
 assert.equal(accepted.countReportingEnabled,false);
 assert.equal(accepted.financialAccess,false);
 const partner=db.data.get("companies/"+accepted.partnerCompanyId);
 assert.equal(partner.companyKind,"partner");
 assert.equal(partner.hubCompanyId,"hub");
 const member=db.data.get("companies/"+accepted.partnerCompanyId+"/members/recipient");
 assert.equal(member.companyId,accepted.partnerCompanyId);
 assert.equal(member.accessKind,"partner");
 assert.equal(member.canViewRevenue,false);
 assert.equal(member.canViewUnitPrice,false);
 assert.equal(member.canCreateInvite,false);
 const relation=db.data.get("partnerRelations/"+accepted.partnerCompanyId);
 assert.equal(relation.countSharingApproved,false);
 assert.equal(relation.active,false);
 assert.equal(db.data.get("users/recipient").companyId,accepted.partnerCompanyId);
 assert.equal(db.data.get("users/recipient").name,"テスト");
 assert.equal(doc.kind,"partner_company");
 for(const [path,old] of originals){
  if(path==="users/recipient")continue;
  assert.deepEqual(db.data.get(path),old,"original document must remain unchanged: "+path);
 }
 await assert.rejects(handlers.accept(request("recipient",{token:invitation.token})));
});
test("leader or partner company cannot create partner invitations",async()=>{
 for(const options of [{ownerRole:"member"},{hubKind:"partner"}]){
  const {db,handlers,request}=setup(options);
  const before=JSON.stringify([...db.data]);
  await assert.rejects(handlers.create(request("owner",createInput)));
  assert.equal(JSON.stringify([...db.data]),before);
 }
});
test("wrong recipient and existing company cannot accept or preview",async()=>{
 const {db,handlers,request}=setup({recipientCompany:"existing"});
 const {token}=await handlers.create(request("owner",createInput));
 await assert.rejects(handlers.preview(request("owner",{token})));
 const before=JSON.stringify([...db.data]);
 await assert.rejects(handlers.accept(request("recipient",{token})));
 assert.equal(JSON.stringify([...db.data]),before);
});
test("disabled recipient, malformed tokens and unknown bearer never grant access",async()=>{
 const fixture=setup({disabled:true});
 const {db,handlers,request}=fixture;
 const {token}=await handlers.create(request("owner",createInput));
 await assert.rejects(handlers.accept(request("recipient",{token})),x=>x.code==="unauthenticated");
 await assert.rejects(handlers.preview(request("recipient",{token:"INVALID"})));
 const req=request("owner",createInput);req.rawRequest.headers.authorization="Bearer BAD";
 const before=JSON.stringify([...db.data]);
 await assert.rejects(handlers.create(req),x=>x.code==="unauthenticated");
 assert.equal(JSON.stringify([...db.data]),before);
});
test("source must not delete, migrate, recalculate, or access financial original collections",()=>{
 const src=require("node:fs").readFileSync(require.resolve("../functions/partner-company-invitations.cjs"),"utf8");
 for(const forbidden of [/\.delete\s*\(/, /(?:get|set|update)\s*\([^)]*totalRevenue/,/collection\(["'](?:records|products|recordCorrections|revenueGoals)["']\)/])
  assert.doesNotMatch(src,forbidden);
 assert.match(src,/partnerCompanyInvitations/);
 assert.match(src,/partnerRelations/);
});

test("deployment config must have no Firestore, Hosting or other deployment targets",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,"../firebase.partner-invites.json"),"utf8"));
 assert.deepEqual(Object.keys(cfg),["functions"]);
 assert.equal(cfg.functions.source,"functions");
 assert.equal(cfg.functions.codebase,"default");
 assert.equal(cfg.hosting,undefined);
 assert.equal(cfg.firestore,undefined);
 const source=fs.readFileSync(path.join(__dirname,"../functions/index.js"),"utf8");
 for(const name of ["createPartnerCompanyInvitation","previewPartnerCompanyInvitation","acceptPartnerCompanyInvitation"])
  assert.match(source,new RegExp("exports\\."+name+"\\s*=\\s*onCall"));
 assert.match(source,/process\.env\.PARTNER_INVITES_ENABLED\s*===\s*"enabled"/);
});
test("partner invitation page is isolated from legacy records and prices",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const html=fs.readFileSync(path.join(__dirname,"../partner-invite.html"),"utf8");
 for(const name of ["createPartnerCompanyInvitation","previewPartnerCompanyInvitation","acceptPartnerCompanyInvitation"])
  assert.ok(html.includes(name));
 assert.ok(!html.includes("firebase-firestore.js"));
 assert.ok(!html.includes("sendMissingReportReminders"));
});


const {makePartnerCountActivation}=require("../functions/partner-count-onboarding.cjs");
async function activationFixture(){
 const x=setup();
 const invited=await x.handlers.create(x.request("owner",createInput));
 const partner=await x.handlers.accept(x.request("recipient",{token:invited.token}));
 return {...x,partnerId:partner.partnerCompanyId};
}
function activation(db,{enabled=true,releaseId="release_review_20261031"}={}){
 const account={uid:"owner",email:"owner@example.com",
  emailVerified:true,disabled:false};
 return makePartnerCountActivation({
  db,getAuth:()=>({
   getUser:async uid=>({...account,uid}),
   verifyIdToken:async token=>{
    if(token!=="o".repeat(30))throw Error("invalid bearer");
    return {uid:"owner",email:account.email,email_verified:true};
   }
  }),
  FieldValue:{serverTimestamp:()=>({seconds:NOW/1000})},
  HttpsError:CallError,enabled:()=>enabled,releaseId:()=>releaseId
 });
}
function stampApproval(db,id,{restore=true}={}){
 db.seed("partnerCountOnboardingApprovals/"+id,{
  partnerCompanyId:id,hubCompanyId:"hub",approvedByUid:"owner",
  releaseId:"release_review_20261031",
  restoreVerified:restore,financeRulesVerified:true,
  catalogVerified:true,projectionVerified:true,
  backupDigest:"a".repeat(64),projectionDigest:"b".repeat(64)
 });
}
test("partner count activation requires independent real-world approval and never changes the original sales",async()=>{
 const x=await activationFixture(),fn=activation(x.db);
 x.db.seed("products/old-financial",{companyId:"hub",revenue:10000});
 x.db.seed("records/old-financial",{companyId:"hub",totalRevenue:120000,totalCount:12});
 const beforeProducts=clone(x.db.data.get("products/old-financial"));
 const beforeRecords=clone(x.db.data.get("records/old-financial"));
 const input=x.request("owner",{partnerCompanyId:x.partnerId,teamName:"協力店第1班"});
 await assert.rejects(fn.activate(input),err=>err.code==="failed-precondition");
 assert.equal(x.db.data.get("partnerRelations/"+x.partnerId).active,false);
 assert.equal(x.db.data.get("users/recipient").teamId,null);
 stampApproval(x.db,x.partnerId);
 const out=await fn.activate(input);
 assert.equal(out.countReportingEnabled,true);
 assert.equal(out.teamId,"partner_"+x.partnerId);
 assert.equal(x.db.data.get("teams/"+out.teamId).companyId,x.partnerId);
 assert.equal(x.db.data.get("users/recipient").teamId,out.teamId);
 assert.equal(x.db.data.get("companies/"+x.partnerId+"/members/recipient").teamId,out.teamId);
 assert.equal(x.db.data.get("partnerRelations/"+x.partnerId).active,true);
 assert.equal(x.db.data.get("partnerRelations/"+x.partnerId).catalogAccessApproved,true);
 assert.deepEqual(x.db.data.get("products/old-financial"),beforeProducts);
 assert.deepEqual(x.db.data.get("records/old-financial"),beforeRecords);
 assert.equal(x.db.data.get("users/recipient").canViewRevenue,false);
 assert.equal(x.db.data.get("users/recipient").canViewUnitPrice,false);
 assert.equal(x.db.data.get("partnerCountActivationAudits/"+x.partnerId).releaseId,"release_review_20261031");
 await assert.rejects(fn.activate(input),err=>err.code==="failed-precondition");
});
test("partner count activation cannot bypass disabled flag or unverified backup",async()=>{
 const x=await activationFixture();
 const before=JSON.stringify([...x.db.data]);
 const input=x.request("owner",{partnerCompanyId:x.partnerId,teamName:"協力店第1班"});
 await assert.rejects(activation(x.db,{enabled:false}).activate(input),err=>err.code==="unavailable");
 assert.equal(JSON.stringify([...x.db.data]),before);
 stampApproval(x.db,x.partnerId,{restore:false});
 await assert.rejects(activation(x.db).activate(input),err=>err.code==="failed-precondition");
 assert.equal(x.db.data.get("partnerRelations/"+x.partnerId).active,false);
});
test("partner count activation cannot be performed by the invite recipient",async()=>{
 const x=await activationFixture();
 stampApproval(x.db,x.partnerId);
 const input=x.request("recipient",{partnerCompanyId:x.partnerId,teamName:"協力店第1班"});
 await assert.rejects(activation(x.db).activate(input),err=>["permission-denied","unauthenticated"].includes(err.code));
 assert.equal(x.db.data.get("partnerRelations/"+x.partnerId).active,false);
});
test("new activation module never queries money-bearing collections or deletes",()=>{
 const src=require("node:fs").readFileSync(require.resolve("../functions/partner-count-onboarding.cjs"),"utf8");
 assert.doesNotMatch(src,/\\.delete\\s*\\(/);
 assert.doesNotMatch(src,/\\.collection\\s*\\(\\s*["'](?:records|products|recordCorrections|revenueGoals)["']\\s*\\)/);
 assert.doesNotMatch(src,/\\.set\\s*\\(.*\\{merge\\s*:\\s*false/);
});
