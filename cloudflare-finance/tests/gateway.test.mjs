import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {generateKeyPairSync, sign} from "node:crypto";
import worker,{approvedPolicy,safeProducts,safeRecords,safeGoals,safePartnerMembers,visibleMoney,verifiedToken,docData} from "../src/index.js";

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
test("External partner receives ONLY own-team counts and never financial details even if finance flags are true",()=>{
  const partner=policy("leader",{uid:"partner",userGrants:{
    accessKind:"partner",canViewRevenue:true,canViewUnitPrice:true
  },memberGrants:{accessKind:"partner",canViewRevenue:true,canViewUnitPrice:true}});
  assert.equal(partner.isPartner,true);
  assert.equal(partner.isOwner,false);
  assert.equal(partner.canViewRevenue,false);
  assert.equal(partner.canViewUnitPrice,false);
  const products=[{id:"p1",companyId:"company-A",name:"電気 CB5000円",revenue:10000,
    pricingOptions:[{cashback:5000,revenuePerUnit:10000}],active:true}];
  const records=[
    {id:"team-A-record",companyId:"company-A",teamId:"A",uid:"staff-A",
      memberNameSnapshot:"A担当",date:"2026-10-22",totalCount:2,totalRevenue:20000,
      results:{p1__cb_5000:{productId:"p1",productName:"電気 CB5000円",
        cashback:5000,revenuePerUnit:10000,count:2}}},
    {id:"other-team-secret",companyId:"company-A",teamId:"B",uid:"staff-B",
      memberNameSnapshot:"他班秘匿",date:"2026-10-22",totalCount:99,totalRevenue:990000,
      results:{p1__cb_5000:{productId:"p1",cashback:5000,revenuePerUnit:10000,count:99}}}
  ];
  const view={products:safeProducts(products,partner),records:safeRecords(records,partner,products),
    goals:safeGoals([{id:"goal-1",teamId:"A",targetRevenue:500000}],partner)};
  // CB 5000 is intentionally visible to partners; sales price is not.
  assert.deepEqual(view.products[0].cashbackPlans,[{planId:"cb_5000",cashback:5000}]);
  assert.equal(view.records[0].results.item_0.planId,"cb_5000");
  assert.equal(view.records.length,1);
  assert.equal(view.records[0].uid,"staff-A");
  assert.equal(view.records[0].totalCount,2);
  assert.deepEqual(view.goals,[]);
  const output=JSON.stringify(view);
  for(const secret of ["totalRevenue","revenuePerUnit","canViewRevenue","990000","other-team-secret","staff-B","他班秘匿","10000","20000"]){
    assert.equal(output.includes(secret),false,"leaked "+secret);
  }
  // Either document being stamped is enough to DENY finance while onboarding.
  const oneSided=policy("leader",{userGrants:{accessKind:"partner",canViewRevenue:true},
    memberGrants:{canViewRevenue:true}});
  assert.equal(oneSided.isPartner,true);
  assert.equal(oneSided.canViewRevenue,false);
  assert.throws(()=>policy("leader",{userGrants:{accessKind:"partner",teamId:"B"},
    memberGrants:{accessKind:"partner"}}),/partner_assignment_invalid/);
  assert.throws(()=>policy("leader",{uid:"master-uid",
    userGrants:{accessKind:"partner"},memberGrants:{accessKind:"partner"}}),/partner_assignment_invalid/);
});
test("registered partner-company Owner manages its company's counts without any finance or unit prices",()=>{
  const companyId="partner-company",uid="partner-owner";
  const identity={uid,companyId,companyRole:"owner",role:"leader",
    teamId:null,active:true,memberType:"cooperator",accessKind:"partner",
    canViewRevenue:false,canViewUnitPrice:false};
  const tenant={id:companyId,companyKind:"partner",hubCompanyId:"hub",
    ownerUid:uid,masterUid:uid,active:true};
  const p=approvedPolicy(identity,{...identity},tenant,uid,"2026-11-01");
  assert.equal(p.isPartner,true);
  assert.equal(p.isPartnerCompanyOwner,true);
  assert.equal(p.isOwner,true);
  assert.equal(p.teamId,null);
  assert.equal(p.canViewRevenue,false);
  assert.equal(p.canViewUnitPrice,false);
  const rawProducts=[{id:"nuro",companyId,name:"NURO",revenue:40000,
    pricingOptions:[{cashback:0,revenuePerUnit:40000}],active:true}];
  const rawRecords=[
    {id:"a",companyId,uid:"staff-a",teamId:"A",totalCount:2,totalRevenue:80000,
      results:{nuro__cb_0:{productId:"nuro",productName:"NURO",
        count:2,cashback:0,revenuePerUnit:40000}}},
    {id:"b",companyId,uid:"staff-b",teamId:"B",totalCount:1,totalRevenue:40000,
      results:{nuro__cb_0:{productId:"nuro",productName:"NURO",
        count:1,cashback:0,revenuePerUnit:40000}}},
    {id:"foreign",companyId:"other",uid:"foreign-person",teamId:"A",totalCount:40,
      totalRevenue:1600000,results:{}}
  ];
  const view={
    products:safeProducts(rawProducts,p),
    records:safeRecords(rawRecords,p,rawProducts),
    revenueGoals:safeGoals([{id:"goal",companyId,targetRevenue:900000}],p),
    members:safePartnerMembers([
      {uid:"staff-a",companyId,teamId:"A",name:"A担当",active:true},
      {uid:"staff-b",companyId,teamId:"B",name:"B担当",active:true},
      {uid:"foreign-person",companyId:"other",teamId:"A",name:"他社秘密",active:true}
    ],p)
  };
  assert.deepEqual(view.records.map(x=>x.id),["a","b"]);
  assert.deepEqual(view.members.map(x=>x.uid),["staff-a","staff-b"]);
  assert.deepEqual(view.revenueGoals,[]);
  const json=JSON.stringify(view);
  for(const secret of ["totalRevenue","revenuePerUnit","pricingOptions",
    "80000","40000","900000","1600000","foreign-person","他社秘密"])
    assert.equal(json.includes(secret),false,"partner-company Owner leaked "+secret);
  assert.equal(view.products[0].cashbackPlans[0].cashback,0);
});
test("forged partner-Owner privileges never bypass mandatory tenant and dual-document markers",()=>{
  const uid="partner-owner",cid="partner-company";
  const identity={uid,companyId:cid,companyRole:"owner",role:"leader",
    teamId:null,active:true,accessKind:"partner",memberType:"cooperator",
    canViewRevenue:false,canViewUnitPrice:false};
  const tenant={id:cid,companyKind:"partner",hubCompanyId:"hub",
    ownerUid:uid,masterUid:uid,active:true};
  const mutations=[
    [u=>({...u,accessKind:"internal"}),m=>m,c=>c],
    [u=>u,m=>({...m,memberType:"internal"}),c=>c],
    [u=>u,m=>m,c=>({...c,companyKind:"internal"})],
    [u=>u,m=>m,c=>({...c,ownerUid:"someone-else"})],
    [u=>u,m=>m,c=>({...c,masterUid:"someone-else"})],
    [u=>u,m=>m,c=>({...c,hubCompanyId:cid})],
    [u=>({...u,teamId:"other"}),m=>m,c=>c],
    [u=>({...u,canViewRevenue:true}),m=>m,c=>c],
    [u=>u,m=>({...m,canViewUnitPrice:true}),c=>c]
  ];
  for(const [u,m,c] of mutations){
    assert.throws(()=>approvedPolicy(u(identity),m(identity),c(tenant),uid),
      /partner_assignment_invalid/);
  }
  // In a genuine internal company an Owner never loses financial access.
  const internal=approvedPolicy({...identity,accessKind:"internal",memberType:"direct"},
    {...identity,accessKind:"internal",memberType:"direct"},
    {id:cid,companyKind:"internal",ownerUid:uid,masterUid:uid,active:true},uid);
  assert.equal(internal.canViewRevenue,true);
  assert.equal(internal.canViewUnitPrice,true);
});
test("partner or cooperator marker on company/user/member denies even a misconfigured Master",()=>{
  const [user,member]=person("leader",{uid:"master-uid",companyRole:"owner",
    userGrants:{canViewRevenue:true,canViewUnitPrice:true},
    memberGrants:{canViewRevenue:true,canViewUnitPrice:true}});
  // Classified direct/internal owners keep existing revenue access.
  const direct=approvedPolicy({...user,accessKind:"internal"},
    {...member,accessKind:"internal"},
    {...company,companyKind:"internal"},"master-uid","2026-10-30");
  assert.equal(direct.canViewRevenue,true);
  assert.equal(direct.canViewUnitPrice,true);
  for(const variation of [
    [{accessKind:"cooperator"},{},{}],
    [{},{accessKind:"cooperator"},{}],
    [{memberType:"cooperator"},{},{}],
    [{},{memberType:"partner"},{}],
    [{},{},{companyKind:"partner"}],
    [{},{},{companyKind:"cooperator"}],
    [{accessKind:"partner"},{},{}]
  ]){
    const [u,m,c]=variation;
    assert.throws(()=>approvedPolicy({...user,...u},{...member,...m},
      {...company,...c},"master-uid","2026-10-30"),/partner_assignment_invalid/);
  }
});
test("unknown company/access markers cannot get raw finance by pretending to be internal",()=>{
  const [user,member]=person("leader",{uid:"master-uid",companyRole:"owner"});
  for(const [u,m,c] of [
    [{accessKind:"affiliate"},{},{}],
    [{},{accessKind:"vendor"},{}],
    [{},{},{companyKind:"external"}],
    [{},{},{companyKind:"test"}]
  ]){
    assert.throws(()=>approvedPolicy({...user,...u},{...member,...m},
      {...company,...c},"master-uid"),/membership_kind_unknown/);
  }
});
test("Partner roster contains ONLY the current team's active names and no contact or finance fields",()=>{
  const p=policy("leader",{uid:"partner",userGrants:{accessKind:"partner"},
    memberGrants:{accessKind:"partner"}});
  const raw=[
    {uid:"a1",name:"山田",companyId:"company-A",teamId:"A",email:"secret@example.test",revenue:1234,active:true},
    {uid:"b1",name:"別班",companyId:"company-A",teamId:"B",email:"other@example.test",active:true},
    {uid:"inactive",name:"停止済",companyId:"company-A",teamId:"A",active:false},
    {uid:"foreign",name:"他社",companyId:"company-B",teamId:"A",active:true},
    {uid:"managed",name:"代理登録",teamId:"A",active:true}
  ];
  const selected=safePartnerMembers(raw,p);
  assert.deepEqual(selected.map(x=>x.uid).sort(),["a1","managed"]);
  assert.equal(JSON.stringify(selected).includes("secret@example.test"),false);
  assert.equal(JSON.stringify(selected).includes("1234"),false);
  assert.equal(JSON.stringify(selected).includes("b1"),false);
  assert.throws(()=>safePartnerMembers(raw,policy("leader")),/partner_only/);
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
test("Unapproved product labels mask yen and half/fullwidth cashback variants",()=>{
  const user=policy("member");
  for(const [name,safe] of [
    ["SIM ＣＢ５０００円","SIM"],["電気 単価30,000円","電気"],
    ["光 ¥15,000","光"],["ネット 3万円","ネット"]
  ]){
    assert.equal(safeProducts([{...product,name}],user)[0].name,safe);
  }
});
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
test("Owner count overview and partner sync require release and verified identity",async()=>{
 for(const path of ["/v1/owner-count-overview","/v1/partner-sync"]){
  const u="https://sales-finance-gateway.example"+path;
  let r=await worker.fetch(new Request(u),{FINANCE_GATEWAY_ENABLED:"disabled"});
  assert.equal(r.status,503);
  r=await worker.fetch(new Request(u),{FINANCE_GATEWAY_ENABLED:"enabled",
    FIREBASE_PROJECT_ID:"sales-management-cc116"});
  assert.equal(r.status,503);
  r=await worker.fetch(new Request(u),{FINANCE_GATEWAY_ENABLED:"enabled",
    FINANCE_COST_APPROVAL:"OWNER_APPROVED_BLAZE_COSTS",
    FIREBASE_PROJECT_ID:"sales-management-cc116"});
  assert.equal(r.status,401);
 }
 const activation=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/partner-activate",{
  method:"POST",headers:{"Content-Type":"application/json"},body:'{"uid":"external"}'
 }),{FINANCE_GATEWAY_ENABLED:"enabled",FINANCE_WRITE_ENABLED:"enabled",
    FINANCE_WRITE_APPROVAL:"DUAL_HOST_BACKUP_VERIFIED",
    FINANCE_COST_APPROVAL:"OWNER_APPROVED_BLAZE_COSTS",
    FIREBASE_PROJECT_ID:"sales-management-cc116"});
 assert.equal(activation.status,503);
 assert.equal((await activation.json()).error,"partner_activation_not_released");
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
  const unapprovedRead=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view"),
    {FINANCE_GATEWAY_ENABLED:"enabled",FIREBASE_PROJECT_ID:"sales-management-cc116"});
  check(503,unapprovedRead.status);
  assert.equal((await unapprovedRead.json()).error,"billing_not_approved");
  const unauthorized=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view"),
    {FINANCE_GATEWAY_ENABLED:"enabled",FINANCE_COST_APPROVAL:"OWNER_APPROVED_BLAZE_COSTS",
      FIREBASE_PROJECT_ID:"sales-management-cc116"});
  check(401,unauthorized.status);
  const forbiddenOrigin=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view",{headers:{origin:"https://evil.example"}}),{FINANCE_GATEWAY_ENABLED:"enabled"});
  check(403,forbiddenOrigin.status);
  const preflight=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/financial-view",{method:"OPTIONS",headers:{origin:"https://nico-factory.web.app"}}),{});
  check(204,preflight.status);
  assert.ok(preflight.headers.get("access-control-allow-methods")?.split(",").map(x=>x.trim()).includes("POST"));
});

