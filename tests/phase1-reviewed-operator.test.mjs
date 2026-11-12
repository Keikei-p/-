import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperatorIntent,assertReviewedCodeGate,assertIndependentPRApprovalGate} from '../tools/production/phase1-reviewed-operator.mjs';

const baseline='d9f4df6a2ac0f8b5720534a2461ec66b94379190';
const candidate='6d6ac7fd3544b0326823e419a3acd7e1d060b714';
const main='516bfe74f525ad8ee95a800f796c77327cf9aeae';
const head='a'.repeat(40);
const ciRun='42163374662';
const review='INDEPENDENT_REVIEW_OF_PHASE1_RULES_AND_LIVE_IDENTITIES_COMPLETE';
const basic={
 FIREBASE_PROJECT_ID:'sales-management-cc116',
 NICO_USAGE_APPROVAL:'EXISTING_FUNCTIONS_AND_FULL_INVENTORY_APPROVED',
 FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'
};
const approved={
 ...basic,NICO_PHASE1_INDEPENDENT_SIGNOFF:review,
 NICO_PHASE1_REVIEWED_MAIN_SHA:main,
 NICO_PHASE1_REVIEWED_BASELINE_BLOB:baseline,
 NICO_PHASE1_REVIEWED_CANDIDATE_BLOB:candidate,
 NICO_PHASE1_REVIEWED_CHECKOUT_SHA:head,
 NICO_PHASE1_REVIEWED_CI_RUN_ID:ciRun
};
const proof={
 ownerIdToken:'owner-proof-secret',partnerIdToken:'partner-proof-secret',
 expectedOwnerUid:'owner_real',expectedPartnerUid:'partner_real',
 internalCompanyId:'company_hub',partnerCompanyId:'company_partner',
 productId:'product1',recordId:'record1'
};

test('manual reviewed runner defaults to safe verification without any apply permission',()=>{
 assert.deepEqual(validateOperatorIntent({mode:'verify',env:basic,proof:null}),{apply:false});
 assert.deepEqual(validateOperatorIntent({mode:'verify',env:approved,proof}),{apply:false});
});

