import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {phase1WithLiveAccountGate} from '../tools/production/phase1-live-proof-bridge.mjs';
import {phase1Boundary} from '../tools/production/phase1-partner-finance-release.mjs';
import {createAffectedSecondaryIdentityVerifier} from '../tools/production/phase1-bound-identity-readonly.mjs';
import {
  createLiveFirestoreOwnerPreflight,createLiveFirestoreRoleVerifier,
  createLiveFirestoreSessionPreflight
} from '../tools/production/verify-live-firestore-roles.mjs';
import {fingerprint} from '../tools/readonly-backup/backup.mjs';

const PROJECT='sales-management-cc116';
const API='https://firestore.googleapis.com/v1/';
const RESOURCE_ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const ROOT=API+RESOURCE_ROOT;
const RULES_ROOT='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
const releaseUrl=RULES_ROOT+'/releases/cloud.firestore';
const oldId='projects/'+PROJECT+'/rulesets/legacy';
const nextId='projects/'+PROJECT+'/rulesets/reviewed';
const DATE='2026-11-05T12:00:00Z';
const T=Math.floor(Date.parse(DATE)/1000);
const JST_DAY=new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(DATE));
const SUMMARY_PATH='companies/internal_company/partnerWorkCountDays/'+
 JST_DAY+'/reports/partner_company';