test("NICO official URL can preflight count POST; legacy and other origins cannot",async()=>{
  for(const origin of ["https://nico-factory.web.app"]){
    const preflight=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/count-record",{
      method:"OPTIONS",
      headers:{origin,"access-control-request-method":"POST",
        "access-control-request-headers":"authorization, content-type"}
    }),{FINANCE_GATEWAY_ENABLED:"disabled",FINANCE_WRITE_ENABLED:"disabled"});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get("access-control-allow-origin"),origin);
    assert.ok(preflight.headers.get("access-control-allow-methods")?.split(",").map(x=>x.trim()).includes("POST"));
    assert.match(preflight.headers.get("access-control-allow-headers"),/Authorization/);
    // A successful preflight DOES NOT enable the write endpoint.
    const blocked=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/count-record",{
      method:"POST",headers:{origin,"Content-Type":"application/json"},
      body:JSON.stringify({uid:"example",entries:[]})
    }),{FINANCE_GATEWAY_ENABLED:"disabled",FINANCE_WRITE_ENABLED:"disabled"});
    assert.equal(blocked.status,503);
    assert.equal((await blocked.json()).error,"safe_write_not_released");
  }
  for(const forbidden of ["https://keikei-p.github.io","https://attacker.example"]){
    const rejected=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/count-record",{
      method:"OPTIONS",headers:{origin:forbidden,"access-control-request-method":"POST"}}),{});
    assert.equal(rejected.status,403);
    assert.equal(rejected.headers.get("access-control-allow-origin"),null);
  }
  const evil=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/count-record",{
    method:"OPTIONS",headers:{origin:"https://attacker.example",
      "access-control-request-method":"POST"}}),{});
  assert.equal(evil.status,403);
  assert.equal(evil.headers.get("access-control-allow-origin"),null);
});

