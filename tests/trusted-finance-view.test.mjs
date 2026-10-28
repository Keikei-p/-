import test from "node:test";
import assert from "node:assert/strict";
import {projectTrustedFinancialView} from "../security/trusted-finance-view.mjs";

const record={
 id:"r1",companyId:"companyA",uid:"user",date:"2026-10-28",teamId:"team1",
 totalRevenue:70000,
 results:{p1:{productId:"p1",count:2,revenuePerUnit:20000,cashback:10000},
          p2:{productId:"p2",count:1,revenuePerUnit:30000,cashback:0}},
 sensitiveCustomerData:{phone:"000000"},
};
const user={uid:"user",companyId:"companyA",active:true,companyRole:"member",accessKind:"internal"};
const member={uid:"user",companyId:"companyA",active:true,companyRole:"member",accessKind:"internal",canViewRevenue:false,canViewUnitPrice:false};
const principal={
 uid:"user",companyId:"companyA",user,member,
 firebaseIdTokenVerified:true,emailVerified:true,serverVerifiedOwner:false,
 allowedHistoricalTeamIds:["team1"]
};
function get(data=record,p=principal){return projectTrustedFinancialView({record:data,principal:p});}
function grant(grants){return {...principal,member:{...member,...grants}};}

test("not granted: no monetary data returns even with a valid same-company token",()=>{
 assert.throws(()=>get(),/denied or incomplete/);
});
test("revenue-only grant returns total money but never CB, per-unit, underlying results, or customer fields",()=>{
 const before=JSON.stringify(record);
 const view=get(record,grant({canViewRevenue:true}));
 assert.deepEqual(view,{recordId:"r1",date:"2026-10-28",teamId:"team1",companyId:"companyA",totalRevenue:70000});
 assert.equal(JSON.stringify(view).includes("10000"),false);
 assert.equal(JSON.stringify(view).includes("20000"),false);
 assert.equal(JSON.stringify(record),before);
});
test("unit-price-only grant exposes no aggregate revenue or cashback",()=>{
 const view=get(record,grant({canViewUnitPrice:true}));
 assert.deepEqual(view,{recordId:"r1",date:"2026-10-28",teamId:"team1",
  companyId:"companyA",unitPrices:[
    {productId:"p1",revenuePerUnit:20000},{productId:"p2",revenuePerUnit:30000}
  ]});
 assert.equal("totalRevenue" in view,false);
 assert.equal(JSON.stringify(view).includes("cashback"),false);
});
test("both explicit grants are independent and never give an entire raw Firestore record",()=>{
 const view=get(record,grant({canViewRevenue:true,canViewUnitPrice:true}));
 assert.equal(view.totalRevenue,70000);
 assert.equal(view.unitPrices.length,2);
 assert(!("results" in view));
 assert(!("sensitiveCustomerData" in view));
});
test("trusted owner sees finance even for old records without a team",()=>{
 const owner={...principal,
  user:{...user,companyRole:"owner"},member:{...member,companyRole:"owner"},
  serverVerifiedOwner:true,allowedHistoricalTeamIds:[]};
 const view=get({...record,teamId:null},owner);
 assert.equal(view.totalRevenue,70000);
 assert.equal(view.teamId,null);
 assert.equal(view.unitPrices.length,2);
});
test("asserted owner from client data is insufficient without both stored owner roles",()=>{
 const fake={...principal,serverVerifiedOwner:true,allowedHistoricalTeamIds:[]};
 assert.throws(()=>get(record,fake),/denied or incomplete/);
});
test("wrong company, other team, unverified or deactivated user/member denied",()=>{
 const bad=[
  {...principal,companyId:"other"},
  {...principal,allowedHistoricalTeamIds:["team2"]},
  {...principal,firebaseIdTokenVerified:false},
  {...principal,emailVerified:false},
  {...principal,user:{...user,active:false}},
  {...principal,member:{...member,active:false}},
  {...principal,user:{...user,uid:"someoneelse"}},
  {...principal,member:{...member,companyId:"other"}},
 ];
 for(const p of bad)
   assert.throws(()=>get(record,{...p,member:{...p.member,canViewRevenue:true}}),/denied or incomplete/);
});
test("missing or invalid saved price and revenue deny rather than silently estimate",()=>{
 assert.throws(()=>get({...record,totalRevenue:undefined},grant({canViewRevenue:true})),/denied or incomplete/);
 assert.throws(()=>get({...record,totalRevenue:2.5},grant({canViewRevenue:true})),/denied or incomplete/);
 assert.throws(()=>get({...record,results:{p1:{productId:"p1",count:1}}},grant({canViewUnitPrice:true})),/denied or incomplete/);
 assert.throws(()=>get({...record,results:{p1:{productId:"p1",revenuePerUnit:-200}}},grant({canViewUnitPrice:true})),/denied or incomplete/);
});
test("financial denial messages contain no customer IDs, company names or prices",()=>{
 try{get({...record,companyId:"private-other-company"},grant({canViewRevenue:true}));assert.fail();}
 catch(e){assert.equal(e.message,"Financial view denied or incomplete");}
});


test("partner leaders are denied all finance even with accidentally enabled flags",()=>{
 const partner={...principal,
  user:{...user,role:"leader",accessKind:"partner"},
  member:{...member,role:"leader",accessKind:"partner",
   canViewRevenue:true,canViewUnitPrice:true}};
 assert.throws(()=>get(record,partner),/Financial view denied/);
 for(const corrupt of [
   {...partner,user:{...user,accessKind:"internal"}},
   {...partner,member:{...member,accessKind:"internal",canViewRevenue:true}},
   {...principal,user:{...user,memberType:"partner"},
    member:{...member,canViewRevenue:true}},
   {...principal,user:{...user,accessKind:undefined},
    member:{...member,canViewRevenue:true}},
   {...principal,member:{...member,accessKind:undefined,canViewUnitPrice:true}},
   {...principal,user:{...user,accessKind:"unknown"},
    member:{...member,canViewRevenue:true}}
 ]){
  assert.throws(()=>get(record,corrupt),/Financial view denied/);
 }
});
test("revoked internal/partner label cannot be overridden by self-reported owner role",()=>{
 const bad={...principal,serverVerifiedOwner:true,
   user:{...user,companyRole:"owner",accessKind:"partner"},
   member:{...member,companyRole:"owner",accessKind:"partner",canViewRevenue:true,canViewUnitPrice:true}};
 assert.throws(()=>get(record,bad),/Financial view denied/);
});
