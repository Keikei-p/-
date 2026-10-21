import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, sign} from "node:crypto";
import worker,{approvedPolicy,safeProducts,safeRecords,safeGoals,visibleMoney,verifiedToken} from "../src/index.js";

const company={id:"company-A",masterUid:"master-uid",ownerUid:"master-uid",active:true};
function person(role,{uid="sample",userGrants={},memberGrants={},teamId="A",companyRole="member"}={}){
  const user={uid,companyId:"company-A",companyRole,role,teamId,active:true,...userGrants};
  const member={uid,companyId:"company-A",companyRole,role,teamId,active:true,...memberGrants};
  return [user,member];
}
function policy(role,options={}){
  const [u,m]=person(role,options);
  return approvedPolicy(u,m,company,options.uid||"sample","2026-10-22");
}
function check(expected,actual){assert.equal(actual,expected);}
test("Owner and Master always see financial data; toggles never demote Owner",()=>{
  const owner=policy("leader",{uid:"owner-other",companyRole:"owner",userGrants:{canViewRevenue:false,canViewUnitPrice:false},memberGrants:{canViewRevenue:false,canViewUnitPrice:false}});
  check(true,owner.isOwner);check(true,owner.canViewRevenue);check(true,owner.canViewUnitPrice);
  const master=policy("leader",{uid:"master-uid",userGrants:{canViewRevenue:false},memberGrants:{canViewRevenue:false}});
  check(true,master.isOwner);check(true,master.canViewRevenue);check(true,master.canViewUnitPrice);
});
test("Existing explicitly granted revenue remains visible for member/leader; price remains separate",()=>{
  for(const role of ["member","leader"]){
    const revenue=policy(role,{userGrants:{canViewRevenue:true},memberGrants:{canViewRevenue:true}});
    check(true,revenue.canViewRevenue);check(false,revenue.canViewUnitPrice);
    const price=policy(role,{userGrants:{canViewRevenue:true,canViewUnitPrice:true},memberGrants:{canViewRevenue:true,canViewUnitPrice:true}});
    check(true,price.canViewUnitPrice);
    const revoked=policy(role,{userGrants:{canViewRevenue:true,canViewUnitPrice:true},memberGrants:{canViewRevenue:false,canViewUnitPrice:true}});
    check(false,revoked.canViewRevenue);check(false,revoked.canViewUnitPrice);
    const none=policy(role);check(false,none.canViewRevenue);check(false,none.canViewUnitPrice);
    const onlyPrice=policy(role,{userGrants:{canViewRevenue:false,canViewUnitPrice:true},memberGrants:{canViewRevenue:false,canViewUnitPrice:true}});
    check(false,onlyPrice.canViewUnitPrice);
  }
});
test("Company and disabled members are never authorized",()=>{
  const [u,m]=person("member");
  assert.throws(()=>approvedPolicy({...u,active:false},m,company,"sample"),/membership_denied/);
  assert.throws(()=>approvedPolicy(u,{...m,active:false},company,"sample"),/membership_denied/);
  assert.throws(()=>approvedPolicy(u,{...m,companyId:"other"},company,"sample"),/membership_denied/);
  assert.throws(()=>approvedPolicy(u,{...m,uid:"foreign"},company,"sample"),/membership_denied/);
  assert.throws(()=>approvedPolicy(u,m,{...company,active:false},"sample"),/membership_denied/);
});
test("Legacy member without companyId is accepted if users/company membership verified",()=>{
  const [u,m]=person("member");
  delete m.companyId;
  const p=approvedPolicy(u,m,company,"sample","2026-10-22");
  check(false,p.canViewRevenue);
});
const product={id:"p1",companyId:"company-A",name:"HTB CB5000円",active:true,sortOrder:4,revenue:40000,
  cashbackOptions:[0,5000],pricingOptions:[{cashback:0,revenuePerUnit:40000},{cashback:5000,revenuePerUnit:35000}]};
