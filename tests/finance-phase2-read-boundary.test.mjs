import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertFails,assertSucceeds} from "@firebase/rules-unit-testing";
import {doc,getDoc,setDoc} from "firebase/firestore";
import {modelOwnerOnlyFinanceRules} from "../security/finance-phase2-read-boundary.mjs";

const baseRules=readFileSync(new URL("../security/firestore.phase1.rules",import.meta.url),"utf8");
const candidate=modelOwnerOnlyFinanceRules(baseRules);
const prodFirebaseConfig=JSON.parse(readFileSync(new URL("../firebase.json",import.meta.url),"utf8"));
const company="finance-stage2-a",other="finance-stage2-b";
let env;
const dbFor=uid=>env.authenticatedContext(uid,{email:uid+"@example.test",email_verified:true}).firestore();

before(async()=>{
 env=await initializeTestEnvironment({projectId:"demo-sales-public-boundary",firestore:{rules:candidate}});
 await env.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   for(const [cid,uid,role] of [
     [company,"owner","owner"],
     [company,"partner","member"],
     [other,"outsider","member"]
   ]){
     await setDoc(doc(db,"companies",cid),{name:"TEST",ownerUid:cid===company?"owner":"other-owner",
       masterUid:cid===company?"owner":"other-owner",active:true});
     await setDoc(doc(db,"users",uid),{uid,companyId:cid,role:"leader",companyRole:role,active:true,teamId:"t1"});
     await setDoc(doc(db,"companies",cid,"members",uid),
       {uid,companyId:cid,role:"leader",companyRole:role,active:true,teamId:"t1",canViewRevenue:false,canViewUnitPrice:false});
   }
   await setDoc(doc(db,"records","legacy"),{
     companyId:company,uid:"partner",date:"2026-10-28",teamId:"t1",totalCount:1,
     totalRevenue:25000,results:{p:{count:1,revenuePerUnit:25000}}
   });
   await setDoc(doc(db,"products","legacy"),{companyId:company,name:"商材",revenue:25000,pricingOptions:[]});
   await setDoc(doc(db,"recordCorrections","legacy"),{companyId:company,recordId:"legacy",
     before:{totalRevenue:25000},after:{totalRevenue:35000}});
   await setDoc(doc(db,"publicRecords","safe"),{companyId:company,sourceId:"safe",uid:"partner",
     date:"2026-10-28",teamId:"t1",totalCount:1,reportStatus:"submitted",
     memberNameSnapshot:"担当者",teamNameSnapshot:"一班",workLocation:"会場"});
 });
});
after(async()=>{if(env)await env.cleanup();});

test("phase2 candidate is emulator-only and never wired to production firebase.json",()=>{
 assert.equal(prodFirebaseConfig.firestore.rules,"firestore.rules");
 assert.notEqual(candidate,baseRules);
 for(const name of ["records","products","recordCorrections"]){
   const begin=candidate.indexOf("match /"+name+"/{");
   assert(begin>=0);
   const rule=candidate.slice(begin,candidate.indexOf("allow create:",begin));
   assert.match(rule,/isCompanyMaster\(resource\.data\.companyId\)/);
   assert.match(rule,/isCompanyOwner\(resource\.data\.companyId\)/);
   assert.doesNotMatch(rule,/&& sameCompany\(resource\.data\.companyId\);/);
 }
});

test("same-company partner is denied all three money-bearing original collections",async()=>{
 const db=dbFor("partner");
 for(const collection of ["records","products","recordCorrections"])
   await assertFails(getDoc(doc(db,collection,"legacy")));
});

test("same-company owner can read all original documents after rules closure",async()=>{
 const db=dbFor("owner");
 for(const collection of ["records","products","recordCorrections"])
   await assertSucceeds(getDoc(doc(db,collection,"legacy")));
});

test("partner retains access to sanitized same-team counts, not financial source",async()=>{
 const db=dbFor("partner");
 const snapshot=await assertSucceeds(getDoc(doc(db,"publicRecords","safe")));
 assert.equal(snapshot.data().totalCount,1);
 assert.equal("totalRevenue" in snapshot.data(),false);
});

test("other company cannot read original financial data or public counts",async()=>{
 const db=dbFor("outsider");
 for(const collection of ["records","products","recordCorrections"])
   await assertFails(getDoc(doc(db,collection,"legacy")));
 await assertFails(getDoc(doc(db,"publicRecords","safe")));
});

test("phase2 model fails closed if source finance rules are unexpectedly changed",()=>{
 const broken=baseRules.replace(
   /match \/products\/\{productId\} \{\s*allow read: if resource\.data\.companyId != null\s*&& sameCompany\(resource\.data\.companyId\);/,
   "match /products/{productId} { allow read: if true;"
 );
 assert.notEqual(broken,baseRules);
 assert.throws(()=>modelOwnerOnlyFinanceRules(broken),/Unexpected legacy finance rule/);
});
