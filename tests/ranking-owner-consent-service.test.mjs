import test from "node:test";
import assert from "node:assert/strict";
import {createRankingOwnerConsentService}
 from "../ranking/ranking-owner-consent-service.mjs";
import {createFreshCombinedRankingContext}
 from "../ranking/trusted-combined-ranking-context.mjs";
import {createOwnerRankingConsentStatusReader}
 from "../ranking/ranking-owner-consent-status.mjs";

const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Coll(this.db,this.path+"/"+name);}
}
class Query{
 constructor(db,path,pred=()=>true,max=Infinity){
  this.db=db;this.path=path;this.pred=pred;this.max=max;
 }
 where(k,op,v){assert.equal(op,"==");return new Query(this.db,this.path,
  row=>this.pred(row)&&row[k]===v,this.max);}
 limit(n){return new Query(this.db,this.path,this.pred,n);}
}
class Coll extends Query{
 doc(id){return new Ref(this.db,this.path+"/"+(id||"audit"+(++this.db.serial)));}
}
function fake(){
 const d=new Map(),events=[],db={
  serial:0,collection:name=>new Coll(db,name),
  async runTransaction(fn,options){
   const writes=[],tx={
    async get(ref){
     events.push({op:"get",path:ref.path});
     if(ref instanceof Ref){
      const row=d.get(ref.path);
      return {id:ref.id,exists:row!==undefined,data:()=>clone(row)};
     }
     const docs=[...d.entries()]
      .filter(([path,value])=>path.startsWith(ref.path+"/")&&
       !path.slice(ref.path.length+1).includes("/")&&ref.pred(value))
      .slice(0,ref.max).map(([path,value])=>({
       id:path.split("/").at(-1),exists:true,data:()=>clone(value)}));
     return {docs,size:docs.length};
    },
    create(ref,row){writes.push({op:"create",ref,row:clone(row)});},
    update(ref,row){writes.push({op:"update",ref,row:clone(row)});}
   };
   const result=await fn(tx);
   if(options?.readOnly===true&&writes.length)throw Error("readonly write");
   for(const w of writes){
    const original=d.get(w.ref.path);
    if(w.op==="create"&&original!==undefined)throw Error("already exists");
    if(w.op==="update"&&original===undefined)throw Error("missing");
   }
   for(const w of writes){
    const original=d.get(w.ref.path)||{};
    d.set(w.ref.path,w.op==="create"?w.row:{...original,...w.row});
    events.push({op:w.op,path:w.ref.path});
   }
   return result;
  }
 };
 const seed=(path,row)=>d.set(path,clone(row));
 seed("companies/hub",{companyKind:"internal",active:true,ownerUid:"hubOwner"});
 seed("companies/p1",{companyKind:"partner",active:true,
  hubCompanyId:"hub",ownerUid:"partnerOwner"});
 for(const [uid,cid,access,type] of [
  ["hubOwner","hub","internal","direct"],
  ["partnerOwner","p1","partner","cooperator"]
 ]){
  const profile={uid,companyId:cid,companyRole:"owner",active:true,
   role:"leader",accessKind:access,memberType:type,
   email:uid+"@example.test",canViewRevenue:access==="internal",
   canViewUnitPrice:access==="internal"};
  seed("users/"+uid,profile);
  seed("companies/"+cid+"/members/"+uid,profile);
 }
 seed("partnerRelations/p1",{
  hubCompanyId:"hub",partnerCompanyId:"p1",active:true,countSharingApproved:true
 });
 const originals={
  "records/immutable-revenue":{companyId:"hub",totalRevenue:95000,cashback:5000},
  "products/immutable-product":{companyId:"hub",unitPrice:19000},
  "recordCorrections/immutable":{companyId:"hub",beforeRevenue:90000},
  "revenueGoals/immutable":{companyId:"hub",targetRevenue:250000},
  "companies/p1/partnerWorkEntries/2026-11-07__staff":{
   companyId:"p1",totalCount:3,counts:{NURO:3}}
 };
 for(const [path,row] of Object.entries(originals))seed(path,row);
 const service=createRankingOwnerConsentService({db,FieldValue:{
  serverTimestamp:()=>({__serverTimestamp:true})}});
 return {db,d,events,seed,originals,service};
}
const auth=uid=>({uid,email:(uid+"@example.test").toLowerCase(),emailVerified:true});
const submit=(f,uid,enable,expectedVersion=0,partnerCompanyId="p1")=>
 f.service({auth:auth(uid),partnerCompanyId,enable,expectedVersion});
