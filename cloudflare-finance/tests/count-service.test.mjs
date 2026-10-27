import {test} from "node:test";
import assert from "node:assert/strict";
import {submitCounts,SaveConflict,PermissionDenied} from "../src/count-service.js";
import {approvedPolicy} from "../src/index.js";

const companyId="factory", day="2026-10-22";
const product={id:"sim",companyId,name:"SIM",active:true,revenue:10000,
  pricingOptions:[{cashback:0,revenuePerUnit:10000},{cashback:1000,revenuePerUnit:9000}]};
function intent(overrides={}){
  return {uid:"staff",date:day,teamId:"A",workLocation:"店舗",reportStatus:"submitted",
    entries:[{productId:"sim",planId:"plan_0",count:2}],...overrides};
}
function createStore({role="member",principal="staff",currentRecord=null,recordList=null,
  grants={},targetActive=true,targetTeam="A",partner=false,recordsName="factory_staff_2026-10-22"}={}){
  const company={id:companyId,ownerUid:"master",masterUid:"master",active:true};
  const canViewRevenue=grants.revenue===true, canViewUnitPrice=grants.unit===true;
  const account={uid:principal,companyId,companyRole:role==="owner"?"owner":"member",
    teamId:"A",role:role==="owner"?"leader":role,active:true,canViewRevenue,canViewUnitPrice,
    ...(partner?{accessKind:"partner"}:{})};
  const actorMember={...account,name:"操作者"};
  const target={...(principal==="staff"?actorMember:{}),uid:"staff",companyId,
    companyRole:"member",role:"member",teamId:targetTeam,active:targetActive,name:"営業担当"};
  const docs=new Map([["users/"+principal,account],
    ["companies/"+companyId+"/members/"+principal,actorMember],
    ["companies/"+companyId+"/members/staff",target],
    ["companies/"+companyId,company],
    ["teams/A",{id:"A",companyId,name:"A班",active:true}],
    ["teams/B",{id:"B",companyId,name:"B班",active:true}]]);
  const saved=[],audit=[],observations={queryCount:0,reads:[],committed:0};
  return {saved,audit,observations,store:{
    async runTransaction(callback){
      const changes=[];
      const tx={
        async get(path){observations.reads.push(path);return docs.get(path)||null;},
        async queryDaily(cid,uid,date){
          observations.queryCount++;
          return (recordList || (currentRecord?[currentRecord]:[]))
            .filter(x=>x.companyId===cid && x.uid===uid && x.date===date);
        },
        async queryProducts(cid){return [product].filter(p=>p.companyId===cid);},
        saveRecord(id,data,oldVersion){changes.push({type:"record",id,data,oldVersion});},
        addCorrection(id,data){changes.push({type:"audit",id,data});},
        addSyncSignal(cid){changes.push({type:"signal",id:cid,data:{companyId:cid}});}
      };
      const ret=await callback(tx);
      // Mimic an atomic commit: no persistence until the callback succeeds.
      for(const c of changes){if(c.type==="record")saved.push(c);
        else if(c.type==="audit")audit.push(c);
        else if(c.type==="signal")observations.signals=(observations.signals||0)+1;
      }
      observations.committed++;
      return ret;
    }
  },principal:{uid:principal},policyResolver:(u,m,c,uid)=>approvedPolicy(u,m,c,uid,day)};
}
test("new member can submit counts without ever receiving company revenue or prices",async()=>{
  const f=createStore();
  const r=await submitCounts(f.store,f.principal,intent(),{policyResolver:f.policyResolver});
  assert.deepEqual(r,{saved:true,recordId:"factory_staff_2026-10-22",totalCount:2,corrected:false});
  assert.equal(f.saved.length,1);
  assert.equal(f.saved[0].data.totalRevenue,20000);
  assert.equal(f.saved[0].data.results.sim__cb_0.revenuePerUnit,10000);
  assert.equal(f.audit.length,0);
  assert.equal(f.observations.committed,1);
  assert.equal(f.observations.signals,1);
});
test("existing explicit revenue permission remains visible, but price is always derived server-side",async()=>{
  const f=createStore({grants:{revenue:true}});
  const r=await submitCounts(f.store,f.principal,intent(),{policyResolver:f.policyResolver});
  assert.equal(r.totalRevenue,20000);
  assert.equal(f.saved[0].data.totalCount,2);
  await assert.rejects(submitCounts(f.store,f.principal,intent({totalRevenue:1}),{policyResolver:f.policyResolver}),/Unexpected fields/);
  assert.equal(f.observations.committed,1);
});
test("Leader can proxy records only for own team; ordinary staff cannot impersonate",async()=>{
  const leader=createStore({role:"leader",principal:"leader1"});
  const result=await submitCounts(leader.store,leader.principal,intent(),{policyResolver:leader.policyResolver});
  assert.equal(result.saved,true);
  await assert.rejects(submitCounts(leader.store,leader.principal,intent({teamId:"B"}),{policyResolver:leader.policyResolver}),PermissionDenied);
  const ordinary=createStore({principal:"user-other"});
  await assert.rejects(submitCounts(ordinary.store,ordinary.principal,intent(),{policyResolver:ordinary.policyResolver}),PermissionDenied);
  assert.equal(ordinary.saved.length,0);
});
test("editing existing record requires correct server version, preserves original creation and snapshots",async()=>{
  const current={
    id:"old-legacy-ABC",companyId,uid:"staff",teamId:"A",date:day,
    createdByUid:"initial-owner",createdAt:"2026-10-01T00:00:00.000Z",
    updatedAt:"2026-10-20T00:00:00.000Z",__firestoreUpdateTime:"2026-10-20T00:00:00.123456Z",
    memberNameSnapshot:"以前の名前",teamNameSnapshot:"旧班名",
    workLocation:"以前の場所",results:{
      sim__cb_0:{productId:"sim",productName:"当時のSIM",cashback:0,count:1,revenuePerUnit:12345}
    },totalCount:1,totalRevenue:12345
  };
  const f=createStore({currentRecord:current});
  const input=intent({recordId:current.id,expectedRecordUpdateTime:current.__firestoreUpdateTime,
    entries:[{productId:"sim",planId:"plan_0",count:2}]});
  const r=await submitCounts(f.store,f.principal,input,{policyResolver:f.policyResolver,
    newAuditId:()=> "aabbccdd-1122-4455-8899-aabbccddeeff"});
  assert.equal(r.corrected,true);
  assert.equal(r.totalRevenue,undefined);
  assert.equal(f.saved[0].id,current.id);
  assert.equal(f.saved[0].data.totalRevenue,24690);
  assert.equal(f.saved[0].data.results.sim__cb_0.revenuePerUnit,12345);
  assert.equal(f.saved[0].data.results.sim__cb_0.productName,"当時のSIM");
  assert.equal(f.saved[0].data.createdAt,current.createdAt);
  assert.equal(f.saved[0].data.createdByUid,current.createdByUid);
  assert.equal(f.saved[0].data.teamNameSnapshot,"旧班名");
  assert.equal(f.audit.length,1);
  assert.deepEqual(f.audit[0].data.before.results,current.results);
  assert.equal(f.audit[0].data.after.totalRevenue,24690);
  assert.equal(f.audit[0].data.changedByUid,"staff");
});
test("stale version, duplicate daily records and silent legacy edit are rejected without writes",async()=>{
  const version="2026-10-20T00:00:00.000Z";
  const current={id:"legacy",companyId,uid:"staff",teamId:"A",date:day,
    totalRevenue:10000,totalCount:1,__firestoreUpdateTime:version,
    updatedAt:version,results:{sim__cb_0:{productId:"sim",count:1,revenuePerUnit:10000}}};
  const f=createStore({currentRecord:current});
  for(const input of [
    intent(), intent({recordId:"legacy",expectedRecordUpdateTime:"2026-10-19T00:00:00.000Z"}),
    intent({recordId:"someone-else",expectedRecordUpdateTime:version})
  ]){
    await assert.rejects(submitCounts(f.store,f.principal,input,{policyResolver:f.policyResolver}),SaveConflict);
  }
  const many=createStore({recordList:[current,{...current,id:"duplicated"}]});
  await assert.rejects(submitCounts(many.store,many.principal,intent(),{policyResolver:many.policyResolver}),SaveConflict);
  assert.equal(many.saved.length,0);
  assert.equal(f.audit.length,0);
  assert.equal(f.observations.committed,0);
});
test("suspicious cross-company or deactivated targets are denied before persistence",async()=>{
  const f=createStore({targetActive:false});
  await assert.rejects(submitCounts(f.store,f.principal,intent(),{policyResolver:f.policyResolver}),PermissionDenied);
  assert.equal(f.saved.length,0);
});
test("existing record team changes cannot be made by a Leader; Owner can keep old record ID",async()=>{
  const current={id:"legacy-one",companyId,uid:"staff",teamId:"B",date:day,
    totalRevenue:0,totalCount:0,__firestoreUpdateTime:"2026-10-20T00:00:00.000Z",
    updatedAt:"2026-10-20T00:00:00.000Z",results:{}};
  const leader=createStore({role:"leader",principal:"leader1",currentRecord:current});
  const input=intent({recordId:"legacy-one",expectedRecordUpdateTime:current.__firestoreUpdateTime,
    reportStatus:"no_result",entries:[]});
  await assert.rejects(submitCounts(leader.store,leader.principal,input,{policyResolver:leader.policyResolver}),PermissionDenied);
  const owner=createStore({role:"owner",principal:"master",currentRecord:current});
  const response=await submitCounts(owner.store,owner.principal,input,{policyResolver:owner.policyResolver,newAuditId:()=>"ffbbccdd-1122-4455-8899-aabbccddeeff"});
  assert.equal(response.saved,true);
  assert.equal(owner.saved[0].id,"legacy-one");
  assert.equal(owner.saved[0].data.teamId,"A");
});