test("Blaze cost approval cannot be bypassed by enabling only the API and backup flags",async()=>{
  const request=()=>new Request("https://sales-finance-gateway.example/v1/count-record",{
    method:"POST",headers:{origin:"https://nico-factory.web.app","Content-Type":"application/json"},
    body:"{}"
  });
  for(const value of [undefined,"NOT_APPROVED","I_VERIFIED_SPARK_NO_BILLING",true]){
    const response=await worker.fetch(request(),{
      FIREBASE_PROJECT_ID:"sales-management-cc116",
      FINANCE_GATEWAY_ENABLED:"enabled",
      FINANCE_WRITE_ENABLED:"enabled",
      FINANCE_WRITE_APPROVAL:"DUAL_HOST_BACKUP_VERIFIED",
      FINANCE_COST_APPROVAL:value
    });
    assert.equal(response.status,503);
    assert.equal((await response.json()).error,"safe_write_not_released");
  }
  const approved=await worker.fetch(request(),{
    FIREBASE_PROJECT_ID:"sales-management-cc116",
    FINANCE_GATEWAY_ENABLED:"enabled",
    FINANCE_WRITE_ENABLED:"enabled",
    FINANCE_WRITE_APPROVAL:"DUAL_HOST_BACKUP_VERIFIED",
    FINANCE_COST_APPROVAL:"OWNER_APPROVED_BLAZE_COSTS"
  });
  // Only once ALL release gates are approved does it begin authentication.
  assert.equal(approved.status,401);
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

test("Price-granted Leader cannot learn old cashback plan IDs from other team record keys",()=>{
  const allowed=policy("leader",{
    userGrants:{canViewRevenue:true,canViewUnitPrice:true},
    memberGrants:{canViewRevenue:true,canViewUnitPrice:true}
  });
  const raw={...record,id:"secret-team-record",teamId:"B",totalRevenue:900000,results:{
    "p1_CB5000":{productId:"p1",productName:"HTB CB5000円",
      count:1,cashback:5000,revenuePerUnit:900000}
  }};
  const [safe]=safeRecords([raw],allowed,[product]);
  const data=JSON.stringify(safe);
  assert.equal(safe.totalRevenue,undefined);
  for(const token of ["5000","900000","CB","cashback","revenuePerUnit"]){
    assert.equal(data.includes(token),false,"cross-team financial leak "+token);
  }
  assert.deepEqual(Object.keys(safe.results),["item_0"]);
});

test("Firestore updateTime metadata passes unchanged to editor's optimistic locking version",()=>{
  const version="2026-10-22T01:02:03.123456Z";
  const raw={name:"projects/sales-management-cc116/databases/(default)/documents/records/recA",
    updateTime:version,fields:{
      companyId:{stringValue:"company-A"},uid:{stringValue:"worker"},teamId:{stringValue:"A"},
      date:{stringValue:"2026-10-22"},totalCount:{integerValue:"3"},
      results:{mapValue:{fields:{sim:{mapValue:{fields:{
        productId:{stringValue:"sim"},productName:{stringValue:"SIM"},
        count:{integerValue:"3"},cashback:{integerValue:"0"},
        revenuePerUnit:{integerValue:"13000"}
      }}}}}}
    }};
  const record=docData(raw);
  assert.equal(record.recordVersion,version);
  const safe=safeRecords([record],policy("member"))[0];
  assert.equal(safe.recordVersion,version);
  assert.equal(safe.totalCount,3);
  assert.equal(safe.totalRevenue,undefined);
});

test("Legacy CB products show the same plans to permitted Owner, while staff get opaque plan IDs",()=>{
  const legacy={id:"legacy",companyId:"company-A",name:"HTB",active:true,revenue:12000,
    cashbackOptions:[5000,2000]};
  const granted=policy("member",{
    userGrants:{canViewRevenue:true,canViewUnitPrice:true},
    memberGrants:{canViewRevenue:true,canViewUnitPrice:true}
  });
  const [full]=safeProducts([legacy],granted);
  assert.deepEqual(full.planIds,["plan_0","plan_1","plan_2"]);
  assert.deepEqual(full.pricingOptions,[
    {cashback:0,revenuePerUnit:12000},
    {cashback:2000,revenuePerUnit:null},
    {cashback:5000,revenuePerUnit:null}
  ]);
  const [masked]=safeProducts([legacy],policy("member"));
  assert.deepEqual(masked.planIds,full.planIds);
  assert.equal(Object.hasOwn(masked,"revenue"),false);
  assert.equal(Object.hasOwn(masked,"pricingOptions"),false);
});

test("Conflicting old user/member grants are flagged, never automatically widened or rewritten",()=>{
  const [u,m]=person("leader",{
    userGrants:{canViewRevenue:true,canViewUnitPrice:true},
    memberGrants:{canViewRevenue:false,canViewUnitPrice:true}
  });
  const p=approvedPolicy(u,m,company,"sample","2026-10-22");
  assert.equal(p.needsPermissionReview,true);
  assert.equal(p.canViewRevenue,false);
  assert.equal(p.canViewUnitPrice,false);
  const [u2,m2]=person("member",{
    userGrants:{canViewRevenue:false,canViewUnitPrice:false},
    memberGrants:{canViewRevenue:true,canViewUnitPrice:false}
  });
  const p2=approvedPolicy(u2,m2,company,"sample","2026-10-22");
  assert.equal(p2.needsPermissionReview,true);
  assert.equal(p2.canViewRevenue,false);
  assert.equal(approvedPolicy(...person("member"),company,"sample","2026-10-22").needsPermissionReview,false);
});

test("enabled financial views require one valid month and never accept a user-supplied company or UID",async()=>{
 const env={FIREBASE_PROJECT_ID:"sales-management-cc116",
   FINANCE_GATEWAY_ENABLED:"enabled",FINANCE_COST_APPROVAL:"OWNER_APPROVED_BLAZE_COSTS"};
 for(const q of ["","?month=2026-00","?month=2026-13","?month=2026-1",
   "?month=2026-10&month=2026-09","?month=2026-10&companyId=other",
   "?month=2026-10&uid=forged"]){
   for(const route of ["financial-view","partner-dashboard"]){
     const response=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/"+
       route+q,{headers:{authorization:"Bearer invalid-fixture"}}),env);
     assert.equal(response.status,400,route+q);
     assert.equal((await response.json()).error,"invalid_month");
   }
 }
 for(const route of ["financial-view","partner-dashboard"]){
   const response=await worker.fetch(new Request("https://sales-finance-gateway.example/v1/"+
     route+"?month=2026-10"),env);
   assert.equal(response.status,401,"valid month checks authorization next");
 }
});
test("actual protected finance handler routes every approved month through bounded snapshot pages",()=>{
 const src=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 const service=src.slice(src.indexOf("async function financeView("),src.indexOf("export default"));
 assert.match(service,/month\?firestoreMonthlyRecords\(env,policy\.companyId,month,fetcher\)/);
 assert.match(service,/month\|\|y\+"-"\+m/);
 const handler=src.slice(src.indexOf('const partnerOnly=url.pathname==="/v1/partner-dashboard"'));
 assert.match(handler,/validInternalRankMonthQuery\(url\.searchParams\)/);
 assert.match(handler,/month:url\.searchParams\.get\("month"\)/);
});