const refuse=/RANKING_OWNER_CONSENT_NOT_AUTHORIZED_OR_STALE/;
const copyOriginals=f=>Object.fromEntries(
 Object.keys(f.originals).map(path=>[path,clone(f.d.get(path))]));
const auditDocs=f=>[...f.d.keys()].filter(p=>p.includes("/rankingApprovalAudits/"));

test("hub Owner and partner Owner independently approve names/ranks; neither can sign for the other",async()=>{
 const f=fake(),old=copyOriginals(f);
 const hub=await submit(f,"hubOwner",true);
 assert.deepEqual(hub,{saved:true,partnerCompanyId:"p1",enabled:true,version:1});
 assert.equal(f.d.has("companies/hub/rankingApprovals/p1"),true);
 assert.equal(f.d.has("companies/p1/rankingApprovals/hub"),false);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByHub,true);
 assert.equal(f.d.get("partnerRelations/p1").individualNamesApprovedByHub,true);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner,undefined);
 const partner=await submit(f,"partnerOwner",true);
 assert.equal(partner.version,1);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner,true);
 assert.equal(f.d.get("partnerRelations/p1").individualNamesApprovedByPartner,true);
 const ctx=await createFreshCombinedRankingContext({db:f.db})(auth("hubOwner"));
 assert.deepEqual(ctx.approvedCompanyIds,["hub","p1"]);
 assert.equal(auditDocs(f).length,2);
 assert.deepEqual(copyOriginals(f),old,"money originals and saved counts unchanged");
 assert(f.events.filter(e=>["update","create"].includes(e.op))
  .every(x=>/rankingApprovals|rankingApprovalAudits|partnerRelations/.test(x.path)));
});

test("revocation is immediate and leaves all data/counters/history and other owner's approval intact",async()=>{
 const f=fake();await submit(f,"hubOwner",true);await submit(f,"partnerOwner",true);
 const original=copyOriginals(f);
 const disabled=await submit(f,"partnerOwner",false,1);
 assert.deepEqual(disabled,{saved:true,partnerCompanyId:"p1",enabled:false,version:2});
 assert.equal(f.d.get("companies/p1/rankingApprovals/hub").active,false);
 assert.equal(f.d.get("companies/hub/rankingApprovals/p1").active,true);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner,false);
 assert.equal(f.d.get("partnerRelations/p1").individualNamesApprovedByPartner,false);
 assert.equal(auditDocs(f).length,3);
 assert.equal(f.d.get("companies/p1/rankingApprovalAudits/audit3").previousVersion,1);
 const hubCtx=await createFreshCombinedRankingContext({db:f.db})(auth("hubOwner"));
 assert.deepEqual(hubCtx.approvedCompanyIds,["hub"]);
 await assert.rejects(
  createFreshCombinedRankingContext({db:f.db})(auth("partnerOwner")),/UNVERIFIED/);
 assert.deepEqual(copyOriginals(f),original);
});

