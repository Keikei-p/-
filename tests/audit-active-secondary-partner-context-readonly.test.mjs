import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyActiveSecondaryContext,aggregateSecondaryContextAudit}
 from "../tools/production/audit-active-secondary-partner-context-readonly.mjs";
const row=(extra={})=>({
 uid:"test_010",
 context:{uid:"test_010",kind:"partner_secondary",active:true,
  primaryCompanyId:"company_primary",partnerCompanyId:"company_partner"},
 user:{companyId:"company_primary",active:true,companyRole:"owner",
  accessKind:"internal",memberType:"direct",canViewRevenue:true},
 member:{active:true,companyRole:"owner",accessKind:"internal",memberType:"direct"},
 company:{companyKind:"internal",active:true,ownerUid:"test_010"},
 ...extra
});
test("actual active secondary context with intact internal membership has potential raw records GET even without revenue flag",()=>{
 const withRights=row();
 assert.equal(classifyActiveSecondaryContext(withRights).risk,true);
 const noRevenue=row({
  user:{...withRights.user,companyRole:"member",canViewRevenue:false},
  member:{...withRights.member,companyRole:"member",canViewRevenue:false}
 });
 assert.equal(classifyActiveSecondaryContext(noRevenue).risk,true,
  "record originals contain totalRevenue and current Rules use sameCompany not canViewRevenue");
 const result=aggregateSecondaryContextAudit([withRights,noRevenue]);
 assert.equal(result.activeSecondaryWithLegacyPrimaryFinancialReadPathPotential,2);
 assert.equal(result.realAccountIdTokenGET_LIST_DenialProven,false);
 assert.equal(result.originalFinancialDocumentsRead,0);
 assert.equal(result.safeToEnableJointRanking,false);
});
test("inactive and transferred context do not imply continued internal finance",()=>{
 const original=row();
 for(const item of [
  row({context:{...original.context,active:false}}),
  row({user:{...original.user,companyId:"company_partner",accessKind:"partner"}}),
  row({member:{...original.member,active:false}}),
  row({company:{...original.company,companyKind:"partner"}}),
  row({user:{...original.user,memberType:"cooperator"}}),
  row({member:{...original.member,accessKind:"partner"}})
 ])assert.equal(classifyActiveSecondaryContext(item).risk,false);
});
test("missing or contradictory active metadata counted as UNKNOWN, never automatically safe",()=>{
 const original=row();
 const cases=[
  row({uid:"other_uid"}),
  row({context:{...original.context,primaryCompanyId:"company_partner"}}),
  row({context:{...original.context,primaryCompanyId:"../other"}}),
  row({user:null}),
  row({company:null}),
  row({member:null}),
  row({context:{...original.context,kind:"unknown"}})
 ];
 for(const item of cases){
  const v=classifyActiveSecondaryContext(item);
  assert.equal(v.risk,false);
  assert.equal(v.invalid,true);
 }
 const result=aggregateSecondaryContextAudit(cases);
 assert.equal(result.activeSecondaryUnknownIdentityContext,cases.length);
 assert.equal(result.safeToApplyFinancialFenceWithoutContinuityTest,false);
});
test("scan strictly stops before unlimited reads or untrusted IDs",()=>{
 assert.throws(()=>aggregateSecondaryContextAudit(Array(26).fill(row())),
  /STOP_PARTNER_CONTEXT_READONLY_READ_SCOPE_EXCEEDED/);
 assert.throws(()=>classifyActiveSecondaryContext(row({uid:"../../secrets"})),
  /STOP_PARTNER_CONTEXT_READONLY_BAD_CONTEXT_ROW/);
 assert.deepEqual(aggregateSecondaryContextAudit([]).contextsScanned,0);
});
test("report has no UID, email, company name, original financial values or identifiers",()=>{
 const sensitive="private_email@example.com",member=row({
  user:{...row().user,email:sensitive,password:"never_emit"},
  company:{companyKind:"internal",name:"PRIVATE_CO",secret:"never_emit"}
 });
 const out=JSON.stringify(aggregateSecondaryContextAudit([member]));
 assert.equal(out.includes(sensitive),false);
 assert.equal(out.includes("PRIVATE_CO"),false);
 assert.equal(out.includes("test_010"),false);
 assert.equal(out.includes("never_emit"),false);
});
test("live workflow and source are read-only, bounded and forbid original finance document reads",()=>{
 const w=readFileSync(new URL("../.github/workflows/nico-secondary-partner-context-readonly.yml",import.meta.url),"utf8");
 const s=readFileSync(new URL("../tools/production/audit-active-secondary-partner-context-readonly.mjs",import.meta.url),"utf8");
 assert.match(w,/github\.event_name == 'push'/);
 assert.match(w,/audit-active-secondary-partner-context-readonly\.mjs/);
 assert.match(w,/git hash-object firestore.rules/);
 assert.doesNotMatch(w,/firebase deploy|firestore:delete|firebase firestore:rules/);
 assert.match(s,/limit\(LIMIT\+1\)/);
 assert.match(s,/const LIMIT=25/);
 assert.doesNotMatch(s,/firestore\.collection\("(products|records|recordCorrections|revenueGoals)"\)/);
 assert.doesNotMatch(s,/\.set\(|\.update\(|\.delete\(|\.add\(/);
 assert.doesNotMatch(s,/console\.log\(uid|console\.log\(ctx|console\.log\(u\)|console\.log\(m\)/);
});
