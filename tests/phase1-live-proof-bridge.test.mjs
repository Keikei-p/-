import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {phase1WithLiveAccountGate} from '../tools/production/phase1-live-proof-bridge.mjs';
import {phase1Boundary} from '../tools/production/phase1-partner-finance-release.mjs';
import {createAffectedSecondaryIdentityVerifier} from '../tools/production/phase1-bound-identity-readonly.mjs';
import {
  createLiveFirestoreOwnerPreflight,createLiveFirestoreRoleVerifier
} from '../tools/production/verify-live-firestore-roles.mjs';
import {fingerprint} from '../tools/readonly-backup/backup.mjs';

const PROJECT='sales-management-cc116';
const ROOT='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
const RULES_ROOT='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
const releaseUrl=RULES_ROOT+'/releases/cloud.firestore';
const oldId='projects/'+PROJECT+'/rulesets/legacy';
const nextId='projects/'+PROJECT+'/rulesets/reviewed';
const DATE='2026-11-05T12:00:00Z';
const T=Math.floor(Date.parse(DATE)/1000);
const jwt=(sub,overrides={})=>
  Buffer.from('{"typ":"JWT","alg":"RS256"}').toString('base64url')+'.'+
  Buffer.from(JSON.stringify({
    sub,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,
    email_verified:true,iat:T-20,exp:T+2400,auth_time:T-40,
    firebase:{sign_in_provider:'password'},...overrides
  })).toString('base64url')+'.'+'x'.repeat(100);
function fixture({ownerStatus=200,partnerStatus=403,ownerCompany='internal_company'}={}){
  const calls=[],owner=jwt('realOwner'),partner=jwt('secondaryPartner');
  let time=T*1000;
  const fetchImpl=async(url,opts)=>{
    calls.push({url,method:opts.method,auth:opts.headers.Authorization,body:opts.body});
    const isPartner=opts.headers.Authorization==='Bearer '+partner;
    const product=url.includes('/products/');
    return {
      status:isPartner?partnerStatus:ownerStatus,
      json:async()=>opts.method==='POST'?[{readTime:DATE}]:{
        name:url,fields:{
          companyId:{stringValue:ownerCompany},
          [product?'revenue':'totalRevenue']:{integerValue:'15000'}
        }
      }
    };
  };
  const accounts={
    ownerIdToken:owner,partnerIdToken:partner,
    expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
    internalCompanyId:'internal_company',productId:'existingProduct',
    recordId:'existingRecord',fetchImpl,now:()=>time
  };
  return {calls,fetchImpl,accounts,setTime:t=>{time=t}};
}
function releaseFixture(){
  const before=execFileSync('git',['show','origin/main:firestore.rules'],{
    encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024
  });
  const candidate=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  const snapshot={
    projectId:PROJECT,format:'firestore-rest-typed-v1',
    documents:[{path:'records/synthetic',value:{fields:{
      totalCount:{integerValue:'2'},totalRevenue:{integerValue:'15000'}
    },createTime:DATE,updateTime:DATE}}]
  };
  let active=oldId;
  const writes=[],sources=new Map([[oldId,before],[nextId,candidate]]);
  const request=async(method,url,body)=>{
    if(method==='GET'){
      if(url===releaseUrl)return {rulesetName:active};
      const id=url.slice('https://firebaserules.googleapis.com/v1/'.length);
      return {source:{files:[{name:'firestore.rules',content:sources.get(id)}]}};
    }
    writes.push(method);
    if(method==='POST')return {name:nextId};
    active=body.release.rulesetName;
    return {name:active};
  };
  return {
    writes,getActive:()=>active,
    release:{
      request,snapshot:async()=>structuredClone(snapshot),
      restore:async s=>({
        fieldsAndIdsVerified:true,productionTouched:false,
        documentCount:s.documents.length,sourceInventoryFingerprint:fingerprint(s)
      }),
      backup:async()=>({readyBackups:1,latestReadySnapshot:DATE}),
      reviewedBaseline:before,reviewedCandidate:candidate,now:()=>T*1000+1000
    }
  };
}