test("retries are idempotent; stale or forged expected version cannot overwrite another approval",async()=>{
 const f=fake();await submit(f,"hubOwner",true);
 const before=clone([...f.d]),writes=f.events.filter(e=>e.op==="update").length;
 assert.deepEqual(await submit(f,"hubOwner",true,1),{
  saved:false,partnerCompanyId:"p1",enabled:true,version:1});
 assert.deepEqual([...f.d],before);
 assert.equal(f.events.filter(e=>e.op==="update").length,writes);
 for(const bad of [0,2,999,-1]){
  await assert.rejects(submit(f,"hubOwner",false,bad),refuse);
 }
 assert.deepEqual([...f.d],before);
});

test("non-owner, disabled member, cross-company partner and active secondary context blocked",async()=>{
 const scenarios=[
  f=>{f.d.get("users/hubOwner").companyRole="member";},
  f=>{f.d.get("companies/hub/members/hubOwner").companyRole="member";},
  f=>{f.d.get("companies/hub").ownerUid="other";},
  f=>{f.d.get("users/hubOwner").active=false;},
  f=>{f.d.get("companies/hub/members/hubOwner").active=false;},
  f=>{f.d.get("users/hubOwner").accessKind="partner";},
  f=>{f.d.set("partnerWorkspaceContexts/hubOwner",{active:true});},
  f=>{f.d.get("users/partnerOwner").canViewRevenue=true;},
  f=>{f.d.get("companies/p1").active=false;},
  f=>{f.d.get("partnerRelations/p1").active=false;},
  f=>{f.d.get("partnerRelations/p1").countSharingApproved=false;}
 ];
 for(let i=0;i<scenarios.length;i++){
  const f=fake();scenarios[i](f);
  const who=i===7?"partnerOwner":"hubOwner";
  await assert.rejects(submit(f,who,true),refuse,"scenario "+i);
  assert.equal(auditDocs(f).length,0);
 }
 const a=fake();
 await assert.rejects(submit(a,"partnerOwner",true,0,"otherPartner"),refuse);
 await assert.rejects(a.service({
  auth:{...auth("hubOwner"),uid:"../../owner"},
  partnerCompanyId:"p1",enable:true,expectedVersion:0
 }),refuse);
 await assert.rejects(a.service({
  auth:auth("hubOwner"),partnerCompanyId:"p1",enable:"true",
  expectedVersion:0
 }),refuse);
});

test("no client permission, count sharing and financial originals are untouched by consent writes",async()=>{
 const f=fake();
 await submit(f,"hubOwner",true);
 assert.equal(f.d.get("partnerRelations/p1").countSharingApproved,true);
 assert.equal(f.d.get("partnerRelations/p1").active,true);
 assert.equal(f.d.get("users/hubOwner").companyId,"hub");
 assert.equal(f.d.get("users/partnerOwner").companyId,"p1");
 assert.equal(f.d.get("companies/p1").hubCompanyId,"hub");
 assert.deepEqual(copyOriginals(f),f.originals);
});


test("ON -> OFF -> ON restores reciprocal public access at version 3 without changing sales or counts",async()=>{
 const f=fake();
 const before=copyOriginals(f);
 await submit(f,"hubOwner",true,0);
 await submit(f,"partnerOwner",true,0);
 const beforeRevocation=await createFreshCombinedRankingContext({db:f.db})(auth("partnerOwner"));
 assert.deepEqual(beforeRevocation.approvedCompanyIds,["hub","p1"]);
 const revoked=await submit(f,"partnerOwner",false,1);
 assert.equal(revoked.version,2);
 await assert.rejects(
  createFreshCombinedRankingContext({db:f.db})(auth("partnerOwner")),/UNVERIFIED/);
 const approvedAgain=await submit(f,"partnerOwner",true,2);
 assert.deepEqual(approvedAgain,{
  saved:true,partnerCompanyId:"p1",enabled:true,version:3
 });
 const restored=await createFreshCombinedRankingContext({db:f.db})(auth("partnerOwner"));
 assert.deepEqual(restored.approvedCompanyIds,["hub","p1"]);
 assert.equal(f.d.get("companies/p1/rankingApprovals/hub").version,3);
 assert.equal(f.d.get("partnerRelations/p1").individualNamesApprovedByHub,true);
 assert.equal(f.d.get("partnerRelations/p1").individualNamesApprovedByPartner,true);
 assert.equal(auditDocs(f).length,4);
 await assert.rejects(submit(f,"partnerOwner",false,1),refuse);
 assert.deepEqual(copyOriginals(f),before);
});

