import test,{before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,getDoc,setDoc,collection,getDocsFromServer,query,where} from "firebase/firestore";
import {buildPartnerFinanceLockCandidate} from "../security/partner-company-finance-lock.mjs";

if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error("EMULATOR REQUIRED: no production Firebase allowed");
const original=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const candidate=buildPartnerFinanceLockCandidate(original);
let env;
const demo="demo-partner-finance-lock";
const dbFor=uid=>env.authenticatedContext(uid,{
 email:uid+"@example.test",email_verified:true
}).firestore();
before(async()=>{env=await initializeTestEnvironment({
 projectId:demo,firestore:{rules:candidate}
});});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  for(const [companyId,ownerId,kind] of [
   ["hub","hubOwner","internal"],["partner","partnerOwner","partner"]
  ]){
   await setDoc(doc(db,"companies",companyId),{
    name:companyId,ownerUid:ownerId,masterUid:ownerId,
    active:true,companyKind:kind
   });
   const member={uid:ownerId,name:ownerId,companyId,companyRole:"owner",
    role:"leader",teamId:"t1",active:true,
    accessKind:kind==="partner"?"partner":"internal",
    canViewRevenue:true,canViewUnitPrice:true};
   await setDoc(doc(db,"users",ownerId),member);
   await setDoc(doc(db,"companies",companyId,"members",ownerId),member);
   await setDoc(doc(db,"teams",companyId+"Team"),{
    companyId,name:"班",active:true});
   await setDoc(doc(db,"products",companyId+"Product"),{
    companyId,name:"商材",revenue:25000,active:true});
   await setDoc(doc(db,"records",companyId+"Record"),{
    companyId,uid:ownerId,date:"2026-10-29",teamId:"t1",
    totalCount:1,totalRevenue:25000,results:{a:{count:1,revenuePerUnit:25000}}
   });
   await setDoc(doc(db,"recordCorrections",companyId+"Correction"),{
    companyId,recordId:companyId+"Record",recordDate:"2026-10-29",
    before:{totalRevenue:10000},after:{totalRevenue:25000}
   });
   await setDoc(doc(db,"revenueGoals",companyId+"Goal"),{
    companyId,teamId:"t1",month:"2026-10",targetRevenue:100000
   });
   await setDoc(doc(db,"goals",companyId+"CountGoal"),{
    companyId,teamId:"t1",month:"2026-10",targets:{nu:10}
   });
  }
 });
});
after(async()=>{await env?.cleanup();});
test("all four financial source collections denied even to PARTNER owner with both grants true",async()=>{
 const db=dbFor("partnerOwner");
 for(const [c,id] of [
  ["products","partnerProduct"],["records","partnerRecord"],
  ["recordCorrections","partnerCorrection"],["revenueGoals","partnerGoal"]
 ]){
  await assertFails(getDoc(doc(db,c,id)));
 }
 await assertFails(getDocsFromServer(query(collection(db,"products"),
  where("companyId","==","partner"))));
});
test("existing INTERNAL company owner still reads all financial collections",async()=>{
 const db=dbFor("hubOwner");
 for(const [c,id] of [
  ["products","hubProduct"],["records","hubRecord"],
  ["recordCorrections","hubCorrection"],["revenueGoals","hubGoal"]
 ]){
  assert((await assertSucceeds(getDoc(doc(db,c,id)))).exists());
 }
});
test("partner may still read existing COUNT goals and own company profile",async()=>{
 const db=dbFor("partnerOwner");
 assert((await assertSucceeds(getDoc(doc(db,"goals","partnerCountGoal")))).exists());
 assert((await assertSucceeds(getDoc(doc(db,"companies","partner")))).exists());
});
test("partner owner cannot create raw monetary products or corrections",async()=>{
 const db=dbFor("partnerOwner");
 await assertFails(setDoc(doc(db,"products","new-partner-money"),{
  companyId:"partner",name:"契約",revenue:50000,
  cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:50000}],
  sortOrder:0,active:true
 }));
 await assertFails(setDoc(doc(db,"recordCorrections","new-partner-money"),{
  companyId:"partner",recordId:"other",recordDate:"2026-10-29",
  before:{totalRevenue:0},after:{totalRevenue:50000},
  changedByUid:"partnerOwner"
 }));
});
test("non-financial and historical Rules stay byte-for-byte unchanged",()=>{
 for(const marker of ["match /users/{userId}","match /companies/{companyId}",
   "match /teams/{teamId}","match /goals/{goalId}"]){
  const oldStart=original.indexOf(marker),newStart=candidate.indexOf(marker);
  assert(oldStart>=0&&newStart>=0);
  const next=x=>x.indexOf("\n    match /",x.indexOf(marker)+marker.length);
  const oldEnd=next(original),newEnd=next(candidate);
  assert.equal(original.slice(oldStart,oldEnd<0?undefined:oldEnd),
    candidate.slice(newStart,newEnd<0?undefined:newEnd));
 }
});
