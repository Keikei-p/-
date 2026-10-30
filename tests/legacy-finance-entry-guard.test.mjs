import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyLegacySalesEntrypoint} from "../legacy-finance-entry-guard.mjs";
const original=()=>{
 const uid="internalUser",companyId="internalCompany";
 return {uid,authEmailVerified:true,
  user:{uid,companyId,active:true,companyRole:"owner",role:"leader",teamId:null},
  member:{uid,companyId,active:true,companyRole:"owner",role:"leader",teamId:null},
  company:{active:true,companyKind:"internal",ownerUid:uid}
 };
};
test("existing legitimate internal owner, leader and member retain legacy page access",()=>{
 for(const role of ["owner","member"]){
  const data=original();
  data.user.companyRole=role;
  data.member.companyRole=role;
  for(const memberType of [undefined,"internal","direct","member","managed"]){
   if(memberType!==undefined){
    data.user.memberType=memberType;data.member.memberType=memberType;
   }else{delete data.user.memberType;delete data.member.memberType;}
   assert.equal(classifyLegacySalesEntrypoint(data).mode,"internal");
  }
 }
});
test("a partner COMPANY, owner, leader, master or an old revenue grant never opens raw-finance page",()=>{
 const scenarios=[
  v=>{v.company.companyKind="partner";v.company.ownerUid=v.uid;},
  v=>{v.user.accessKind="partner";},
  v=>{v.member.accessKind="partner";},
  v=>{v.user.memberType="partner";},
  v=>{v.member.memberType="partner";},
  v=>{v.user.memberType="cooperator";},
  v=>{v.member.memberType="cooperator";}
 ];
 for(const mutate of scenarios){
  const data=original();data.user.canViewRevenue=true;
  data.member.canViewRevenue=true;data.user.canViewUnitPrice=true;
  data.member.canViewUnitPrice=true;mutate(data);
  const result=classifyLegacySalesEntrypoint(data);
  assert.equal(result.mode,"partner");
  assert.equal(Object.isFrozen(result),true);
 }
});
test("unknown markers, partial membership, invalid email and stale role/team consistency fail closed",()=>{
 const invalid=[
  v=>{v.company.companyKind="franchise-unknown";},
  v=>{v.user.accessKind="unknown";},
  v=>{v.member.accessKind="owner-with-finance";},
  v=>{v.user.memberType="future-new-group";},
  v=>{v.member.memberType="future-new-group";},
  v=>{v.user.active=false;},
  v=>{v.member.active=false;},
  v=>{v.company.active=false;},
  v=>{v.user.uid="another";},
  v=>{v.member.uid="another";},
  v=>{v.member.companyId="another";},
  v=>{v.user.companyId="another";},
  v=>{v.authEmailVerified=false;},
  v=>{v.member.teamId="team1";v.user.teamId="team2";},
  v=>{v.member.companyRole="member";v.user.companyRole="owner";},
  v=>{v.member=null;},
  v=>{v.company=null;}
 ];
 for(const mutate of invalid){
  const data=original();mutate(data);
  assert.equal(classifyLegacySalesEntrypoint(data).mode,"blocked");
 }
});
test("legacy UI requests three fresh server Firestore docs before any price catalogue or live records subscription",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const job=readFileSync(new URL("../.github/workflows/nico-factory-sync.yml",import.meta.url),"utf8");
 assert.match(html,/import \{classifyLegacySalesEntrypoint\}\s*from "\.\/legacy-finance-entry-guard\.mjs";/);
 assert.match(html,/\bgetDocFromServer\b/);
 const load=html.indexOf("async function loadUserData(");
 const read=html.indexOf("const checkedEntry=await checkLegacyEntryAgainstServer(user);",load);
 const price=html.indexOf("await loadProducts(",load);
 assert(load>=0&&read>load&&price>read,"trusted check must precede any raw price read");
 const start=html.indexOf("async function checkLegacyEntryAgainstServer");
 const end=html.indexOf("function showLegacyFinanceEntryBlocked",start);
 const source=html.slice(start,end);
 assert.match(source,/getDocFromServer\(doc\(db,"users",user\.uid\)\)/);
 assert.match(source,/getDocFromServer\(doc\(db,"companies",profile\.companyId,"members",user\.uid\)\)/);
 assert.match(source,/getDocFromServer\(doc\(db,"companies",profile\.companyId\)\)/);
 assert.match(source,/auth\.currentUser\?\.uid!==user\.uid/);
 assert.match(html,/if \(checkedEntry\.mode!=="internal"\) \{\s*showLegacyFinanceEntryBlocked\(checkedEntry\.mode\);\s*return false;/);
 assert(job.includes("'legacy-finance-entry-guard.mjs'"));
 assert(job.includes("legacy-finance-entry-guard.mjs archive-output-policy.mjs"));
 const prod=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
 assert(!prod.includes("function isInternalFinanceReader(companyId)"),
  "candidate finance Rules must not be silently substituted into production");
});