test("corrupted owner consent versions are rejected; client cannot replace with a fake v1",async()=>{
 for(const version of [0,-1,1.2,1000,"1",null]){
  const f=fake();
  await submit(f,"hubOwner",true,0);
  await submit(f,"partnerOwner",true,0);
  f.d.get("companies/p1/rankingApprovals/hub").version=version;
  await assert.rejects(
   createFreshCombinedRankingContext({db:f.db})(auth("partnerOwner")),
   /UNVERIFIED/,String(version));
 }
});


const withNamedPartner=()=>{const x=fake();
 x.d.get("companies/p1").name="協力店A";
 return x;
};

test("owner settings status returns fresh correct own/other approvals and latest version",async()=>{
 const f=withNamedPartner(),get=createOwnerRankingConsentStatusReader({db:f.db});
 const hubBefore=await get(auth("hubOwner"));
 assert.deepEqual(hubBefore,{schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
  partners:[{partnerCompanyId:"p1",companyName:"協力店A",
   ownApproved:false,otherApproved:false,version:0,canEdit:true}]});
 assert.equal(Object.isFrozen(hubBefore),true);
 await submit(f,"hubOwner",true);
 const hubWaiting=await get(auth("hubOwner"));
 assert.equal(hubWaiting.partners[0].ownApproved,true);
 assert.equal(hubWaiting.partners[0].otherApproved,false);
 assert.equal(hubWaiting.partners[0].version,1);
 const partnerWaiting=await get(auth("partnerOwner"));
 assert.equal(partnerWaiting.role,"partner_owner");
 assert.equal(partnerWaiting.partners[0].ownApproved,false);
 assert.equal(partnerWaiting.partners[0].otherApproved,true);
 await submit(f,"partnerOwner",true);
 const partnerApproved=await get(auth("partnerOwner"));
 assert.equal(partnerApproved.partners[0].ownApproved,true);
 assert.equal(partnerApproved.partners[0].otherApproved,true);
 await submit(f,"partnerOwner",false,1);
 const partnerRevoked=await get(auth("partnerOwner"));
 assert.equal(partnerRevoked.partners[0].ownApproved,false);
 assert.equal(partnerRevoked.partners[0].version,2);
 await submit(f,"partnerOwner",true,2);
 const reapproved=await get(auth("partnerOwner"));
 assert.equal(reapproved.partners[0].ownApproved,true);
 assert.equal(reapproved.partners[0].version,3);
 assert(f.events.filter(e=>e.op==="transaction").every(e=>e.options?.readOnly===true)
   ||f.events.filter(e=>e.op==="get").length>0);
});

test("settings status cannot reveal finance originals or any other company's data",async()=>{
 const f=withNamedPartner(),get=createOwnerRankingConsentStatusReader({db:f.db});
 const before=f.events.length;
 const response=await get(auth("hubOwner"));
 const newOps=f.events.slice(before);
 assert(newOps.filter(e=>e.op==="get").every(e=>!/^(records|products|recordCorrections|revenueGoals)(\/|$)/.test(e.path)));
 assert(!JSON.stringify(response).includes("totalRevenue"));
 assert(!JSON.stringify(response).includes("unitPrice"));
 assert(!JSON.stringify(response).includes("cashback"));
 assert(!JSON.stringify(response).includes("records"));
 assert.deepEqual(copyOriginals(f),f.originals);
});

