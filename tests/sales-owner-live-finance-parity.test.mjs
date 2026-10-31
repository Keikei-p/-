import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifyOwnerGatewayParity,inspectOwnerFinance}
 from "../tools/production/audit-sales-owner-finance-parity.mjs";
const cid="internal",owner="owner",month="2026-10";
const policy={companyId:cid,uid:owner,isOwner:true,isPartner:false,
 canViewRevenue:true,canViewUnitPrice:true,teamId:null};
const product={id:"nuro",companyId:cid,name:"NURO",
 revenue:40000,active:true,pricingOptions:[
  {cashback:0,revenuePerUnit:40000},
  {cashback:5000,revenuePerUnit:35000}
 ]};
const record={id:"historic_a",companyId:cid,uid:"staff",
 date:"2026-10-30",teamId:"team-a",totalCount:2,totalRevenue:70000,
 recordVersion:"2026-10-31T01:00:00.111111Z",
 results:{nuro_cb5000:{productId:"nuro",productName:"NURO",
  count:2,cashback:5000,revenuePerUnit:35000}}};
const goal={id:"revenue_goal",companyId:cid,teamId:"team-a",
 month,targetRevenue:250000};
const base=()=>({companyId:cid,policy,rawProducts:[structuredClone(product)],
 rawRecords:[structuredClone(record)],rawGoals:[structuredClone(goal)]});

test("Owner's old unit prices, cashback, sales and targets survive the new gateway projection",()=>{
 const result=verifyOwnerGatewayParity(base());
 assert.equal(result.productsChecked,1);
 assert.equal(result.recordsChecked,1);
 assert.equal(result.revenueGoalsChecked,1);
 assert.equal(result.ownerAmountsPreserved,true);
 assert.equal(result.sampleAvailable,true);
});
test("missing products or historical records never count as parity approval",()=>{
 assert.equal(verifyOwnerGatewayParity({...base(),rawRecords:[]}).sampleAvailable,false);
 assert.throws(()=>verifyOwnerGatewayParity({...base(),rawRecords:[
  {...record,companyId:"other"}]}),/FOREIGN_OR_BAD_RECORD/);
 assert.throws(()=>verifyOwnerGatewayParity({...base(),rawProducts:[
  {...product,id:"dup"},{...product,id:"dup"}]}),/DUPLICATE_PRODUCTS/);
});
test("Owner bypass, partner identity or revenue denial cannot pass as valid financial parity",()=>{
 for(const mutation of [
  {isOwner:false},{isPartner:true},{canViewRevenue:false},
  {canViewUnitPrice:false},{companyId:"foreign"}
 ]){
  assert.throws(()=>verifyOwnerGatewayParity({
   ...base(),policy:{...policy,...mutation}
  }),/OWNER_PERMISSIONS/);
 }
});
test("invalid monetary catalog rates must stop the audit, never invent a zero price",()=>{
 const x=base();
 x.rawProducts=[{...product,pricingOptions:[{cashback:0,revenuePerUnit:-5}]}];
 assert.throws(()=>verifyOwnerGatewayParity(x),/Invalid product pricing/);
});
function makeFakeDb({variant="base"}={}){
 const c={name:"Nico",ownerUid:owner,companyKind:"internal",active:true};
 const u={uid:owner,companyId:cid,role:"leader",companyRole:"owner",
  accessKind:"internal",memberType:"direct",active:true};
 const m={...u};
 const docs={
  companies:[{id:cid,...c}],
  "users/"+owner:[{id:owner,...u}],
  "companies/"+cid+"/members/"+owner:[{id:owner,...m}],
  products:[product],
  records:[record],
  revenueGoals:[goal]
 };
 if(variant==="missing-member-company")delete docs["companies/"+cid+"/members/"+owner][0].companyId;
 if(variant==="foreign-member-company")docs["companies/"+cid+"/members/"+owner][0].companyId="foreign";
 if(variant==="oversize-records"){
  docs.records=Array.from({length:201},(_,i)=>({...record,id:"r"+i}));
 }
 const calls=[];
 const asSnap=(list,limit)=>({size:Math.min(limit,list.length),
  docs:list.slice(0,limit).map(x=>({id:x.id,data:()=>({...x})}))});
 const query=(path,pred=()=>true,limit=Infinity)=>({
  where(field,op,value){
   assert.ok(op==="=="||op===">="||op==="<");
   return query(path,x=>pred(x)&&(
     op==="=="?x[field]===value:op===">="?x[field]>=value:x[field]<value
   ),limit);
  },
  limit(n){calls.push({path,limit:n});return query(path,pred,n)},
  collection(sub){return query(path+"/"+sub)},
  doc(id){return ref(path+"/"+id)},
  async get(){calls.push({path,read:true});return asSnap((docs[path]||[]).filter(pred),limit)}
 });
 const ref=path=>({
  collection:sub=>query(path+"/"+sub),
  async get(){calls.push({path,read:true});const value=docs[path]?.[0];
   return {exists:Boolean(value),data:()=>value?{...value}:undefined}}
 });
 return {db:{collection:path=>query(path)},calls};
}
test("actual read-only adapter verifies legacy missing membership companyId and returns no private values",async()=>{
 const {db,calls}=makeFakeDb({variant:"missing-member-company"});
 const result=await inspectOwnerFinance({db,asOf:new Date("2026-11-01T01:00:00+09:00")});
 assert.equal(result.month,month);
 assert.equal(result.ownerCompaniesChecked,1);
 assert.equal(result.recordsChecked,1);
 assert.equal(result.ownerFinanceSampleVerified,true);
 assert.equal(result.approvedForProductionCutover,false);
 assert.equal(result.partnerFinancialDenialVerified,false);
 assert.equal(result.legacyBrowserGatewayOnlyVerified,false);
 assert.equal(result.dataWrites,0);
 assert.ok(calls.every(x=>x.read||x.limit));
 assert.ok(calls.some(x=>x.path==="records"&&x.limit===201));
 assert.doesNotMatch(JSON.stringify(result),/40000|35000|70000|250000|staff|NURO/);
});
test("conflicting membership marker and incomplete scan fail without any Firestore writes",async()=>{
 const foreign=makeFakeDb({variant:"foreign-member-company"});
 await assert.rejects(inspectOwnerFinance({db:foreign.db,
  asOf:new Date("2026-11-01T01:00:00+09:00")}),/OWNER_PROFILE_INCONSISTENT/);
 const large=makeFakeDb({variant:"oversize-records"});
 await assert.rejects(inspectOwnerFinance({db:large.db,
  asOf:new Date("2026-11-01T01:00:00+09:00")}),/SCAN_LIMIT_RECORDS/);
});
test("live auditor never writes, publishes, disables Rules or logs financial amounts",()=>{
 const source=readFileSync(new URL("../tools/production/audit-sales-owner-finance-parity.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\b(?:setDoc|addDoc|updateDoc|deleteDoc|signInWith|runTransaction)\s*\(/);
 assert.doesNotMatch(source,/\b(?:db|tx|batch|docRef)\.(?:create|set|update|delete|runTransaction)\s*\(/);
 assert.doesNotMatch(source,/firebase deploy|wrangler deploy|--only firestore|console\.log\(.*totalRevenue/);
 assert.match(source,/NICO_OWNER_FINANCE_AUDIT_MODE!=="READ_ONLY"/);
 assert.match(source,/approvedForProductionCutover:false/);
});
