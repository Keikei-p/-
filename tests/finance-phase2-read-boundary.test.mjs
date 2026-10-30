import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertFails,assertSucceeds} from "@firebase/rules-unit-testing";
import {doc,getDoc,setDoc,deleteDoc} from "firebase/firestore";
import {modelOwnerOnlyFinanceRules} from "../security/finance-phase2-read-boundary.mjs";

const baseRules=readFileSync(new URL("../security/firestore.phase1.rules",import.meta.url),"utf8");
const candidate=modelOwnerOnlyFinanceRules(baseRules);
const prodFirebaseConfig=JSON.parse(readFileSync(new URL("../firebase.json",import.meta.url),"utf8"));
const company="finance-stage2-a",other="finance-stage2-b",partnerCompany="finance-partner-c";
let env;
const dbFor=uid=>env.authenticatedContext(uid,{email:uid+"@example.test",email_verified:true}).firestore();

before(async()=>{
 env=await initializeTestEnvironment({projectId:"demo-sales-public-boundary",firestore:{rules:candidate}});
 await env.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   for(const [cid,uid,role] of [
     [company,"owner","owner"],
     [company,"partner","member"],
     [other,"outsider","member"],
     [partnerCompany,"partnerOwner","owner"]
   ]){
     await setDoc(doc(db,"companies",cid),{name:"TEST",ownerUid:cid===company?"owner":cid===partnerCompany?"partnerOwner":"other-owner",
       masterUid:cid===company?"owner":cid===partnerCompany?"partnerOwner":"other-owner",
       companyKind:cid===partnerCompany?"partner":"internal",active:true});
     await setDoc(doc(db,"users",uid),{uid,companyId:cid,role:"leader",companyRole:role,active:true,teamId:"t1",accessKind:(uid==="partner"||uid==="partnerOwner")?"partner":"internal"});
     await setDoc(doc(db,"companies",cid,"members",uid),
       {uid,companyId:cid,role:"leader",companyRole:role,active:true,teamId:"t1",accessKind:(uid==="partner"||uid==="partnerOwner")?"partner":"internal",canViewRevenue:uid==="partner",canViewUnitPrice:uid==="partner"});
   }
   await setDoc(doc(db,"records","legacy"),{
     companyId:company,uid:"partner",date:"2026-10-28",teamId:"t1",totalCount:1,
     totalRevenue:25000,results:{p:{count:1,revenuePerUnit:25000}}
   });
   await setDoc(doc(db,"products","legacy"),{companyId:company,name:"商材",revenue:25000,pricingOptions:[]});
   await setDoc(doc(db,"recordCorrections","legacy"),{companyId:company,recordId:"legacy",
     before:{totalRevenue:25000},after:{totalRevenue:35000}});
   await setDoc(doc(db,"revenueGoals","legacy"),{companyId:company,teamId:"t1",month:"2026-10",targetRevenue:100000});
   for(const [table,fields] of [
     ["records",{companyId:partnerCompany,uid:"partnerOwner",date:"2026-10-28",teamId:"t1",
       totalRevenue:150000,totalCount:2,results:{p1:{count:2,revenuePerUnit:75000}}}],
     ["products",{companyId:partnerCompany,name:"高額商材",revenue:75000}],
     ["recordCorrections",{companyId:partnerCompany,before:{totalRevenue:30000},
       after:{totalRevenue:150000}}],
     ["revenueGoals",{companyId:partnerCompany,targetRevenue:500000,teamId:"t1"}]
   ])await setDoc(doc(db,table,"partner-legacy"),fields);
   // Isolated legacy/ambiguous marker fixtures. An unexpected accessKind
   // must never inherit the finance privileges of a misconfigured owner.
   for(const [uid,kind,userExtra,memberExtra] of [
     ["cooperatorUser","internal",{accessKind:"cooperator"},{}],
     ["cooperatorMember","internal",{}, {accessKind:"cooperator"}],
     ["unknownUser","internal",{accessKind:"external"},{}],
     ["unknownMember","internal",{}, {accessKind:"vendor"}],
     ["unknownCompany","affiliate",{},{}],
     ["cooperatorCompany","cooperator",{},{}],
     ["partnerMemberType","internal",{memberType:"partner"},{}],
     ["cooperatorMemberType","internal",{}, {memberType:"cooperator"}]
   ]){
     const cid="denied-"+uid;
     const base={uid,companyId:cid,role:"leader",companyRole:"owner",
       active:true,teamId:"teamA",canViewRevenue:true,canViewUnitPrice:true};
     await setDoc(doc(db,"companies",cid),{
       name:"TEST",ownerUid:uid,masterUid:uid,companyKind:kind,active:true
     });
     await setDoc(doc(db,"users",uid),{...base,...userExtra});
     await setDoc(doc(db,"companies",cid,"members",uid),{...base,...memberExtra});
     for(const table of ["records","products","recordCorrections","revenueGoals"]){
       await setDoc(doc(db,table,"raw-"+uid),{
         companyId:cid,totalRevenue:987654,unitPrice:50000
       });
     }
   }
   await setDoc(doc(db,"publicRecords","safe"),{companyId:company,sourceId:"safe",uid:"partner",
     date:"2026-10-28",teamId:"t1",totalCount:1,reportStatus:"submitted",
     memberNameSnapshot:"担当者",teamNameSnapshot:"一班",workLocation:"会場"});
 });
});
after(async()=>{if(env)await env.cleanup();});