test("status fails closed on forged approval flags, missing owner, bad company, secondary role and monetary company labels",async()=>{
 const mutations=[
  f=>{f.d.get("partnerRelations/p1").combinedRankingApprovedByHub=true;},
  f=>{f.d.get("partnerRelations/p1").individualNamesApprovedByPartner=true;},
  f=>{f.d.get("companies/p1").name="単価 90000円";},
  f=>{f.d.get("companies/p1").hubCompanyId="otherHub";},
  f=>{f.d.get("users/hubOwner").companyRole="member";},
  f=>{f.d.get("companies/hub/members/hubOwner").active=false;},
  f=>{f.d.set("partnerWorkspaceContexts/hubOwner",{active:true,kind:"partner_secondary"});},
  f=>{f.d.get("users/hubOwner").email="bad@example.test";}
 ];
 for(let i=0;i<mutations.length;i++){
  const f=withNamedPartner();mutations[i](f);
  await assert.rejects(
    createOwnerRankingConsentStatusReader({db:f.db})(auth("hubOwner")),
    /RANKING_OWNER_STATUS_UNAUTHORIZED_OR_INCOMPLETE/,String(i));
 }
 const f=withNamedPartner();
 await assert.rejects(createOwnerRankingConsentStatusReader({db:f.db})({
  uid:"hubOwner",email:"hubowner@example.test",emailVerified:false}),
  /RANKING_OWNER_STATUS_UNAUTHORIZED_OR_INCOMPLETE/);
});

test("stopped partner relation is visible to its hub owner but cannot be edited",async()=>{
 const f=withNamedPartner();
 f.d.get("partnerRelations/p1").active=false;
 const d=await createOwnerRankingConsentStatusReader({db:f.db})(auth("hubOwner"));
 assert.equal(d.partners.length,1);
 assert.equal(d.partners[0].canEdit,false);
});

test("client-side settings panel consumes exactly the authenticated status contract",async()=>{
 const f=withNamedPartner();
 const status=await createOwnerRankingConsentStatusReader({db:f.db})(auth("hubOwner"));
 assert.equal(status.schema,"nico-ranking-owner-consent-v1");
 assert.deepEqual(Object.keys(status).sort(),["schema","role","partners"].sort());
 assert.deepEqual(Object.keys(status.partners[0]).sort(),
  ["partnerCompanyId","companyName","ownApproved","otherApproved","version","canEdit"].sort());
});


test("hub relation query cannot return other hub's row; partner's direct relation lookup rejects reassignment",async()=>{
 const f=withNamedPartner();
 f.d.get("partnerRelations/p1").hubCompanyId="differentHub";
 const hub=await createOwnerRankingConsentStatusReader({db:f.db})(auth("hubOwner"));
 assert.deepEqual(hub.partners,[],
  "a row indexed to another hub must never be exposed to original hub");
 await assert.rejects(
  createOwnerRankingConsentStatusReader({db:f.db})(auth("partnerOwner")),
  /RANKING_OWNER_STATUS_UNAUTHORIZED_OR_INCOMPLETE/,
  "partner direct doc lookup must reject a mismatched hub");
});


