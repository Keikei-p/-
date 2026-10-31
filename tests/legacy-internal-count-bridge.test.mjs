import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {projectLegacyCountDay} from "../security/legacy-internal-count-bridge.mjs";
import {projectTrustedFinancialView} from "../security/trusted-finance-view.mjs";
const principal={
 uid:"owner",companyId:"direct",firebaseIdTokenVerified:true,emailVerified:true,
 serverMembershipVerified:true,serverVerifiedInternalCompany:true,
 company:{ownerUid:"owner",active:true},
 user:{uid:"owner",companyId:"direct",companyRole:"owner",active:true},
 member:{uid:"owner",companyId:"direct",companyRole:"owner",active:true,
  canViewRevenue:false,canViewUnitPrice:false}
};
const rec={id:"direct_owner_2026-10-30",companyId:"direct",uid:"owner",
 date:"2026-10-30",teamId:"t1",teamNameSnapshot:"第1班",
 memberNameSnapshot:"担当者",workLocation:"会場",results:{
  "nuro":{productId:"nuro",productName:"NURO",count:2,revenuePerUnit:14000,cashback:3000}
 },totalCount:2,totalRevenue:28000,
 customerName:"Private Name",createdAt:{seconds:1},updatedAt:{seconds:2}};
const product={id:"nuro",companyId:"direct",name:"NURO",active:true,
 revenue:14000,pricingOptions:[{cashback:3000,revenuePerUnit:14000}]};
const input=()=>({principal,day:"2026-10-30",records:[rec],products:[product],
 readTime:"2026-10-31T01:10:00Z"});
test("Legacy internal owner and direct member receive ONLY counts from legacy source, owner raw source unchanged",()=>{
 const before=JSON.stringify([rec,product]);
 const x=projectLegacyCountDay(input());
 assert.equal(x.records[0].totalCount,2);
 assert.equal(x.records[0].teamId,"t1");
 assert.equal(x.lines[0].count,2);
 assert.equal(x.products[0].name,"NURO");
 assert.equal(JSON.stringify([rec,product]),before);
 assert.equal(JSON.stringify(x).includes("14000"),false);
 assert.equal(JSON.stringify(x).includes("28000"),false);
 assert.equal(JSON.stringify(x).includes("3000"),false);
 for(const key of ["totalRevenue","revenue","revenuePerUnit","pricingOptions",
   "cashback","customerName","createdAt","updatedAt"]){
  assert.equal(JSON.stringify(x).includes('"'+key+'"'),false,key);
 }
 const member={...principal,uid:"member",user:{...principal.user,uid:"member",companyRole:"member"},
   member:{...principal.member,uid:"member",companyRole:"member"}};
 const y=projectLegacyCountDay({...input(),principal:member});
 assert.equal(y.records[0].totalCount,2);
});
test("Existing owner financial view is independent and still returns revenue and prices despite false flags",()=>{
 const owner={...principal,companyKind:"internal",serverVerifiedOwner:true,
 user:{...principal.user,accessKind:"internal"},
 member:{...principal.member,accessKind:"internal"},
 allowedHistoricalTeamIds:[]};
 const finance=projectTrustedFinancialView({principal:owner,record:rec});
 assert.equal(finance.totalRevenue,28000);
 assert.equal(finance.unitPrices[0].revenuePerUnit,14000);
 assert.equal("results" in finance,false);
});
test("Partner company and spoofed owner/partner markers cannot use count bridge",()=>{
 for(const wrong of [
  {...principal,company:{...principal.company,companyKind:"partner"}},
  {...principal,user:{...principal.user,memberType:"cooperator"}},
  {...principal,member:{...principal.member,accessKind:"partner"}},
  {...principal,serverVerifiedInternalCompany:false},
  {...principal,serverMembershipVerified:false},
  {...principal,uid:"someoneelse"},
  {...principal,user:{...principal.user,active:false}},
  {...principal,member:{...principal.member,companyId:"foreign"}}
 ]){
  assert.throws(()=>projectLegacyCountDay({...input(),principal:wrong}),/internal_count_bridge_denied/);
 }
});
test("Cross-company data, stale date, duplicate record and malformed amount-derived counts fail closed",()=>{
 for(const modified of [
  {...input(),records:[{...rec,companyId:"foreign"}]},
  {...input(),products:[{...product,companyId:"foreign"}]},
  {...input(),records:[{...rec,date:"2026-10-29"}]},
  {...input(),records:[rec,rec]},
  {...input(),records:[{...rec,totalCount:20}]},
  {...input(),records:[{...rec,results:{nuro:{count:-1}}}]},
  {...input(),products:[{...product,id:"NURO_CB10000"}]},
  {...input(),readTime:""},
  {...input(),day:"2026-02-30"}
 ])assert.throws(()=>projectLegacyCountDay(modified));
});
test("No source record/money mutations, Firestore SDK reads or auto deployments allowed in staged bridge",()=>{
 const source=fs.readFileSync(new URL("../security/legacy-internal-count-bridge.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/firebase deploy|\.update\(|\.delete\(|deleteDoc\s*\(|setDoc\s*\(|runTransaction\s*\(/);
 assert.doesNotMatch(source,/\bgetFirestore\s*\(|\bfetch\s*\(|collection\s*\(db,/);
});

test("legacy cashback-tier map keys preserve counts without publishing tier or repricing",()=>{
 const legacy={...rec,results:{
  "nuro__cb_0":{productId:"nuro",productName:"NURO",count:1,
     cashback:10000,revenuePerUnit:5000},
  "nuro__cb_1":{productId:"nuro",productName:"NURO",count:1,
     cashback:20000,revenuePerUnit:7000}
 },totalCount:2,totalRevenue:12000};
 const before=JSON.stringify(legacy);
 const out=projectLegacyCountDay({...input(),records:[legacy]});
 assert.deepEqual(out.lines.map(x=>x.count),[1,1]);
 assert(out.lines.every(x=>x.productId==="nuro"));
 assert.equal(out.records[0].totalCount,2);
 assert.equal(JSON.stringify(out).includes("cb_"),false);
 assert.equal(JSON.stringify(out).includes("cashback"),false);
 assert.equal(JSON.stringify(out).includes("12000"),false);
 assert.equal(JSON.stringify(legacy),before);
});
test("unclassified historical product key is never guessed as a new product",()=>{
 const broken={...rec,results:{"old_nuro__cb_5":{count:2,cashback:5000}}};
 assert.throws(()=>projectLegacyCountDay({...input(),records:[broken]}),
  /internal_count_bridge_denied/);
});
