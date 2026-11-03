import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySecondary} from '../tools/production/audit-secondary-contexts-readonly.mjs';
const context={uid:'test_uid',kind:'partner_secondary',active:true,primaryCompanyId:'internal_company',
 partnerCompanyId:'partner_company',hubCompanyId:'internal_company'};
const user={companyId:'internal_company',companyRole:'member',active:true,accessKind:'internal',
 memberType:'direct',canViewRevenue:false,canViewUnitPrice:false};
const oldMember={companyRole:'member',active:true,accessKind:'internal',memberType:'direct'};
const oldCompany={ownerUid:'some_other_owner',masterUid:'some_other_owner',companyKind:'internal',active:true};
const partnerMember={active:true,accessKind:'partner',memberType:'cooperator'};
const partnerCompany={active:true,companyKind:'partner'};
const sample=(override={})=>({context,user,oldMember,oldCompany,partnerMember,partnerCompany,...override});

test('even revenue=false old internal member has original money read path',()=>{
 assert.equal(classifySecondary(sample()),'internal_finance_read_path');
});
test('same Firebase UID as internal company Owner is release blocker',()=>{
 assert.equal(classifySecondary(sample({oldCompany:{...oldCompany,ownerUid:'test_uid'}})),'owner_conflict');
 assert.equal(classifySecondary(sample({oldMember:{...oldMember,companyRole:'owner'}})),'owner_conflict');
});
test('missing, disabled and unknown dual contexts fail closed',()=>{
 assert.equal(classifySecondary(sample({context:{...context,active:false}})),'inactive_or_unrecognized');
 assert.equal(classifySecondary(sample({oldMember:null})),'broken');
 assert.equal(classifySecondary(sample({partnerCompany:{companyKind:'internal',active:true}})),'broken');
 assert.equal(classifySecondary(sample({user:{...user,companyId:'other_company'}})),'broken');
});
test('never equate partner owner flags with internal money privileges',()=>{
 assert.equal(classifySecondary(sample({oldCompany:{...oldCompany,ownerUid:'test_uid'},
  user:{...user,companyRole:'owner',canViewRevenue:true,canViewUnitPrice:true}})),'owner_conflict');
});
