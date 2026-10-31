import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {KEYS,validCountRow,compareStaffRollup,financeLockedIdentity,isInternalIdentitySafe,inspectLive}
 from "../tools/production/audit-live-partner-counts.mjs";
const zeros=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const mk=(values,extra={})=>{
 const counts={...zeros(),...values};
 return {...extra,counts,totalCount:Object.values(counts).reduce((x,y)=>x+y,0)};
};
test("partner-only count schema rejects every price, malformed and foreign count",()=>{
 assert.equal(validCountRow(mk({NURO:3})),3);
 for(const key of ["totalRevenue","revenue","revenuePerUnit","unitPrice","pricingOptions","targetRevenue","price"]){
  assert.throws(()=>validCountRow({...mk({NURO:1}),[key]:100}),/MONEY_IN_COUNT_REPORT/);
 }
 assert.throws(()=>validCountRow(mk({NURO:1,bad:0})),/BAD_CATEGORY_SCHEMA/);
 assert.throws(()=>validCountRow(mk({NURO:-1})),/BAD_COUNT/);
 assert.throws(()=>validCountRow({...mk({NURO:2}),totalCount:5}),/COUNT_TOTAL_MISMATCH/);
});
test("summary is EXACT staff ledger, corrections and foreign entries never double count",()=>{
 const date="2026-10-31",partnerCompanyId="p",hubCompanyId="h";
 const base={date,partnerCompanyId,hubCompanyId,source:"staff-entries-v1"};
 const entries=[mk({NURO:2},{date,companyId:"p",hubCompanyId,staffId:"one"}),
  mk({NURO:1,SBMNP:3},{date,companyId:"p",hubCompanyId,staffId:"two"})];
 const summary=mk({NURO:3,SBMNP:3},base);
 assert.deepEqual(compareStaffRollup({summary,entries,date,partnerCompanyId,hubCompanyId}),{entries:2,total:6});
 assert.throws(()=>compareStaffRollup({summary,entries:[entries[0]],date,partnerCompanyId,hubCompanyId}),/ROLLUP_DIFFERS_FROM_STAFF/);
 assert.throws(()=>compareStaffRollup({summary,entries:[entries[0],entries[0]],date,partnerCompanyId,hubCompanyId}),/BAD_STAFF_OR_DUPLICATE/);
 assert.throws(()=>compareStaffRollup({summary,entries:entries.map(e=>({...e,hubCompanyId:"other"})),date,partnerCompanyId,hubCompanyId}),/BAD_STAFF_OR_DUPLICATE/);
});
test("partner role markers always deny revenue and unit price even for owner",()=>{
 const c={companyKind:"partner"},safe={accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false};
 assert.doesNotThrow(()=>financeLockedIdentity(c,[safe],safe));
 for(const key of ["accessKind","memberType","canViewRevenue","canViewUnitPrice"]){
  const broken={...safe,[key]:key==="accessKind"?"internal":key==="memberType"?"member":true};
  assert.throws(()=>financeLockedIdentity(c,[broken],safe),/PARTNER_IDENTITY_FINANCE_FLAGS/);
 }
 assert.equal(isInternalIdentitySafe({companyKind:"internal"},{accessKind:"internal",memberType:"member"}),true);
 assert.equal(isInternalIdentitySafe({companyKind:"internal"},{accessKind:"partner"}),false);
 assert.equal(isInternalIdentitySafe({companyKind:"internal"},{memberType:"cooperator"}),false);
 for(const marker of ["partner","cooperator","unknown","external"]){
  assert.equal(isInternalIdentitySafe({companyKind:"internal"},{accessKind:marker}),false);
  assert.equal(isInternalIdentitySafe({companyKind:"internal"},{memberType:marker}),false);
  assert.equal(isInternalIdentitySafe({companyKind:"internal"},{accessKind:"internal"},
   {accessKind:marker}),false,"users.accessKind must veto member grants");
  assert.equal(isInternalIdentitySafe({companyKind:"internal"},{memberType:"direct"},
   {memberType:marker}),false,"users.memberType must veto member grants");
 }
 for(const type of [undefined,"internal","direct","member","managed"]){
  assert.equal(isInternalIdentitySafe({}, {memberType:type}, {memberType:type}),true);
 }
 assert.equal(isInternalIdentitySafe({companyKind:"direct"},{}),false);
 assert.equal(isInternalIdentitySafe({companyKind:"unknown"},{}),false);
 assert.equal(isInternalIdentitySafe({companyKind:"partner"},{}),false);
 assert.equal(isInternalIdentitySafe({companyKind:null},{}),false);
 assert.equal(isInternalIdentitySafe({}, {accessKind:null}),false);
 assert.equal(isInternalIdentitySafe({}, {memberType:null}),false);
});
test("audit is read-only at source-code level, does not call prod writes or sign in users",()=>{
 const source=readFileSync(new URL("../tools/production/audit-live-partner-counts.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\b(?:setDoc|addDoc|updateDoc|deleteDoc|createUser|signInWith|runTransaction)\s*\(/);
 assert.doesNotMatch(source,/\b(?:db|tx|batch|docRef|recordRef)\.(?:set|create|update|delete|runTransaction)\s*\(|\bdeploy\s+--only/);
 assert.match(source,/NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"/);
 assert.match(source,/signedInPartnerE2EVerified:false/);
 assert.doesNotMatch(source,/\.doc\(doc\.id\)\s*\.select\(/,
  "Admin SDK DocumentReference has no select method");
});
test("mocked read-only production check matches live rule source and does not expose any IDs",async()=>{
 const ruleText=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
 const calls=[];
 const documents=new Map();
 const doc=(id,data)=>({id,exists:true,data:()=>data});
 const push=(path,items)=>documents.set(path,items);
 push("companies",[doc("h",{companyKind:"internal",ownerUid:"h-owner",active:true}),
  doc("p",{companyKind:"partner",ownerUid:"p-owner",hubCompanyId:"h",active:true})]);
 push("users/p-owner",[doc("p-owner",{accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false})]);
 push("companies/p/members/p-owner",[doc("p-owner",{accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false})]);
 push("companies/h/members",[doc("h-owner",{
  // Legacy membership omits both copies of the path identifiers.
  companyRole:"owner",active:true,accessKind:"internal",memberType:"direct"
 })]);
 push("users/h-owner",[doc("h-owner",{
  uid:"h-owner",companyId:"h",companyRole:"owner",active:true,
  accessKind:"internal",memberType:"direct",canViewRevenue:true,canViewUnitPrice:true
 })]);
 push("companies/p/members",[doc("p-owner",{accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false,active:true})]);
 const day="2026-10-31";
 push("companies/h/partnerWorkCountDays/"+day+"/reports",[
  doc("p",mk({NURO:3},{source:"staff-entries-v1",date:day,hubCompanyId:"h",partnerCompanyId:"p"}))
 ]);
 push("companies/p/partnerWorkEntries",[
  doc(day+"__staff",mk({NURO:3},{date:day,staffId:"staff",hubCompanyId:"h",companyId:"p"}))
 ]);
 push("companies/h/partnerQuickCountDays/"+day+"/reports",[
  doc("p",mk({NURO:9},{date:day,hubCompanyId:"h",partnerCompanyId:"p"}))
 ]);
 const query=(path,filter=null,cap=Infinity)=>({
  select(){return this},limit(n){return query(path,filter,n)},
  where(k,op,v){assert.equal(op,"==");return query(path,{k,v},cap)},
  async get(){calls.push("READ "+path);let docs=documents.get(path)||[];
   if(filter)docs=docs.filter(x=>x.data()[filter.k]===filter.v);
   docs=docs.slice(0,cap);return {size:docs.length,docs};},
  doc(id){return reference(path+"/"+id)}
 });
 const reference=path=>({
  id:path.split("/").at(-1),collection:name=>query(path+"/"+name),
  // DocumentReference has get(), not select(). Fake must match Admin SDK.
  async get(){calls.push("READ "+path);let d=documents.get(path)?.[0];return d||{exists:false,data:()=>({})};}
 });
 const db={collection:path=>query(path)};
 const fetchMock=async url=>{
  calls.push("RULES_READ");
  return {ok:true,json:async()=>url.endsWith("/releases/cloud.firestore")?
   {rulesetName:"projects/sales-management-cc116/rulesets/test"}:
   {source:{files:[{content:ruleText}]}}};
 };
 const result=await inspectLive({db,credential:{getAccessToken:async()=>({access_token:"TEST"})},
   request:fetchMock,clock:()=>Date.parse("2026-10-31T11:00:00+09:00")});
 assert.equal(result.deployedRulesMatchReviewedRepo,true);
 assert.equal(result.activeInternalAccountsChecked,1);
 assert.equal(result.internalOwnersVerified,1);
 assert.equal(result.legacyMembersWithoutUid,1);
 assert.equal(result.legacyMembersWithoutCompanyId,1);
 assert.equal(result.nonLoginManagedStaff,0);
 assert.equal(result.internalOwnerAndStaffCompatibilityVerified,true);
 assert.equal(result.safeToDeployExistingRules,false,
  "static role-marker checks must never approve incomplete money gateway cutover");
 assert.equal(result.partnerCompanyCount,1);
 assert.equal(result.staffReportCount,1);
 assert.equal(result.quickReportCount,1);
 assert.equal(result.verifiedStaffEntryCount,1);
 assert.equal(result.effectiveThreeDayPartnerCount,3,"old quick 9 and staff 3 are NOT added together");
 assert.equal(result.signedInPartnerE2EVerified,false);
 assert(calls.every(x=>x.startsWith("READ ")||x==="RULES_READ"));
 assert.equal(JSON.stringify(result).includes("p-owner"),false);
});