test("hub Owner can open configuration status for a hub-created unclaimed partner without signing on its behalf",async()=>{
 const f=withNamedPartner();
 const original=copyOriginals(f);
 delete f.d.get("companies/p1").ownerUid;
 const get=createOwnerRankingConsentStatusReader({db:f.db});
 const visible=await get(auth("hubOwner"));
 assert.equal(visible.role,"hub_owner");
 assert.equal(visible.partners.length,1);
 assert.deepEqual(visible.partners[0],{
  partnerCompanyId:"p1",companyName:"協力店A",ownApproved:false,
  otherApproved:false,version:0,canEdit:true
 });
 assert.deepEqual(copyOriginals(f),original);
 assert.equal(f.events.filter(x=>x.op==="create"||x.op==="update").length,0);
 const approved=await submit(f,"hubOwner",true);
 assert.deepEqual(approved,{saved:true,partnerCompanyId:"p1",enabled:true,version:1});
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByHub,true);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner,undefined);
 const after=await get(auth("hubOwner"));
 assert.deepEqual(after.partners[0],{
  partnerCompanyId:"p1",companyName:"協力店A",ownApproved:true,
  otherApproved:false,version:1,canEdit:true
 });
 assert.equal(f.d.has("companies/p1/rankingApprovals/hub"),false);
 assert.deepEqual(copyOriginals(f),original);
 const stillHubOnly=await createFreshCombinedRankingContext({db:f.db})(auth("hubOwner"));
 assert.deepEqual(stillHubOnly.approvedCompanyIds,["hub"],
  "Hub consent without Partner Owner must never publish Partner counts");
 await assert.rejects(get(auth("partnerOwner")),
  /RANKING_OWNER_STATUS_UNAUTHORIZED_OR_INCOMPLETE/,
  "cannot invent partner Owner from merely knowing user role");
});
test("unclaimed partner never gains ranking if consent documents or relation flags appear",async()=>{
 for(const mutate of [
  f=>f.d.set("companies/p1/rankingApprovals/hub",{
   companyId:"p1",hubCompanyId:"hub",partnerCompanyId:"p1",
   active:true,version:1,combinedRankingApproved:true,individualNamesApproved:true,
   scope:"combined_rank_only",approvedByUid:"partnerOwner"
  }),
  f=>{f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner=true;},
  f=>{f.d.get("partnerRelations/p1").individualNamesApprovedByPartner=true;},
  f=>{f.d.get("companies/p1").ownerUid="../bad";},
 ]){
  const f=withNamedPartner();
  delete f.d.get("companies/p1").ownerUid;
  mutate(f);
  await assert.rejects(
   createOwnerRankingConsentStatusReader({db:f.db})(auth("hubOwner")),
   /RANKING_OWNER_STATUS_UNAUTHORIZED_OR_INCOMPLETE/
  );
 }
});



test("unclaimed partner: Hub approval can be revoked, but Partner approval cannot be forged",async()=>{
 const f=withNamedPartner();
 delete f.d.get("companies/p1").ownerUid;
 const a=await submit(f,"hubOwner",true);
 assert.equal(a.version,1);
 await assert.rejects(submit(f,"partnerOwner",true),refuse);
 const removed=await submit(f,"hubOwner",false,1);
 assert.deepEqual(removed,{saved:true,partnerCompanyId:"p1",enabled:false,version:2});
 assert.equal(f.d.has("companies/p1/rankingApprovals/hub"),false);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByHub,false);
 assert.equal(f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner,undefined);
 assert.deepEqual(copyOriginals(f),f.originals);
});
test("unclaimed partner: fake Partner approval/invalid ownerUid blocks Hub consent save atomically",async()=>{
 for(const mutate of [
  f=>{f.d.get("partnerRelations/p1").combinedRankingApprovedByPartner=true;},
  f=>{f.d.get("partnerRelations/p1").individualNamesApprovedByPartner=true;},
  f=>f.d.set("companies/p1/rankingApprovals/hub",{
   companyId:"p1",hubCompanyId:"hub",partnerCompanyId:"p1",
   approvedByUid:"partnerOwner",scope:"combined_rank_only",
   active:true,combinedRankingApproved:true,individualNamesApproved:true,version:1
  }),
  f=>{f.d.get("companies/p1").ownerUid="bad/uid";}
 ]){
  const f=withNamedPartner();
  delete f.d.get("companies/p1").ownerUid;
  mutate(f);
  const before=copyOriginals(f);
  await assert.rejects(submit(f,"hubOwner",true),refuse);
  assert.equal(auditDocs(f).length,0);
  assert.equal(f.d.has("companies/hub/rankingApprovals/p1"),false);
  assert.deepEqual(copyOriginals(f),before);
 }
});