test("phase2 candidate is emulator-only and never wired to production firebase.json",()=>{
 assert.equal(prodFirebaseConfig.firestore.rules,"firestore.rules");
 assert.notEqual(candidate,baseRules);
 for(const name of ["records","products","recordCorrections","revenueGoals"]){
   const begin=candidate.indexOf("match /"+name+"/{");
   assert(begin>=0);
   const rule=candidate.slice(begin,candidate.indexOf("allow create:",begin));
   assert.match(rule,/isCompanyMaster\(resource\.data\.companyId\)/);
   assert.match(rule,/isCompanyOwner\(resource\.data\.companyId\)/);
   assert.match(rule,/isInternalFinanceReader\(resource\.data\.companyId\)/);
   assert.doesNotMatch(rule,/&& sameCompany\(resource\.data\.companyId\);/);
 }
});

test("same-company partner is denied raw finance even with BOTH monetary grants mistakenly enabled",async()=>{
 const db=dbFor("partner");
 for(const collection of ["records","products","recordCorrections","revenueGoals"])
   await assertFails(getDoc(doc(db,collection,"legacy")));
});

test("same-company owner can read all original documents after rules closure",async()=>{
 const db=dbFor("owner");
 for(const collection of ["records","products","recordCorrections","revenueGoals"])
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
 for(const collection of ["records","products","recordCorrections","revenueGoals"])
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

test("partner-company OWNER/master never reads ANY finance collection even if both price grants are true",async()=>{
 const db=dbFor("partnerOwner");
 for(const collection of ["records","products","recordCorrections","revenueGoals"])
   await assertFails(getDoc(doc(db,collection,"partner-legacy")));
});

test("partner-company owner cannot CREATE financial documents even with owner/master rights",async()=>{
 const db=dbFor("partnerOwner");
 for(const table of ["records","products","recordCorrections","revenueGoals"]){
   await assertFails(setDoc(doc(db,table,"partner-new"),{
     companyId:partnerCompany,uid:"partnerOwner",teamId:"t1",
     totalRevenue:100000,revenuePerUnit:50000,price:50000
   }));
 }
});
test("partner-company owner cannot UPDATE or DELETE money-bearing originals",async()=>{
 const db=dbFor("partnerOwner");
 for(const table of ["records","products","recordCorrections","revenueGoals"]){
   await assertFails(setDoc(doc(db,table,"partner-legacy"),{
     companyId:partnerCompany,totalRevenue:999999
   },{merge:true}));
   await assertFails(deleteDoc(doc(db,table,"partner-legacy")));
 }
});
test("hard delete of finance originals is disabled even for an internal owner",async()=>{
 const db=dbFor("owner");
 for(const table of ["records","products","recordCorrections","revenueGoals"])
   await assertFails(deleteDoc(doc(db,table,"legacy")));
});

test("cooperator/unknown company and account markers cannot bypass finance closure through Owner/Master",async()=>{
  // Each fixture has its OWN company, both monetary grants and master rights.
  // In particular accessKind="cooperator" and accessKind="external" must NOT
  // pass just because older rules only compared with "partner".
  const ids=[
    "cooperatorUser","cooperatorMember","unknownUser","unknownMember",
    "unknownCompany","cooperatorCompany",
    "partnerMemberType","cooperatorMemberType"
  ];
  for(const uid of ids){
    const db=dbFor(uid);
    for(const collection of ["records","products","recordCorrections","revenueGoals"]){
      await assertFails(getDoc(doc(db,collection,"raw-"+uid)));
    }
  }
});

test("the candidate explicitly accepts internal markers, not unknown marker values",()=>{
  const helper=candidate.slice(candidate.indexOf("function isInternalFinanceReader("),
    candidate.indexOf("function isInternalFinanceReader(")+1600);
  for(const fragment of [
    "get('companyKind', 'internal') == 'internal'",
    "get('accessKind', 'internal') == 'internal'",
    "get('memberType', 'internal') != 'cooperator'",
    "get('memberType', 'internal') != 'partner'"
  ])assert.ok(helper.includes(fragment),"Missing finance deny by default: "+fragment);
  // Never accidentally deploy the generated candidate as default Rules.
  assert.equal(prodFirebaseConfig.firestore.rules,"firestore.rules");
});
