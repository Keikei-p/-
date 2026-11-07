import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertExactReviewedRules,chooseAffectedSamples} from './phase1-live-snapshot-emulator.mjs';

const string=v=>({stringValue:v});
const bool=v=>({booleanValue:v});
const num=v=>({integerValue:String(v)});
const doc=(path,fields)=>({path,value:{fields}});
const fixture=()=>({
 projectId:'sales-management-cc116',
 documents:[
  doc('partnerWorkspaceContexts/partner_uid',{
   uid:string('partner_uid'),kind:string('partner_secondary'),active:bool(true),
   primaryCompanyId:string('company_internal'),partnerCompanyId:string('company_partner')
  }),
  doc('companies/company_internal',{ownerUid:string('owner_uid'),companyKind:string('internal')}),
  doc('companies/company_partner',{ownerUid:string('partner_owner'),companyKind:string('partner')}),
  doc('users/partner_uid',{companyId:string('company_internal')}),
  doc('users/owner_uid',{companyId:string('company_internal')}),
  doc('companies/company_internal/members/partner_uid',{companyId:string('company_internal')}),
  doc('companies/company_internal/members/owner_uid',{companyId:string('company_internal')}),
  doc('companies/company_partner/members/partner_uid',{companyId:string('company_partner')}),
  doc('products/product-1',{companyId:string('company_internal'),revenue:num(1000)}),
  doc('records/record-1',{companyId:string('company_internal'),totalRevenue:num(1500)})
 ]
});
test('exact reviewed candidate stays pinned, never accepts a one-byte drift',()=>{
 const source=readFileSync(new URL('./fixtures/reviewed-phase1-finance-boundary.rules',import.meta.url),'utf8');
 assert.equal(assertExactReviewedRules(source),true);
 assert.throws(()=>assertExactReviewedRules(source+'\n// drift'),
  /STOP_PHASE1_EMULATOR_UNREVIEWED_CANDIDATE/);
});
test('selected affected secondary UID and actual finance document are bound to same original internal company',()=>{
 const chosen=chooseAffectedSamples(fixture());
 assert.equal(chosen.length,1);
 assert.deepEqual(chosen[0],{
  owner:'owner_uid',partner:'partner_uid',companyId:'company_internal',
  productId:'product-1',recordId:'record-1'
 });
 assert.equal(Object.isFrozen(chosen[0]),true);
});
test('never certify an unrelated 403 account, absent raw finance or dual-context Owner',()=>{
 const base=fixture();
 const noContext={...base,documents:base.documents.filter(x=>!x.path.startsWith('partnerWorkspaceContexts/'))};
 assert.throws(()=>chooseAffectedSamples(noContext),/STOP_PHASE1_EMULATOR_NO_AFFECTED_SECONDARY/);
 const noMoney={...base,documents:base.documents.filter(x=>x.path!=='records/record-1')};
 assert.throws(()=>chooseAffectedSamples(noMoney),/STOP_PHASE1_EMULATOR_FINANCE_DOCUMENTS_MISSING/);
 const ownerSecondary={...base,documents:base.documents.map(row=>
  row.path==='companies/company_internal'?
   doc(row.path,{...row.value.fields,ownerUid:string('partner_uid')}):row)};
 assert.throws(()=>chooseAffectedSamples(ownerSecondary),/STOP_PHASE1_EMULATOR_INTERNAL_OWNER_BINDING/);
 const foreign={...base,documents:base.documents.map(row=>
  row.path==='users/partner_uid'?
   doc(row.path,{...row.value.fields,companyId:string('other_company')}):row)};
 assert.throws(()=>chooseAffectedSamples(foreign),/STOP_PHASE1_EMULATOR_SECONDARY_MEMBERSHIP/);
});
