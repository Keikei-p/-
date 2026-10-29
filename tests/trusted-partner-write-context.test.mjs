import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedPartnerWriteContext} from "../security/trusted-partner-write-context.mjs";
const now=Math.floor(Date.parse("2026-10-29T09:00:00Z")/1000);
const auth={uid:"staff1",authTime:now,emailVerified:true};
const request={date:"2026-10-29",teamId:"team1",status:"submitted",
 lines:[{catalogId:"shared:hub:NURO",count:3},
   {catalogId:"custom:partnerCo:water",count:1}]};
function fixture(){
 let memberActive=true;
 const docs=new Map([
  ["users/staff1",{uid:"staff1",companyId:"partnerCo",active:true,
    companyRole:"member",accessKind:"partner",teamId:"team1"}],
  ["companies/partnerCo",{ownerUid:"partnerOwner",active:true,
    companyKind:"partner",hubCompanyId:"hub"}],
  ["companies/partnerCo/members/staff1",{
    uid:"staff1",companyId:"partnerCo",active:true,accessKind:"partner",
    role:"leader",companyRole:"member",teamId:"team1",name:"スタッフA"}],
  ["teams/team1",{companyId:"partnerCo",active:true,name:"協力店1班"}],
  ["teams/team2",{companyId:"partnerCo",active:true,name:"協力店2班"}],
  ["partnerRelations/partnerCo",{active:true,partnerCompanyId:"partnerCo",
    hubCompanyId:"hub",countSharingApproved:true,catalogAccessApproved:true}],
  ["companies/hub",{active:true,companyKind:"internal"}]
 ]);
 let catalog=[
  {catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,visibility:"shared_counts"},
  {catalogId:"custom:partnerCo:water",ownerCompanyId:"partnerCo",
    active:true,visibility:"private"}
 ];
 let checked=0,authoritativeReads=[];
 const dependencies={
  token:"mocked-bearer-token-string-for-tests",
  request,
  authenticateBearer:async()=>{
    checked++;return auth;
  },
  loadAuthUser:async()=>({
   uid:"staff1",disabled:false,emailVerified:true,
   tokensValidAfterTime:"2026-10-01T00:00:00Z"
  }),
  readInTransaction:async(_tx,path)=>{
   authoritativeReads.push(path);
   assert(!/^(products|records|recordCorrections|revenueGoals)\//.test(path));
   return docs.get(path)??null;
  },
  loadCountCatalog:async(_tx,scope)=>{
   assert.deepEqual(scope,{companyId:"partnerCo",hubCompanyId:"hub"});
   return catalog;
  }
 };
 const build=(options={})=>createTrustedPartnerWriteContext({...dependencies,...options});
 return {docs,build,deps:dependencies,setCatalog:rows=>{catalog=rows;},
  get checked(){return checked;},authoritativeReads};
}
const txn={readOnly:true};
test("trusted write context uses signed UID and in-transaction member/team/catalog scope only",async()=>{
 const f=fixture();
 const context=await f.build()(txn);
 assert.deepEqual(context.principal,{
  serverVerified:true,tokenVerified:true,userActive:true,memberActive:true,
  companyActive:true,companyKind:"partner",accessKind:"partner",
  partnerRelationApproved:true,canSubmit:true,
  uid:"staff1",companyId:"partnerCo",teamIds:["team1"]
 });
 assert.equal(context.memberName,"スタッフA");
 assert.equal(context.teamName,"協力店1班");
 assert.equal(context.catalog.length,2);
 assert(!JSON.stringify(context).includes("revenue"));
 assert.equal(f.checked,1);
 assert(f.authoritativeReads.includes("partnerRelations/partnerCo"));
});
test("browser cannot pick another team's submissions, cross-company scope, or fake owner status",async()=>{
 const f=fixture();
 await assert.rejects(f.build({request:{...request,teamId:"team2"}})(txn),/not authorized/);
 f.docs.get("users/staff1").companyId="hub";
 await assert.rejects(f.build()(txn),/not authorized/);
 f.docs.get("users/staff1").companyId="partnerCo";
 f.docs.get("companies/partnerCo/members/staff1").role="fakeOwner";
 await assert.rejects(f.build()(txn),/not authorized/);
});
test("partner consent, team activity and user suspension block new writes",async()=>{
 const f=fixture();
 f.docs.get("partnerRelations/partnerCo").active=false;
 await assert.rejects(f.build()(txn),/not authorized/);
 f.docs.get("partnerRelations/partnerCo").active=true;
 f.docs.get("teams/team1").active=false;
 await assert.rejects(f.build()(txn),/not authorized/);
 f.docs.get("teams/team1").active=true;
 f.docs.get("companies/partnerCo/members/staff1").canSubmit=false;
 await assert.rejects(f.build()(txn),/not authorized/);
});
test("trusted catalog may include private partner SKU but cannot include money or unrelated hub SKU",async()=>{
 const f=fixture();const valid=await f.build()(txn);
 assert.equal(valid.catalog[1].visibility,"private");
 f.setCatalog([{catalogId:"shared:other:NURO",ownerCompanyId:"other",active:true,visibility:"shared_counts"}]);
 await assert.rejects(f.build()(txn),/not authorized/);
 f.setCatalog([{catalogId:"shared:hub:NURO",ownerCompanyId:"hub",active:true,
   visibility:"shared_counts",revenuePerUnit:10000}]);
 await assert.rejects(f.build()(txn),/not authorized/);
 f.setCatalog([{catalogId:"shared:hub:CB20000",ownerCompanyId:"hub",active:true,
   visibility:"shared_counts"}]);
 await assert.rejects(f.build()(txn),/not authorized/);
});
test("transaction context is always required and no Firebase write is performed by adapter",async()=>{
 const f=fixture();
 await assert.rejects(f.build()(null),/not authorized/);
 assert.throws(()=>f.build({authenticateBearer:null}),/not authorized/);
 assert.throws(()=>f.build({request:{...request,teamId:"../other"}}),/not authorized/);
 assert.equal(f.authoritativeReads.length,0);
});