const jwt=(sub,overrides={})=>
  Buffer.from('{"typ":"JWT","alg":"RS256"}').toString('base64url')+'.'+
  Buffer.from(JSON.stringify({
    sub,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,
    email_verified:true,email:sub+'@example.test',iat:T-20,exp:T+2400,auth_time:T-40,
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
      json:async()=>isPartner&&partnerStatus===403
        ?{error:{code:403,status:'PERMISSION_DENIED'}}
        :opts.method==='POST'?[{document:{name:RESOURCE_ROOT+'/'+JSON.parse(opts.body).structuredQuery.from[0].collectionId+'/existingRow',fields:{companyId:{stringValue:ownerCompany}}}}]:{
        name:url.slice(API.length),fields:{
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
function fakeIdentity({changedPath='',changes={},statusOverride=0,role='leader',summaryPresent=true}={}){
 const owner='realOwner',partner='secondaryPartner',internal='internal_company',external='partner_company';
 const rows={
  ['users/'+owner]:{uid:str(owner),companyId:str(internal),companyRole:str('owner'),
   accessKind:str('internal'),active:flag(true)},
  ['companies/'+internal]:{companyKind:str('internal'),active:flag(true),
    ownerUid:str(owner)},
  ['companies/'+internal+'/members/'+owner]:{
    uid:str(owner),companyId:str(internal),
    companyRole:str('owner'),active:flag(true),accessKind:str('internal')},
  ['partnerWorkspaceContexts/'+partner]:{
    uid:str(partner),kind:str('partner_secondary'),active:flag(true),
    primaryCompanyId:str(internal),partnerCompanyId:str(external),
    hubCompanyId:str(internal),role:str(role),
    ...(role==='owner'?{}:{teamId:str('partner_team')})},
  ['users/'+partner]:{uid:str(partner),companyId:str(internal),companyRole:str('member'),
    active:flag(true),accessKind:str('internal')},
  ['companies/'+internal+'/members/'+partner]:{
    uid:str(partner),companyId:str(internal),
    companyRole:str('member'),active:flag(true),accessKind:str('internal')},
  ['companies/'+external]:{companyKind:str('partner'),active:flag(true),
    hubCompanyId:str(internal),
    ownerUid:str(role==='owner'?partner:'other_owner'),
    masterUid:str(role==='owner'?partner:'other_owner')},
  ['companies/'+external+'/members/'+partner]:{
    uid:str(partner),companyId:str(external),active:flag(true),
    accessKind:str('partner'),memberType:str('cooperator'),
    companyRole:str(role==='owner'?'owner':'member'),
    role:str(role==='owner'?'leader':role),
    ...(role==='owner'?{}:{teamId:str('partner_team')}),
    canViewRevenue:flag(false),canViewUnitPrice:flag(false)},
  ['partnerRelations/'+external]:{
    partnerCompanyId:str(external),hubCompanyId:str(internal),
    active:flag(true),countSharingApproved:flag(true)},
  [SUMMARY_PATH]:summaryPresent?{
    source:str('staff-entries-v1'),hubCompanyId:str(internal),
    partnerCompanyId:str(external),date:str(JST_DAY)
  }:undefined,
  ['companies/'+external+'/partnerWorkStaff/'+partner]:{
    uid:str(partner),companyId:str(external),active:flag(true),
    kind:str('account'),name:str('Demo Member'),
    role:str(role==='owner'?'leader':role),
    teamId:str('partner_team')}
 };
 const calls=[];
 const result={
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
   return {status:200,json:async()=>({name:url.slice(API.length),fields})};
  }
 };
 Object.defineProperty(result,'calls',{value:calls});
 return result;
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
    await assert.rejects(async()=>createLiveFirestoreOwnerPreflight(f.accounts)(),
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
    backupReviewed:true,verifyLiveRoles,
    preApplyCheck:async()=>({checkedAgainst:'production-live',
      ownerFinanceAllowed:true,affectedSecondaryBound:true,partnerSessionFresh:true,
      partnerCountViewAllowed:true})
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
  assert.match(source,/verifyLiveRoles:async proofArgs/);
  assert.match(source,/preApplyCheck:async/);
  assert.match(source,/PRE_SWITCH_OWNER_FINANCE_UNVERIFIED/);
  assert.match(source,/realOwnerBeforeVerified:true/);
  assert.match(source,/TRUSTED_AFFECTED_IDENTITY_REQUIRED/);
  assert.match(source,/POST_SWITCH_IDENTITY_UNVERIFIED/);
  // A money-403 proof alone must NOT certify release when a real partner
  // cannot even open the count-entry workspace under their own user token.
  assert.match(source,/createLivePartnerCountViewVerifier/);
  assert.match(source,/beforeCountView\(\)/);
  assert.match(source,/afterCountView\(\)/);
  assert.match(source,/PRE_SWITCH_COUNT_VIEW_UNVERIFIED/);
  assert.match(source,/POST_SWITCH_COUNT_VIEW_UNVERIFIED/);
  assert.doesNotMatch(source,/submitPartnerWorkspaceCounts/);
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
 assert.equal(identity.calls.length,12);
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
  ['users/secondaryPartner',{uid:str('wrong_uid')}],
  ['users/secondaryPartner',{active:flag(false)}],
  ['users/secondaryPartner',{active:{}}],
  ['companies/internal_company/members/secondaryPartner',{uid:str('wrong_uid')}],
  ['companies/internal_company/members/secondaryPartner',{companyId:str('wrong_company')}],
  ['users/realOwner',{uid:str('wrong_uid')}],
  ['users/realOwner',{active:flag(false)}],
  ['users/realOwner',{active:{}}],
  ['companies/internal_company/members/realOwner',{uid:str('wrong_uid')}],
  ['companies/internal_company/members/realOwner',{companyId:str('wrong_company')}],
  ['companies/internal_company',{active:flag(false)}],
  ['companies/partner_company',{active:flag(false)}],
  ['companies/partner_company/members/secondaryPartner',{active:flag(false)}],
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

test('identity Admin GET rejects HTTPS name and another document while accepting exact REST resource',async()=>{
 const badIdentity=fakeIdentity();
 const actualFetch=badIdentity.fetchImpl;
 badIdentity.fetchImpl=async(url,options)=>{
   const r=await actualFetch(url,options);
   if(r.status!==200)return r;
   return {status:200,json:async()=>({...await r.json(),name:url})};
 };
 await assert.rejects(createAffectedSecondaryIdentityVerifier({
   ...badIdentity,expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
   internalCompanyId:'internal_company'
 })(),/STOP_PHASE1_IDENTITY_UNRECOGNIZED_DOCUMENT/);
 assert(badIdentity.calls.every(x=>x.method==='GET'));
});


test('immediately before PATCH, BOTH sessions must have enough remaining lifetime',async()=>{
 for(const role of ['owner','partner']){
  const f=fixture();
  const token=jwt(role==='owner'?'realOwner':'secondaryPartner',{exp:T+400});
  const args={...f.accounts,
   ...(role==='owner'?{ownerIdToken:token}:{partnerIdToken:token})};
  const before=createLiveFirestoreSessionPreflight({
    ...args,minimumRemainingSeconds:600
  });
  assert.throws(before,/STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/);
  assert.equal(f.calls.length,0);
 }
});

test('fresh Owner/Partner token claims are only local precheck, NOT production proof',()=>{
 const f=fixture();
 const preflight=createLiveFirestoreSessionPreflight(f.accounts);
 const result=preflight();
 assert.deepEqual(result,{
  checkedAgainst:'local-claims-only',
  ownerSessionFresh:true,partnerSessionFresh:true,
  userTokenCryptographyVerified:false
 });
 assert.equal(f.calls.length,0,'the local freshness check does not call Firebase');
 assert.throws(preflight,/STOP_LIVE_ROLE_SINGLE_USE_SESSION_PREFLIGHT/);
});

test('synthetic pre-PATCH identity is blocked before any Rules change, even with fresh tokens',async()=>{
 const f=fixture(),r=releaseFixture();
 await assert.rejects(phase1WithLiveAccountGate({
   release:r.release,accounts:f.accounts,identity:fakeIdentity(),...approvals
 }),/STOP_PHASE1_LIVE_BRIDGE_TRUSTED_AFFECTED_IDENTITY_REQUIRED/);
 assert.equal(r.writes.length,0);
 assert.equal(r.getActive(),oldId);
});


test('real partner workspace role parity: secondary leader, member and owner ALL qualify for affected-ID security check',async()=>{
  for(const role of ['leader','member','owner']){
    const identity=fakeIdentity({role});
    const proof=await createAffectedSecondaryIdentityVerifier({
      ...identity,expectedOwnerUid:'realOwner',
      expectedPartnerUid:'secondaryPartner',internalCompanyId:'internal_company'
    })();
    assert.equal(proof.checkedAgainst,'synthetic-only');
    assert.equal(proof.affectedSecondaryBound,true);
    assert.equal(proof.ownerInternalBound,true);
    assert.equal(proof.productionDocumentWrites,0);
    assert.equal(identity.calls.length,role==='owner'?11:12);
    assert(identity.calls.every(x=>x.method==='GET'),
      'must never mutate any membership, financial or historical count');
  }
});

test('invalid Owner and worker role combinations stop BEFORE Rules release without changing saved counts',async()=>{
  const cases=[
    {role:'owner',changedPath:'companies/partner_company',
      changes:{ownerUid:str('unrelated_owner')}},
    {role:'owner',changedPath:'companies/partner_company',
      changes:{masterUid:str('unrelated_master')}},
    {role:'owner',changedPath:'companies/partner_company/members/secondaryPartner',
      changes:{companyRole:str('member')}},
    {role:'owner',changedPath:'companies/partner_company/members/secondaryPartner',
      changes:{role:str('member')}},
    {role:'owner',changedPath:'companies/partner_company/members/secondaryPartner',
      changes:{teamId:str('unexpected_team')}},
    {role:'leader',changedPath:'companies/partner_company/members/secondaryPartner',
      changes:{role:str('member')}},
    {role:'leader',changedPath:'companies/partner_company/members/secondaryPartner',
      changes:{teamId:str('other_team')}},
    {role:'member',changedPath:'partnerWorkspaceContexts/secondaryPartner',
      changes:{teamId:str('other_team')}},
    {role:'leader',changedPath:'companies/partner_company',
      changes:{ownerUid:str('secondaryPartner')}},
    {role:'member',changedPath:'companies/partner_company/members/secondaryPartner',
      changes:{companyRole:str('owner')}}
  ];
  for(const variant of cases){
    const identity=fakeIdentity(variant);
    await assert.rejects(createAffectedSecondaryIdentityVerifier({
      ...identity,expectedOwnerUid:'realOwner',
      expectedPartnerUid:'secondaryPartner',internalCompanyId:'internal_company'
    })(),/STOP_PHASE1_IDENTITY_(AFFECTED_SECONDARY_NOT_BOUND|PARTNER_SELF_COUNT_ENTRY_NOT_READY)/,
      variant.role+' '+variant.changedPath);
    assert(identity.calls.every(x=>x.method==='GET'),
      'no writes even when real data is inconsistent');
  }
});


test('finance denial cannot pass when the partner Callable count-sharing relation is disabled or foreign',async()=>{
 const variants=[
  {active:flag(false)},
  {countSharingApproved:flag(false)},
  {hubCompanyId:str('foreign_hub')},
  {partnerCompanyId:str('wrong_partner')},
  {countSharingApproved:flag('false')}
 ];
 for(const changes of variants){
  const identity=fakeIdentity({changedPath:'partnerRelations/partner_company',changes});
  await assert.rejects(createAffectedSecondaryIdentityVerifier({
   ...identity,expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
   internalCompanyId:'internal_company'
  })(),/STOP_PHASE1_IDENTITY_PARTNER_COUNT_SHARING_NOT_READY/);
  assert(identity.calls.every(call=>call.method==='GET'));
 }
});

test('member or leader with missing, inactive, wrong-team, or non-account staff cannot be used as count-entry proof',async()=>{
 const changesList=[
  {active:flag(false)},
  {teamId:str('other_team')},
  {companyId:str('other_company')},
  {uid:str('other_member')},
  {kind:str('managed')},
  {role:str('owner')},
  {name:str('')},
  {name:str('売上100万円')},
  {name:str('<invalid>')},
  {name:str('a'.repeat(61))}
 ];
 for(const role of ['leader','member']){
  for(const changes of changesList){
   const identity=fakeIdentity({
    role,changedPath:'companies/partner_company/partnerWorkStaff/secondaryPartner',
    changes
   });
   await assert.rejects(createAffectedSecondaryIdentityVerifier({
     ...identity,expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
     internalCompanyId:'internal_company'
   })(),/STOP_PHASE1_IDENTITY_PARTNER_SELF_COUNT_ENTRY_NOT_READY/);
   assert(identity.calls.every(call=>call.method==='GET'));
  }
 }
});


test('read-only Owner-independent identity also validates partner daily summary source before Rules switch',async()=>{
 const args={expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
  internalCompanyId:'internal_company'};
 const valid=fakeIdentity();
 const attested=await createAffectedSecondaryIdentityVerifier({...valid,...args})();
 assert.equal(attested.affectedSecondaryBound,true);
 assert.equal(valid.calls.some(x=>x.path===SUMMARY_PATH&&x.method==='GET'),true);
 assert.equal(valid.calls.every(x=>x.method==='GET'),true);
 const absent=fakeIdentity({summaryPresent:false});
 const safeFirstEntry=await createAffectedSecondaryIdentityVerifier({...absent,...args})();
 assert.equal(safeFirstEntry.affectedSecondaryBound,true,
  'no current-day company report is a valid initial input state');
 assert.equal(absent.calls.some(x=>x.path===SUMMARY_PATH),true);
});

test('old source, wrong scope or stale date blocks partner input before any live Rules changes',async()=>{
 const args={expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
  internalCompanyId:'internal_company'};
 for(const change of [
  {source:str('legacy-single-total')},
  {source:{}},
  {source:str('')},
  {hubCompanyId:str('unrelated-hub')},
  {partnerCompanyId:str('unrelated-partner')},
  {date:str('2026-10-01')}
 ]){
  const proof=fakeIdentity({changedPath:SUMMARY_PATH,changes:change});
  await assert.rejects(createAffectedSecondaryIdentityVerifier({
   ...proof,...args
  })(),/STOP_PHASE1_IDENTITY_PARTNER_CURRENT_DAY_INPUT_BLOCKED/);
  assert.equal(proof.calls.every(x=>x.method==='GET'),true);
  assert.equal(proof.calls.some(x=>x.path===SUMMARY_PATH),true);
 }
});

test('old daily summary is never rewritten or deleted to manufacture input readiness',async()=>{
 const f=fixture(),release=releaseFixture();
 const identity=fakeIdentity({
  changedPath:SUMMARY_PATH,changes:{source:str('legacy-single-total')}
 });
 await assert.rejects(
  phase1WithLiveAccountGate({release:release.release,accounts:f.accounts,
   identity,...approvals}),
  /STOP_PHASE1_IDENTITY_PARTNER_CURRENT_DAY_INPUT_BLOCKED/);
 assert.equal(release.writes.length,0);
 assert.equal(release.getActive(),oldId);
 assert.equal(f.calls.length,0,'cannot even start monetary probes with blocked counts');
 assert.equal(identity.calls.every(x=>x.method==='GET'),true);
});


test('JST midnight while reading invalidates a previous-day partner report check',async()=>{
 const f=fakeIdentity();
 const args={expectedOwnerUid:'realOwner',expectedPartnerUid:'secondaryPartner',
  internalCompanyId:'internal_company'};
 const beforeMidnight=Date.parse('2026-11-05T14:59:55Z'); // 23:59:55 JST
 let calls=0;
 await assert.rejects(createAffectedSecondaryIdentityVerifier({
  ...f,...args,now:()=>calls++===0?beforeMidnight:beforeMidnight+10_000
 })(),/STOP_PHASE1_IDENTITY_CURRENT_DAY_ROLLOVER/);
 assert.equal(f.calls.some(x=>x.path===SUMMARY_PATH),true,
  'the prior-day report was checked but cannot certify the new day');
 assert(f.calls.every(x=>x.method==='GET'),'audit must remain read-only');
});

test('cross-midnight identity proof never starts production Rules or finance requests',async()=>{
 const f=fixture(),release=releaseFixture(),identity=fakeIdentity();
 const beforeMidnight=Date.parse('2026-11-05T14:59:55Z');
 let ticks=0;
 await assert.rejects(phase1WithLiveAccountGate({
  release:release.release,accounts:f.accounts,
  identity:{...identity,now:()=>ticks++===0?beforeMidnight:beforeMidnight+10_000},
  ...approvals
 }),/STOP_PHASE1_IDENTITY_CURRENT_DAY_ROLLOVER/);
 assert.equal(release.writes.length,0);
 assert.equal(release.getActive(),oldId);
 assert.equal(f.calls.length,0);
 assert(identity.calls.every(x=>x.method==='GET'));
});
