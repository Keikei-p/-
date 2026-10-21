import {test} from "node:test";
import assert from "node:assert/strict";
import {securePricing,validateCountIntent,buildRecordFromCounts,ValidationError} from "../src/write-plan.js";
const owner={uid:"master",companyId:"c1",isOwner:true,role:"leader",teamId:null};
const leader={uid:"leader",companyId:"c1",isOwner:false,role:"leader",teamId:"team1"};
const member={uid:"member",companyId:"c1",isOwner:false,role:"member",teamId:"team1"};
const target={uid:"member",name:"社員",companyId:"c1",active:true};
const team={id:"team1",companyId:"c1",name:"1班",active:true};
const product={id:"sim",companyId:"c1",name:"SIM",active:true,revenue:11000,pricingOptions:[
 {cashback:2000,revenuePerUnit:9000},{cashback:0,revenuePerUnit:11000}]};
const first={uid:"member",date:"2026-10-22",teamId:"team1",workLocation:"西条",reportStatus:"submitted",entries:[
 {productId:"sim",planId:"plan_0",count:2},
 {productId:"sim",planId:"plan_1",count:1}
]};
test("server resolvers use correct master price and sorted plan ID without trusting client price",()=>{
  const options=securePricing(product);
  assert.deepEqual(options,[{planId:"plan_0",cashback:0,revenuePerUnit:11000},{planId:"plan_1",cashback:2000,revenuePerUnit:9000}]);
  const p=buildRecordFromCounts(first,member,[product],target,team,null,"2026-10-22T08:00:00.000Z");
  assert.equal(p.document.totalCount,3);
  assert.equal(p.document.totalRevenue,31000);
  assert.equal(p.document.results.sim__cb_0.revenuePerUnit,11000);
  assert.equal(p.document.results.sim__cb_2000.revenuePerUnit,9000);
  assert.equal(p.document.teamNameSnapshot,"1班");
  assert.equal(p.document.memberNameSnapshot,"社員");
  assert.equal(p.document.reportStatus,"submitted");
  assert.equal(p.recordId,"c1_member_2026-10-22");
});
test("legacy products keep old per-variant price interpretation; existing amounts never guessed",()=>{
  assert.deepEqual(securePricing({id:"legacy",name:"HTB",revenue:10000,cashbackOptions:[2000,0]}),
    [{planId:"plan_0",cashback:2000,revenuePerUnit:2000},{planId:"plan_1",cashback:0,revenuePerUnit:10000}]);
  assert.deepEqual(securePricing({id:"htb-cb",name:"HTB CB2万円",revenue:20000}),
    [{planId:"plan_0",cashback:20000,revenuePerUnit:20000}]);
});
test("Master can submit member record for any active same-company team",()=>{
  const dst={id:"team2",name:"2班",companyId:"c1",active:true};
  const inp={...first,teamId:"team2",entries:[]};
  const p=buildRecordFromCounts(inp,owner,[product],target,dst);
  assert.equal(p.document.totalCount,0);
  assert.equal(p.document.totalRevenue,0);
  assert.equal(p.document.teamId,"team2");
});
test("leader may proxy to own team, member may not proxy another person",()=>{
  assert.equal(buildRecordFromCounts(first,leader,[product],target,team).document.teamId,"team1");
  assert.throws(()=>buildRecordFromCounts(first,member,{...product},target,team),ValidationError);
  assert.throws(()=>validateCountIntent({...first,uid:"leader"},member),ValidationError);
  assert.throws(()=>validateCountIntent({...first,teamId:"team2"},leader),ValidationError);
});
test("money supplied by client is rejected rather than compared or persisted",()=>{
  for(const unwanted of ["totalRevenue","revenuePerUnit","companyId","companyRole","canViewRevenue"]){
    assert.throws(()=>validateCountIntent({...first,[unwanted]:999999},member),ValidationError);
  }
  assert.throws(()=>validateCountIntent({...first,entries:[{productId:"sim",planId:"plan_0",count:3,price:1}]},member),ValidationError);
});
test("invalid or missing product and plan errors never fallback to a zero price",()=>{
  for(const change of [
    {...first,entries:[{productId:"unknown",planId:"plan_0",count:1}]},
    {...first,entries:[{productId:"sim",planId:"plan_99",count:1}]}
  ]){
    assert.throws(()=>buildRecordFromCounts(change,member,[product],target,team),ValidationError);
  }
  assert.throws(()=>buildRecordFromCounts(first,member,[{...product,companyId:"another-company"}],target,team),ValidationError);
  assert.throws(()=>buildRecordFromCounts(first,member,[{...product,active:false}],target,team),ValidationError);
});
test("other-company, missing, or deactivated members and teams cannot be used",()=>{
  assert.throws(()=>buildRecordFromCounts(first,member,[product],{...target,active:false},team),ValidationError);
  assert.throws(()=>buildRecordFromCounts(first,member,[product],{...target,companyId:"other"},team),ValidationError);
  assert.throws(()=>buildRecordFromCounts(first,member,[product],target,{...team,companyId:"other"}),ValidationError);
  assert.throws(()=>buildRecordFromCounts(first,member,[product],target,{...team,active:false}),ValidationError);
});
test("daily record correction preserves creation and owner of personal history; mismatched version stops stale writes",()=>{
  const current={companyId:"c1",uid:"member",date:"2026-10-22",
    teamId:"team1",teamNameSnapshot:"旧班名",createdAt:"2026-10-22T00:00:00.000Z",
    createdByUid:"oldCreator",updatedAt:"2026-10-22T02:00:00.000Z"};
  const req={...first,recordId:"legacy-id",expectedRecordUpdateTime:current.updatedAt};
  const built=buildRecordFromCounts(req,member,[product],target,team,current,"2026-10-22T08:00:00.000Z");
  assert.equal(built.recordId,"legacy-id");
  assert.equal(built.document.createdAt,current.createdAt);
  assert.equal(built.document.createdByUid,current.createdByUid);
  assert.equal(built.document.teamNameSnapshot,"旧班名");
  assert.equal(built.document.totalCount,3);
  assert.throws(()=>buildRecordFromCounts({...req,expectedRecordUpdateTime:"2026-10-22T01:00:00.000Z"},
    member,[product],target,team,current),ValidationError);
  assert.throws(()=>buildRecordFromCounts({...req,date:"2026-10-21"},member,[product],target,team,current),ValidationError);
  assert.throws(()=>buildRecordFromCounts({...req,uid:"other"},owner,[product],target,team,current),ValidationError);
});
test("zero result reports always have exactly zero count and 0 revenue",()=>{
  assert.throws(()=>buildRecordFromCounts({...first,reportStatus:"no_result"},member,[product],target,team),ValidationError);
  const empty=buildRecordFromCounts({...first,reportStatus:"no_result",entries:[]},member,[product],target,team);
  assert.equal(empty.document.totalCount,0);
  assert.equal(empty.document.totalRevenue,0);
});
test("duplicate results, negative count, unsafe date and malformed input are rejected",()=>{
  assert.throws(()=>buildRecordFromCounts({...first,entries:[first.entries[0],first.entries[0]]},member,[product],target,team),ValidationError);
  assert.throws(()=>validateCountIntent({...first,entries:[{productId:"sim",planId:"plan_0",count:-1}]},member),ValidationError);
  assert.throws(()=>validateCountIntent({...first,date:"2026-02-30"},member),ValidationError);
  assert.throws(()=>validateCountIntent({...first,workLocation:"x".repeat(160)},member),ValidationError);
});