test('no secret, approval or misleading project can run an apply request',()=>{
 for(const env of [
  basic,
  {...approved,NICO_PHASE1_INDEPENDENT_SIGNOFF:''},
  {...approved,NICO_PHASE1_REVIEWED_MAIN_SHA:'wrong'},
  {...approved,NICO_PHASE1_REVIEWED_MAIN_SHA:'17681e69d3ebd7271cc9a58e138fd0e202db7294'},
  {...approved,NICO_PHASE1_REVIEWED_BASELINE_BLOB:'wrong'},
  {...approved,NICO_PHASE1_REVIEWED_CANDIDATE_BLOB:'wrong'},
  {...approved,FIREBASE_PROJECT_ID:'demo-sales-support'},
  {...approved,FIRESTORE_EMULATOR_HOST:'attacker.example:8080'},
  {...approved,FIRESTORE_EMULATOR_HOST:'127.0.0.1:65536'},
  {...approved,FIRESTORE_EMULATOR_HOST:'127.0.0.1:0'},
  {...approved,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080/evil'},
  {...approved,NICO_USAGE_APPROVAL:'BAD'}
 ]){
  assert.throws(()=>validateOperatorIntent({mode:'apply',env,proof}),
    /STOP_PHASE1_OPERATOR_/);
 }
});

test('apply cannot be validated with altered identity, extra fields, or reused UID',()=>{
 for(const changed of [
  null,
  {},
  {...proof,role:'owner'},
  {...proof,internalCompanyId:'../escapes'},
  {...proof,expectedPartnerUid:proof.expectedOwnerUid},
  {...proof,partnerCompanyId:proof.internalCompanyId},
  {...proof,ownerIdToken:proof.partnerIdToken},
  {...proof,partnerIdToken:''},
  {...proof,recordId:''}
 ]){
  assert.throws(()=>validateOperatorIntent({mode:'apply',env:approved,proof:changed}),
    /STOP_PHASE1_OPERATOR_/);
 }
});

test('unknown mode and missing local-only environment fail without touching cloud',()=>{
 for(const mode of ['publish','run','apply-now','',null]){
  assert.throws(()=>validateOperatorIntent({mode,env:approved,proof}),
    /STOP_PHASE1_OPERATOR_/);
 }
 assert.throws(()=>validateOperatorIntent({mode:'verify',env:{
  ...basic,FIRESTORE_EMULATOR_HOST:'0.0.0.0:8080'
 },proof:null}),/STOP_PHASE1_OPERATOR_OFFLINE_PREFLIGHT/);
});


test('apply binds independent approval to exact clean checkout, fresh remote main and successful push CI',()=>{
 const commands=[];
 const git=(cmd,args)=>{
  commands.push('git '+cmd);
  if(cmd==='rev-parse')return head+'\n';
  if(cmd==='status'){
   assert.deepEqual(args,['--porcelain','--untracked-files=normal']);
   return '';
  }
  if(cmd==='remote'){
   assert.deepEqual(args,['get-url','origin']);
   return 'https://github.com/Keikei-p/-.git\n';
  }
  if(cmd==='ls-remote')return main+'\trefs/heads/main\n';
  throw Error('unexpected git request');
 };
 const gh=(cmd,args)=>{
  commands.push('gh '+cmd);
  assert.deepEqual(args,[
   'view',ciRun,'--repo','Keikei-p/-','--json','headSha,conclusion,event,name'
  ]);
  return JSON.stringify({headSha:head,conclusion:'success',event:'push',
   name:'NICO affected secondary identity + finance boundary (NO DEPLOY)'});
 };
 const actual=assertReviewedCodeGate({env:approved,git,gh});
 assert.equal(actual.mainUnchanged,true);
 assert.equal(actual.sourceReviewed,true);
 assert.equal(actual.ciForExactCheckout,true);
 assert.deepEqual(commands,['git rev-parse','git status','git remote','git ls-remote','gh run']);
});

test('apply cannot proceed on unreviewed, dirty, drifted, failed or fabricated CI evidence',()=>{
 const ready=()=>({headSha:head,conclusion:'success',event:'push',
  name:'NICO affected secondary identity + finance boundary (NO DEPLOY)'});
 const scenarios=[
  {local:'b'.repeat(40)},
  {dirty:' M firestore.rules'},
  {dirty:'?? tools/production/unreviewed-proof.mjs'},
  {dirty:'?? .env'},
  {remote:'https://github.com/Attacker/-.git'},
  {remote:'https://user:password@github.com/Keikei-p/-.git'},
  {remote:'https://github.com/Keikei-p/-evil.git'},
  {mainSha:'b'.repeat(40)},
  {mainSha:'17681e69d3ebd7271cc9a58e138fd0e202db7294'},
  {run:{...ready(),headSha:'b'.repeat(40)}},
  {run:{...ready(),conclusion:'failure'}},
  {run:{...ready(),event:'pull_request'}},
  {run:{...ready(),name:'unrelated-workflow'}},
  {run:{...ready(),conclusion:'cancelled'}},
  {throwGit:true},
  {throwGh:true}
 ];
 for(const scenario of scenarios){
  const git=(cmd)=>{
   if(scenario.throwGit)throw Error('remote failed');
   if(cmd==='rev-parse')return (scenario.local??head)+'\n';
   if(cmd==='status')return scenario.dirty??'';
   if(cmd==='remote')return (scenario.remote??'https://github.com/Keikei-p/-.git')+'\n';
   if(cmd==='ls-remote')return (scenario.mainSha??main)+'\trefs/heads/main\n';
   throw Error('unexpected');
  };
  const gh=()=>{
   if(scenario.throwGh)throw Error('github missing');
   return JSON.stringify(scenario.run??ready());
  };
  assert.throws(()=>assertReviewedCodeGate({env:approved,git,gh}),
   /STOP_PHASE1_OPERATOR_REVIEWED_(SOURCE_OR_CI_DRIFT|CODE_CHECK_UNAVAILABLE)/);
 }
});

test('apply requires explicitly reviewed CI ID and HEAD, not a self-described success flag',()=>{
 for(const env of [
  {...approved,NICO_PHASE1_REVIEWED_CHECKOUT_SHA:'main'},
  {...approved,NICO_PHASE1_REVIEWED_CHECKOUT_SHA:''},
  {...approved,NICO_PHASE1_REVIEWED_CI_RUN_ID:'not-a-run'},
  {...approved,NICO_PHASE1_REVIEWED_CI_RUN_ID:'0'},
  {...approved,NICO_PHASE1_REVIEWED_CI_RUN_ID:''}
 ]){
  assert.throws(()=>validateOperatorIntent({mode:'apply',env,proof}),
   /STOP_PHASE1_OPERATOR_INDEPENDENT_SIGNOFF_OR_REAL_ACCOUNTS_REQUIRED/);
 }
});


test('reviewed checkout accepts only the exact GitHub origin and clean untracked-aware status',()=>{
 for(const approvedRemote of [
  'https://github.com/Keikei-p/-',
  'git@github.com:Keikei-p/-.git',
  'ssh://git@github.com/Keikei-p/-.git'
 ]){
  let statusChecked=false;
  const git=(cmd,args)=>{
   if(cmd==='rev-parse')return head+'\n';
   if(cmd==='status'){
    statusChecked=true;
    assert.deepEqual(args,['--porcelain','--untracked-files=normal']);
    return '';
   }
   if(cmd==='remote')return approvedRemote+'\n';
   if(cmd==='ls-remote')return main+'\trefs/heads/main\n';
   throw Error('unexpected local command');
  };
  const gh=()=>JSON.stringify({
   headSha:head,conclusion:'success',event:'push',
   name:'NICO affected secondary identity + finance boundary (NO DEPLOY)'
  });
  assert.equal(assertReviewedCodeGate({env:approved,git,gh}).sourceReviewed,true);
  assert.equal(statusChecked,true);
 }
});

const independentPR={state:'open',draft:false,
 head:{sha:head},user:{login:'Keikei-p'}};
const humanApproval={id:100,state:'APPROVED',commit_id:head,
 author_association:'COLLABORATOR',
 user:{login:'trusted-reviewer',type:'User'}};
function fakeIndependentReview({
 pr=independentPR,reviews=[humanApproval],
 permission='write',apiError=''
}={}){
 const calls=[];
 const gh=(command,args)=>{
  assert.equal(command,'api');
  const endpoint=args[0];calls.push(endpoint);
  if(endpoint.includes(apiError)&&apiError)throw Error('private Github API down');
  if(endpoint==='repos/Keikei-p/-/pulls/380')return JSON.stringify(pr);
  if(endpoint==='repos/Keikei-p/-/pulls/380/reviews?per_page=100')
   return JSON.stringify(reviews);
  if(endpoint==='repos/Keikei-p/-/collaborators/trusted-reviewer/permission')
   return JSON.stringify({permission});
  if(endpoint==='repos/Keikei-p/-/collaborators/Keikei-p/permission')
   return JSON.stringify({permission:'admin'});
  throw Error('unsupported reviewer endpoint');
 };
 return {gh,calls};
}
test('apply needs an actual separate authorized human GitHub review on the exact non-draft HEAD',()=>{
 const {gh,calls}=fakeIndependentReview();
 assert.deepEqual(assertIndependentPRApprovalGate({env:approved,gh}),{
  independentHumanApproved:true,approvedCommitExact:true,
  reviewedByAuthorizedCollaborator:true
 });
 assert.deepEqual(calls,[
  'repos/Keikei-p/-/pulls/380',
  'repos/Keikei-p/-/pulls/380/reviews?per_page=100',
  'repos/Keikei-p/-/collaborators/trusted-reviewer/permission'
 ]);
});
test('an environment string or green CI cannot fabricate a real independent approval',()=>{
 const scenarios=[
  {reviews:[]},
  {reviews:[{...humanApproval,state:'COMMENTED'}]},
  {reviews:[{...humanApproval,commit_id:'b'.repeat(40)}]},
  {reviews:[{...humanApproval,user:{login:'Keikei-p',type:'User'}}]},
  {reviews:[{...humanApproval,user:{login:'automated-bot',type:'Bot'}}]},
  {reviews:[{...humanApproval,author_association:'NONE'}]},
  {permission:'read'},
  {permission:'triage'},
  {pr:{...independentPR,draft:true}},
  {pr:{...independentPR,state:'closed'}},
  {pr:{...independentPR,head:{sha:'b'.repeat(40)}}},
  {reviews:[...Array.from({length:100},(_,i)=>({...humanApproval,id:i+1}))]},
  {apiError:'pulls/380/reviews'}
 ];
 for(const scenario of scenarios){
  const {gh}=fakeIndependentReview(scenario);
  assert.throws(()=>assertIndependentPRApprovalGate({env:approved,gh}),
   /STOP_PHASE1_OPERATOR_INDEPENDENT_REVIEW_/);
 }
});
test('a current-main candidate with matching green push CI still cannot use missing or previous-head approval',()=>{
 const git=cmd=>{
  if(cmd==='rev-parse')return head+'\n';
  if(cmd==='status')return '';
  if(cmd==='remote')return 'https://github.com/Keikei-p/-.git\n';
  if(cmd==='ls-remote')return main+'\trefs/heads/main\n';
  throw Error('unexpected candidate source request');
 };
 const gh=()=>JSON.stringify({headSha:head,conclusion:'success',event:'push',
  name:'NICO affected secondary identity + finance boundary (NO DEPLOY)'});
 assert.equal(assertReviewedCodeGate({env:approved,git,gh}).mainUnchanged,true);
 for(const reviews of [[],[{...humanApproval,
  commit_id:'55f08ecfc5682742a00e914076accedb939846df'}]]){
  const lookup=fakeIndependentReview({reviews});
  assert.throws(()=>assertIndependentPRApprovalGate({env:approved,gh:lookup.gh}),
   /STOP_PHASE1_OPERATOR_INDEPENDENT_REVIEW_NOT_APPROVED/);
 }
});
test('revoked or change-requested reviews veto old approval, but normal comments do not revoke it',()=>{
 const invalid=[
  {...humanApproval,id:101,state:'CHANGES_REQUESTED'},
  {...humanApproval,id:101,state:'DISMISSED'}
 ];
 for(const later of invalid){
  const {gh}=fakeIndependentReview({reviews:[humanApproval,later]});
  assert.throws(()=>assertIndependentPRApprovalGate({env:approved,gh}),
   /STOP_PHASE1_OPERATOR_INDEPENDENT_REVIEW_/);
 }
 const {gh}=fakeIndependentReview({reviews:[
  humanApproval,{...humanApproval,id:101,state:'COMMENTED'}]});
 assert.equal(assertIndependentPRApprovalGate({env:approved,gh}).independentHumanApproved,true);
});