const record={id:"r1",companyId:"company-A",uid:"worker",date:"2026-10-22",teamId:"A",
 memberNameSnapshot:"worker",teamNameSnapshot:"A班",workLocation:"店",totalCount:2,totalRevenue:75000,
 reportStatus:"submitted",results:{
  "p1_CB0":{productId:"p1",productName:"HTB CB5000円",cashback:0,count:1,revenuePerUnit:40000},
  "p1_CB5000":{productId:"p1",productName:"HTB CB5000円",cashback:5000,count:1,revenuePerUnit:35000}
 }};
test("Unauthorized data projection exposes counts but NO amounts, pricing fields, CB labels or originals",()=>{
  const p=policy("leader");
  const [displayProduct]=safeProducts([product],p);
  const [displayRecord]=safeRecords([record],p);
  assert.equal(displayRecord.totalCount,2);
  check("submitted",displayRecord.reportStatus);
  assert.equal(Object.values(displayRecord.results).reduce((n,v)=>n+v.count,0),2);
  const serialized=JSON.stringify({displayProduct,displayRecord});
  for(const secret of ["40000","35000","75000","5000","cashback","revenuePerUnit","totalRevenue","pricingOptions","CB"]){
    assert.equal(serialized.includes(secret),false,"leaked "+secret);
  }
  assert.equal(displayProduct.name,"HTB");
  assert.deepEqual(Object.keys(displayRecord.results),["item_0","item_1"]);
});
test("Existing approved Leaders keep all dates for their CURRENT team; old teams stay hidden",()=>{
  const [u,m]=person("leader",{userGrants:{canViewRevenue:true},memberGrants:{canViewRevenue:true}});
  m.teamHistory=[{effectiveDate:"2026-10-15",fromTeamId:"B",toTeamId:"A"}];
  const p=approvedPolicy(u,m,company,"sample","2026-10-22");
  check(true,visibleMoney(p,record));
  const list=safeRecords([record,{...record,id:"r2",teamId:"B",totalRevenue:900000},
   {...record,id:"r3",date:"2026-10-14",totalRevenue:666666}],p);
  check(75000,list[0].totalRevenue);
  check(undefined,list[1].totalRevenue);
  // Legacy screen never date-gated Leader record access: preserve their view.
  check(666666,list[2].totalRevenue);
  const t=JSON.stringify(list);
  assert.equal(t.includes("35000"),false,"per-unit price leaked");
  assert.equal(t.includes("900000"),false,"old team leaked");
});
test("Granted ordinary member keeps historical team-by-date scope from users record",()=>{
  const [u,m]=person("member",{teamId:"A",userGrants:{canViewRevenue:true},memberGrants:{canViewRevenue:true}});
  u.teamHistory=[
    {effectiveDate:"2026-10-10",fromTeamId:"B",toTeamId:"A"},
    {effectiveDate:"2026-10-20",fromTeamId:"A",toTeamId:"B"},
    {effectiveDate:"2026-10-22",fromTeamId:"B",toTeamId:"A"}
  ];
  const p=approvedPolicy(u,m,company,"sample","2026-10-22");
  check(true,visibleMoney(p,{teamId:"B",date:"2026-10-09"}));
  check(true,visibleMoney(p,{teamId:"A",date:"2026-10-12"}));
  check(true,visibleMoney(p,{teamId:"B",date:"2026-10-21"}));
  check(true,visibleMoney(p,{teamId:"A",date:"2026-10-22"}));
  check(false,visibleMoney(p,{teamId:"B",date:"2026-10-22"}));
  check(false,visibleMoney(p,{teamId:"A",date:"2026-10-21"}));
  assert.deepEqual(safeGoals([{id:"goalB",teamId:"B",month:"2026-10",targetRevenue:100000},
    {id:"goalA",teamId:"A",month:"2026-10",targetRevenue:200000}],p).map(x=>x.id),["goalA"]);
});
test("Granted member without team history keeps current-team older revenue, never another team",()=>{
  const [u,m]=person("member",{userGrants:{canViewRevenue:true},memberGrants:{canViewRevenue:true}});
  const p=approvedPolicy(u,m,company,"sample","2026-10-22");
  check(true,visibleMoney(p,{teamId:"A",date:"2025-01-01"}));
  check(false,visibleMoney(p,{teamId:"B",date:"2025-01-01"}));
  check(false,visibleMoney({...p,canViewRevenue:false},{teamId:"A",date:"2025-01-01"}));
});
test("Revenue goal projection respects explicit permissions, team scope and Owner access",()=>{
  const g=[{id:"a",companyId:"company-A",teamId:"A",month:"2026-10",targetRevenue:100000},
    {id:"b",companyId:"company-A",teamId:"B",month:"2026-10",targetRevenue:900000}];
  assert.equal(safeGoals(g,policy("leader")).length,0);
  const authorized=policy("leader",{userGrants:{canViewRevenue:true},memberGrants:{canViewRevenue:true}});
  assert.deepEqual(safeGoals(g,authorized).map(x=>x.id),["a"]);
  assert.equal(safeGoals(g,policy("leader",{uid:"master-uid"})).length,2);
});
test("No unapproved methods, worker is disabled by default and denies missing JWT",async()=>{
  for(const method of ["POST","PUT","PATCH","DELETE"]){
    const response=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view",{method}),{});
    check(404,response.status);
  }
  const writeDisabled=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/count-record",{
    method:"POST",headers:{"Content-Type":"application/json"},body:"{}"
  }),{FIREBASE_PROJECT_ID:"sales-management-cc116",FINANCE_GATEWAY_ENABLED:"enabled"});
  check(503,writeDisabled.status);
  assert.equal((await writeDisabled.json()).error,"safe_write_not_released");
  const off=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view"),{FINANCE_GATEWAY_ENABLED:"disabled"});
  check(503,off.status);
  const unauthorized=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view"),
    {FINANCE_GATEWAY_ENABLED:"enabled",FIREBASE_PROJECT_ID:"sales-management-cc116"});
  check(401,unauthorized.status);
  const forbiddenOrigin=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view",{headers:{origin:"https://evil.example"}}),{FINANCE_GATEWAY_ENABLED:"enabled"});
  check(403,forbiddenOrigin.status);
  const preflight=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view",{method:"OPTIONS",headers:{origin:"https://nico-factory.web.app"}}),{});
  check(204,preflight.status);
});
test("JWT verification checks signature and core claims, not just user-supplied roles",async()=>{
  const keys=generateKeyPairSync("rsa",{modulusLength:2048});
  const kid="unit-test-key";
  const pub={...keys.publicKey.export({format:"jwk"}),kid,kty:"RSA",alg:"RS256",use:"sig"};
  const mock=async(url)=>new Response(JSON.stringify({keys:[pub]}),{status:200,headers:{"Cache-Control":"max-age=1200"}});
  const enc=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const now=Math.floor(Date.now()/1000);
  const claims={aud:"sales-management-cc116",iss:"https://securetoken.google.com/sales-management-cc116",
    sub:"worker",iat:now-10,exp:now+1000,auth_time:now-20,email:"employee@example.com",email_verified:true,
    companyRole:"owner",canViewRevenue:true};
  const signed=payload=>{
    const parts=enc({alg:"RS256",kid,typ:"JWT"})+"."+enc(payload);
    return parts+"."+sign("RSA-SHA256",Buffer.from(parts),keys.privateKey).toString("base64url");
  };
  const valid=signed(claims);
  assert.deepEqual(await verifiedToken(valid,mock),{uid:"worker",email:"employee@example.com"});
  const tampered=valid.split(".");tampered[1]=enc({...claims,sub:"master-uid"});
  await assert.rejects(verifiedToken(tampered.join("."),mock),/bad_token_signature/);
  await assert.rejects(verifiedToken(signed({...claims,aud:"attacker-project"}),mock),/invalid_claims/);
  await assert.rejects(verifiedToken(signed({...claims,email_verified:false}),mock),/invalid_claims/);
  await assert.rejects(verifiedToken(signed({...claims,exp:now-1}),mock),/invalid_claims/);
  await assert.rejects(verifiedToken(signed({...claims,auth_time:now+3600}),mock),/invalid_claims/);
});