test("Partner leader can submit own-team counts but cannot view money or proxy for other-team staff",async()=>{
  const f=createStore({role:"leader",principal:"external-leader",partner:true,
    grants:{revenue:true,unit:true}});
  const partnerIntent=intent({entries:[{productId:"sim",planId:"cb_0",count:2}]});
  const saved=await submitCounts(f.store,f.principal,partnerIntent,{policyResolver:f.policyResolver});
  assert.equal(saved.saved,true);
  assert.equal(saved.totalCount,2);
  assert.equal("totalRevenue" in saved,false);
  assert.equal(f.saved[0].data.totalCount,2);
  await assert.rejects(submitCounts(f.store,f.principal,intent({teamId:"B",entries:partnerIntent.entries}),
    {policyResolver:f.policyResolver}),PermissionDenied);
  const otherTeam=createStore({role:"leader",principal:"external-leader",partner:true,targetTeam:"B"});
  await assert.rejects(submitCounts(otherTeam.store,otherTeam.principal,partnerIntent,
    {policyResolver:otherTeam.policyResolver}),PermissionDenied);
  assert.equal(otherTeam.saved.length,0);
  await assert.rejects(submitCounts(f.store,f.principal,intent(),{policyResolver:f.policyResolver}),/stable cashback/);

});