const approvalRows={approval:true,candidateEmulatorVerified:true,backupReviewed:true};
// These are solely mock documents. No production credentials or identities.
const oauthRoot=ROOT+'/';
const str=v=>({stringValue:v});
const flag=v=>({booleanValue:v});
function fakeIdentity({changedPath='',changes={},statusOverride=0}={}){
 const owner='realOwner',partner='secondaryPartner',internal='internal_company',external='partner_company';
 const rows={
  ['users/'+owner]:{companyId:str(internal),companyRole:str('owner'),
   accessKind:str('internal'),active:flag(true)},
  ['companies/'+internal]:{companyKind:str('internal'),active:flag(true),
    ownerUid:str(owner)},
  ['companies/'+internal+'/members/'+owner]:{
    companyRole:str('owner'),active:flag(true),accessKind:str('internal')},
  ['partnerWorkspaceContexts/'+partner]:{
    uid:str(partner),kind:str('partner_secondary'),active:flag(true),
    primaryCompanyId:str(internal),partnerCompanyId:str(external),
    hubCompanyId:str(internal)},
  ['users/'+partner]:{companyId:str(internal),companyRole:str('member'),
    active:flag(true),accessKind:str('internal')},
  ['companies/'+internal+'/members/'+partner]:{
    companyRole:str('member'),active:flag(true),accessKind:str('internal')},
  ['companies/'+external]:{companyKind:str('partner'),active:flag(true),
    hubCompanyId:str(internal)},
  ['companies/'+external+'/members/'+partner]:{
    uid:str(partner),companyId:str(external),active:flag(true),
    accessKind:str('partner'),memberType:str('cooperator'),
    companyRole:str('member'),canViewRevenue:flag(false),
    canViewUnitPrice:flag(false)}
 };
 const calls=[];
 return {
  calls,
  credential:{getAccessToken:async()=>({access_token:'fake-oauth-token-xxxxxxxxxxxxxxxx'})},
  partnerCompanyId:external,
  now:()=>T*1000,
  fetchImpl:async(url,opts)=>{
   const path=url.slice(oauthRoot.length);
   calls.push({path,method:opts.method});
   if(statusOverride)return {status:statusOverride,json:async()=>({})};
   if(path==='partnerWorkspaceContexts/'+owner)return {status:404};
   const fields={...rows[path],...(path===changedPath?changes:{})};
   if(!rows[path])return {status:404};
   return {status:200,json:async()=>({name:url,fields})};
  }
 };
}
const approvals=approvalRows;

test('preflight reads two Owner original documents AND their constrained lists without writes',async()=>{
  const f=fixture();
  const proof=await createLiveFirestoreOwnerPreflight(f.accounts)();
  assert.equal(proof.checkedAgainst,'synthetic-only');
  assert.equal(proof.ownerFinanceAllowed,true);
  assert.deepEqual(f.calls.map(c=>c.method),['GET','POST','GET','POST']);
  for(const c of f.calls){
    assert(c.url.startsWith(ROOT));
    if(c.method==='POST'){
      const q=JSON.parse(c.body).structuredQuery;
      assert.equal(q.limit,1);
      assert.equal(q.where.fieldFilter.value.stringValue,'internal_company');
      assert.deepEqual(q.select.fields,[{fieldPath:'companyId'}]);
    }
  }
  assert(!JSON.stringify(proof).includes('15000'));
  assert(!JSON.stringify(proof).includes('realOwner'));
  assert(!JSON.stringify(proof).includes('existingRecord'));
});

test('bridge denies missing signed-review flags BEFORE either account or Rules API',async()=>{
  for(const omitted of Object.keys(approvals)){
    const f=fixture(),r=releaseFixture();
    const settings={...approvals,[omitted]:false};
    await assert.rejects(phase1WithLiveAccountGate({
      release:r.release,accounts:f.accounts,identity:fakeIdentity(),...settings
    }),/STOP_PHASE1_LIVE_BRIDGE_INDEPENDENT_APPROVAL_REQUIRED/);
    assert.equal(f.calls.length,0);
    assert.equal(r.writes.length,0);
    assert.equal(r.getActive(),oldId);
  }
});

test('bridge cannot be tricked by caller supplying fake verification or apply override',async()=>{
  for(const malicious of [
    {apply:true},{verifyLiveRoles:async()=>({
      checkedAgainst:'production-live',partnerDocumentDenied:true,
      partnerListDenied:true,ownerFinanceAllowed:true
    })},{realOwnerBeforeVerified:true}
  ]){
    const f=fixture(),r=releaseFixture();
    await assert.rejects(phase1WithLiveAccountGate({
      release:{...r.release,...malicious},accounts:f.accounts,...approvals
    }),/STOP_PHASE1_LIVE_BRIDGE_UNREVIEWED_INPUT_KEYS/);
    assert.equal(f.calls.length,0);
    assert.equal(r.writes.length,0);
  }
});

test('synthetic injected HTTP transport, even with 200 Owner, NEVER starts Rules release',async()=>{
  const f=fixture(),r=releaseFixture();
  await assert.rejects(phase1WithLiveAccountGate({
    release:r.release,accounts:f.accounts,identity:fakeIdentity(),...approvals
  }),/STOP_PHASE1_LIVE_BRIDGE_TRUSTED_AFFECTED_IDENTITY_REQUIRED/);
  assert.equal(f.calls.length,0);
  assert.equal(r.writes.length,0);
  assert.equal(r.getActive(),oldId);
});

test('broken Owner permission, wrong company or expired Owner token always stops before Rules',async()=>{
  for(const type of ['owner403','wrongCompany','expired']){
    const f=fixture({
      ownerStatus:type==='owner403'?403:200,
      ownerCompany:type==='wrongCompany'?'unrelated':'internal_company'
    });
    if(type==='expired')f.setTime((T+4000)*1000);
    const r=releaseFixture();
    await assert.rejects(createLiveFirestoreOwnerPreflight(f.accounts)(),
      /STOP_LIVE_ROLE_/);
    assert.equal(r.writes.length,0);
    assert.equal(r.getActive(),oldId);
  }
});

