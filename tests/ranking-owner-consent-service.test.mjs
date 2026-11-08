import test from "node:test";
import assert from "node:assert/strict";
import {createRankingOwnerConsentService}
 from "../ranking/ranking-owner-consent-service.mjs";
import {createFreshCombinedRankingContext}
 from "../ranking/trusted-combined-ranking-context.mjs";

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