test('owner proof does not satisfy future partner denial; synthetic post-switch proof rolls old Rules back',async()=>{
  const f=fixture(),r=releaseFixture();
  const verifyLiveRoles=createLiveFirestoreRoleVerifier(f.accounts);
  // The standalone switch engine accepts a callback but MUST reject a real
  // adapter's synthetic-only evidence, and reverse its own Rules release.
  await assert.rejects(phase1Boundary({
    ...r.release,apply:true,approval:true,
    candidateEmulatorVerified:true,realOwnerBeforeVerified:true,
    backupReviewed:true,verifyLiveRoles
  }),/STOP_PHASE1_POST_SWITCH_ROLE_UNVERIFIED/);
  assert.equal(r.getActive(),oldId);
  assert.deepEqual(r.writes,['POST','PATCH','PATCH']);
  assert.equal(f.calls.length,8);
});

test('single-use Owner proof rechecks freshness at the moment of first request',async()=>{
  const f=fixture();
  const check=createLiveFirestoreOwnerPreflight(f.accounts);
  f.setTime((T+5000)*1000);
  await assert.rejects(check(),/STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/);
  assert.equal(f.calls.length,0);
  await assert.rejects(check(),/STOP_LIVE_ROLE_SINGLE_USE_OWNER_PREFLIGHT/);
});

test('bridge is import-only, with no deployed runner, credential reader or implicit write',()=>{
  const source=readFileSync(new URL(
    '../tools/production/phase1-live-proof-bridge.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/process\.env|firebase deploy|spawn\(|execFile\(/);
  assert.match(source,/phase1Boundary\(\{/);
  assert.match(source,/verifyLiveRoles:after/);
  assert.match(source,/realOwnerBeforeVerified:true/);
  assert.match(source,/TRUSTED_AFFECTED_IDENTITY_REQUIRED/);
  assert.match(source,/POST_SWITCH_IDENTITY_UNVERIFIED/);
});

test('synthetic identity cannot claim production even when EVERY expected membership is valid',async()=>{
 const identity=fakeIdentity();
 const result=await createAffectedSecondaryIdentityVerifier({
  ...identity,expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
  internalCompanyId:'internal_company'
 })();
 assert.deepEqual(result,{
  checkedAgainst:'synthetic-only',ownerInternalBound:true,
  affectedSecondaryBound:true,projectId:PROJECT,productionDocumentWrites:0
 });
 assert.equal(identity.calls.length,9);
 assert(identity.calls.every(c=>c.method==='GET'));
 assert(!JSON.stringify(result).includes('secondaryPartner'));
 assert(!JSON.stringify(result).includes('internal_company'));
});
test('unrelated / incomplete partner account cannot be used to prove affected secondary denial',async()=>{
 const checks=[
  ['partnerWorkspaceContexts/secondaryPartner',{kind:str('partner_primary')}],
  ['partnerWorkspaceContexts/secondaryPartner',{primaryCompanyId:str('wrong_company')}],
  ['partnerWorkspaceContexts/secondaryPartner',{active:flag(false)}],
  ['companies/internal_company/members/secondaryPartner',{companyRole:str('owner')}],
  ['companies/partner_company/members/secondaryPartner',{canViewRevenue:flag(true)}],
  ['companies/partner_company/members/secondaryPartner',{memberType:str('internal')}],
  ['companies/partner_company',{companyKind:str('internal')}],
  ['users/secondaryPartner',{companyId:str('wrong_company')}],
  ['users/realOwner',{companyRole:str('member')}],
  ['companies/internal_company',{ownerUid:str('anotherOwner')}]
 ];
 for(const [changedPath,changes] of checks){
  const identity=fakeIdentity({changedPath,changes});
  await assert.rejects(createAffectedSecondaryIdentityVerifier({
    ...identity,expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
    internalCompanyId:'internal_company'
  })(),/STOP_PHASE1_IDENTITY_(OWNER_NOT_INDEPENDENTLY_BOUND|AFFECTED_SECONDARY_NOT_BOUND)/,
  changedPath);
 }
});
test('missing identity doc and unexpected auth response fail without any writes',async()=>{
 const identity=fakeIdentity({statusOverride:401});
 await assert.rejects(createAffectedSecondaryIdentityVerifier({
  ...identity,expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
  internalCompanyId:'internal_company'
 })(),/STOP_PHASE1_IDENTITY_IDENTITY_READ_UNVERIFIED/);
 assert(identity.calls.every(c=>c.method==='GET'));
});
test('bridge rejects generic partner and otherwise-valid mocked identity prior to Rules API',async()=>{
 const f=fixture(),r=releaseFixture(),identity=fakeIdentity();
 await assert.rejects(phase1WithLiveAccountGate({
  release:r.release,accounts:f.accounts,identity,...approvals
 }),/STOP_PHASE1_LIVE_BRIDGE_TRUSTED_AFFECTED_IDENTITY_REQUIRED/);
 assert.equal(r.writes.length,0);
 assert.equal(r.getActive(),oldId);
 assert.equal(f.calls.length,0);
});
