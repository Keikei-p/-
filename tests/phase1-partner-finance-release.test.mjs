import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fingerprint,PROJECT} from '../tools/readonly-backup/backup.mjs';
import {
 phase1Boundary,allowedPhase1Request,BASELINE_GIT_BLOB,PHASE1_GIT_BLOB
} from '../tools/production/phase1-partner-finance-release.mjs';

const old=execFileSync('git',['show','origin/main:firestore.rules'],{
 encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024
});
const candidate=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const root='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
const releaseUrl=root+'/releases/cloud.firestore';
const oldId='projects/'+PROJECT+'/rulesets/old';
const candidateId='projects/'+PROJECT+'/rulesets/phase1';
const otherId='projects/'+PROJECT+'/rulesets/concurrent';
const date='2026-11-05T12:00:00Z';
const snap={
 projectId:PROJECT,format:'firestore-rest-typed-v1',
 documents:[
  {path:'records/private-synthetic',value:{fields:{
   totalCount:{integerValue:'3'},totalRevenue:{integerValue:'90000'}
  },createTime:date,updateTime:date}},
  {path:'companies/private-synthetic/members/synthetic',value:{fields:{
   active:{booleanValue:true},companyRole:{stringValue:'member'}
  },createTime:date,updateTime:date}}
 ]
};
const liveProof=()=>({checkedAgainst:'production-live',partnerDocumentDenied:true,
 partnerListDenied:true,ownerFinanceAllowed:true,partnerCountViewAllowed:true});
const approvals={approval:true,candidateEmulatorVerified:true,
 realOwnerBeforeVerified:true,backupReviewed:true,verifyLiveRoles:async()=>liveProof(),
 preApplyCheck:async()=>({checkedAgainst:'production-live',ownerFinanceAllowed:true,
  affectedSecondaryBound:true,partnerSessionFresh:true,partnerCountViewAllowed:true})};
const goodBackup=()=>({readyBackups:1,latestReadySnapshot:date});
const snapshot=async()=>structuredClone(snap);
const restore=async data=>({
 fieldsAndIdsVerified:true,productionTouched:false,
 documentCount:data.documents.length,
 sourceInventoryFingerprint:fingerprint(data)
});
function fixture({starting=oldId}={}){
 let current=starting,writes=[],logs=[],seen=0;
 const sources=new Map([[oldId,old],[candidateId,candidate],[otherId,old]]);
 const request=async(method,url,body)=>{
  seen++;
  if(method==='GET'){
   if(url===releaseUrl)return {rulesetName:current};
   return {source:{files:[{name:'firestore.rules',content:sources.get(
    url.slice('https://firebaserules.googleapis.com/v1/'.length))}]}};
  }
  writes.push({method,url,body});
  if(method==='POST')return {name:candidateId};
  current=body.release.rulesetName;
  return {name:current};
 };
 return {
  args:{request,snapshot,restore,backup:goodBackup,
   reviewedBaseline:old,reviewedCandidate:candidate,
   now:()=>Date.parse(date)+1000,log:x=>logs.push(x)},
  writes,logs,getCurrent:()=>current,setCurrent:x=>{current=x},
  getReadCount:()=>seen
 };
}
test('exact pinned baseline and approved candidate validate, but verify never writes',async()=>{
 const f=fixture();
 const s=await phase1Boundary(f.args);
 assert.equal(s.project,PROJECT);
 assert.equal(s.applied,false);
 assert.equal(s.documents,2);
 assert.equal(s.isolatedFieldsAndIdsRestored,true);
 assert.equal(s.managedBackupRestored,false);
 assert.equal(s.metadataTimestampsRestored,false);
 assert.equal(s.productionDocumentWrites,0);
 assert.equal(f.writes.length,0);
 assert.equal(f.getCurrent(),oldId);
 assert(!JSON.stringify(f.logs).includes('90000'),'logs omit revenue values');
});
test('old live and already-at-candidate Rules are accepted only with exact source',async()=>{
 const f=fixture({starting:candidateId});
 const status=await phase1Boundary(f.args);
 assert.equal(status.applied,false);
 assert.equal(f.writes.length,0);
});
test('a reviewed candidate already active must NOT report a new publish or issue writes',async()=>{
 const f=fixture({starting:candidateId});
 const r=await phase1Boundary({...f.args,...approvals,apply:true});
 assert.equal(r.applied,false,'there was no actual Rules publish');
 assert.equal(r.alreadyAtReviewedCandidate,true);
 assert.equal(r.reviewedRulesPresent,true);
 assert.equal(r.postSwitchRoleVerified,true);
 assert.equal(r.reviewedRealPartnerFinanceDeny,true);
 assert.equal(f.writes.length,0,'even approved idempotent path does not write');
 assert.equal(f.getCurrent(),candidateId);
});
test('deployer cannot apply without candidate emulator, Owner baseline, backup, post-switch verifier and signed approval',async()=>{
 for(const missing of Object.keys(approvals)){
  const f=fixture();
  const bad={...approvals,[missing]:false};
  await assert.rejects(phase1Boundary({...f.args,apply:true,...bad}),
   /STOP_PHASE1_MISSING_PRODUCTION_APPROVAL/);
  assert.equal(f.getReadCount(),0,'no cloud access before review');
  assert.equal(f.writes.length,0);
 }
});
test('unknown live, forged reviewed baseline or candidate stop before any mutation',async()=>{
 for(const [kind,code] of [
  ['old','BASELINE_UNREVIEWED'],['candidate','CANDIDATE_UNREVIEWED'],
  ['live','UNREVIEWED_LIVE_RULES']]){
  const f=fixture();
  let args={...f.args};
  if(kind==='old')args.reviewedBaseline=old+'\n// unapproved';
  if(kind==='candidate')args.reviewedCandidate=candidate+'\n// unapproved';
  if(kind==='live')args.request=async(method,url,body)=>{
   if(method==='GET'&&url===releaseUrl)return {rulesetName:oldId};
   if(method==='GET')return {source:{files:[{name:'firestore.rules',content:old+'\n// unapproved'}]}};
   throw Error('unexpected write');
  };
  await assert.rejects(phase1Boundary(args),new RegExp('STOP_PHASE1_'+code));
  assert.equal(f.writes.length,0);
 }
});
test('outdated backup, incomplete isolated restore and mutating snapshot are hard blocks',async()=>{
 for(const kind of ['backup','restore','moving']){
  const f=fixture(),args={...f.args};
  if(kind==='backup')args.backup=async()=>({readyBackups:1,latestReadySnapshot:'2026-10-01T00:00:00Z'});
  if(kind==='restore')args.restore=async()=>({productionTouched:false,fieldsAndIdsVerified:false});
  if(kind==='moving'){
   let n=0;
   args.snapshot=async()=>{
    const v=structuredClone(snap);
    v.documents[0].value.fields.totalCount.integerValue=String(3+n++);
    return v;
   };
  }
  await assert.rejects(phase1Boundary(args));
  assert.equal(f.writes.length,0);
 }
});
test('approved synthetic apply switches EXACTLY once and reads back Rules and full inventory',async()=>{
 const f=fixture();
 const r=await phase1Boundary({...f.args,...approvals,apply:true});
 assert.equal(r.applied,true);
 assert.equal(r.rollbackRuleset,oldId);
 assert.equal(r.currentRuleset,candidateId);
 assert.equal(f.getCurrent(),candidateId);
 assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH']);
 assert.equal(r.productionDocumentWrites,0);
 assert.equal(r.managedBackupRestored,false);
 assert.equal(r.postSwitchRoleVerified,true);
 assert.equal(r.reviewedRealPartnerFinanceDeny,true);
 assert.equal(r.reviewedLiveOwnerFinanceRead,true);
});
test('uncertain patch or changed inventory rolls Rules back to exact previously published release',async()=>{
 for(const kind of ['uncertainPatch','afterInventoryChanged']){
  const f=fixture(),oldRequest=f.args.request;
  if(kind==='uncertainPatch'){
   f.args.request=async(method,url,body)=>{
    const result=await oldRequest(method,url,body);
    if(method==='PATCH'&&body.release.rulesetName===candidateId)
     throw Error('simulated network loss');
    return result;
   };
  }else{
   let n=0;
   f.args.snapshot=async()=>{
    const v=structuredClone(snap);
    // Reads 1-4 precede the release, including our NEW final pre-PATCH
    // concurrency gate. Read 5 now detects post-apply drift and triggers
    // the rollback proof; earlier drift is instead stopped before PATCH.
    if(++n===5)v.documents[0].value.fields.totalCount.integerValue='4';
    return v;
   };
  }
  await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true}));
  assert.equal(f.getCurrent(),oldId,kind);
  assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH','PATCH']);
  assert.equal(f.logs.at(-1).rulesRolledBack,true);
 }
});
test('live permission probe runs after Rules switch and rejects missing, false, throwing or malformed proof',async()=>{
 for(const kind of ['noProof','partnerDoc','partnerList','owner','wrongTarget','throws']){
  const f=fixture();
  let called=0;
  const check=async args=>{
   called++;
   assert.equal(args.releaseName,'projects/'+PROJECT+'/releases/cloud.firestore');
   assert.equal(typeof args.expectedRulesSha256,'string');
   if(kind==='throws')throw Error('session unavailable');
   const result=liveProof();
   if(kind==='noProof')return null;
   if(kind==='partnerDoc')result.partnerDocumentDenied=false;
   if(kind==='partnerList')result.partnerListDenied=false;
   if(kind==='owner')result.ownerFinanceAllowed=false;
   if(kind==='wrongTarget')result.checkedAgainst='demo-only';
   return result;
  };
  await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true,
   verifyLiveRoles:check}));
  assert.equal(called,1);
  assert.equal(f.getCurrent(),oldId,'failure after switch must restore original Rules');
  assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH','PATCH']);
  assert.equal(f.logs.at(-1).rulesRolledBack,true);
 }
});
test('already-installed candidate cannot falsely claim safe state without live role proof',async()=>{
 const f=fixture({starting:candidateId});
 await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true,
  verifyLiveRoles:async()=>({checkedAgainst:'production-live',partnerDocumentDenied:false,
   partnerListDenied:false,ownerFinanceAllowed:true})}),/STOP_PHASE1_POST_SWITCH_ROLE_UNVERIFIED/);
 assert.deepEqual(f.writes,[],'never rollback someone else’s previously active Rules');
 assert.equal(f.getCurrent(),candidateId);
});
test('already-installed candidate cannot claim current security after a concurrent post-proof Rules change',async()=>{
 const f=fixture({starting:candidateId});
 await assert.rejects(phase1Boundary({
  ...f.args,...approvals,apply:true,
  verifyLiveRoles:async()=>{
   // A separate operator changes the active Rules while the real user
   // probes are in progress. The old candidate must not be reported active.
   f.setCurrent(otherId);
   return liveProof();
  }
 }),/STOP_PHASE1_POST_PROOF_RULES_RELEASE_RACE/);
 assert.equal(f.getCurrent(),otherId);
 assert.deepEqual(f.writes,[],'never overwrite or roll back another operator');
});

test('a newly switched release does not report success if changed during the user proof',async()=>{
 const f=fixture();
 await assert.rejects(phase1Boundary({
  ...f.args,...approvals,apply:true,
  verifyLiveRoles:async()=>{
   f.setCurrent(otherId);
   return liveProof();
  }
 }),/STOP_PHASE1_CONCURRENT_OPERATOR_MANUAL_REVIEW/);
 assert.equal(f.getCurrent(),otherId);
 assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH'],
  'no second PATCH may overwrite a competing operator');
});

test('verify-only never invokes live-role probe or implies live denial',async()=>{
 const f=fixture();
 let called=0;
 const report=await phase1Boundary({...f.args,verifyLiveRoles:async()=>{called++;throw Error('must not call');}});
 assert.equal(report.applied,false);
 assert.equal(report.reviewedRealPartnerFinanceDeny,false);
 assert.equal(report.postSwitchRoleVerified,false);
 assert.equal(called,0);
 assert.equal(f.writes.length,0);
});
test('a changed production inventory before Rules PATCH stops without modifying the live release',async()=>{
 const f=fixture();
 let n=0;
 f.args.snapshot=async()=>{
  const value=structuredClone(snap);
  if(++n===3)value.documents[0].value.fields.totalCount.integerValue='4';
  return value;
 };
 await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true}),
  /STOP_PHASE1_INVENTORY_CHANGED_BEFORE_APPLY/);
 assert.equal(f.getCurrent(),oldId);
 assert.deepEqual(f.writes.map(x=>x.method),['POST'],
  'a newly created, inactive Ruleset is safe; no live-release PATCH');
});
test('do not rollback a concurrent operator unrelated release',async()=>{
 const f=fixture(),original=f.args.request;
 f.args.request=async(method,url,body)=>{
  const result=await original(method,url,body);
  if(method==='PATCH'){
   f.setCurrent(otherId);
   throw Error('concurrent operator');
  }
  return result;
 };
 await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true}),
  /CONCURRENT_OPERATOR_MANUAL_REVIEW/);
 assert.equal(f.getCurrent(),otherId);
 assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH']);
});
test('no arbitrary Firestore writes, wrong host or unreviewed Rules source passes transport',()=>{
 for(const method of ['PATCH','POST','DELETE']){
  assert.equal(allowedPhase1Request(method,
   'https://firestore.googleapis.com/v1/projects/'+PROJECT+
   '/databases/(default)/documents/records/private',{}),false);
 }
 assert.equal(allowedPhase1Request('GET','https://wrong.example/firestore'),false);
 assert.equal(allowedPhase1Request('GET',
  root.replace(PROJECT,'wrong')+'/releases/cloud.firestore'),false);
 assert.equal(allowedPhase1Request('PATCH',releaseUrl,{
  release:{name:'projects/'+PROJECT+'/releases/cloud.firestore',
   rulesetName:'projects/wrong/rulesets/evil'},
  updateMask:'rulesetName'
 }),false);
 assert.equal(typeof BASELINE_GIT_BLOB,'string');
 assert.equal(typeof PHASE1_GIT_BLOB,'string');
});
test('release helper contains no executable production runner or identity loading',()=>{
 const source=readFileSync(new URL(
  '../tools/production/phase1-partner-finance-release.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS|firebase\s+deploy/);
 assert.doesNotMatch(source,/applicationDefault|initializeApp|createRequire/);
 assert.match(source,/apply=false/);
});


test('after last full-data snapshot, expired credentials STOP before ANY active Rules PATCH',async()=>{
 const f=fixture();
 let precheck=0;
 await assert.rejects(phase1Boundary({
  ...f.args,...approvals,apply:true,
  preApplyCheck:async()=>{precheck++;throw Error('STOP_TEST_USER_SESSION_EXPIRED');}
 }),/STOP_TEST_USER_SESSION_EXPIRED/);
 assert.equal(precheck,1);
 assert.deepEqual(f.writes.map(x=>x.method),['POST'],
  'creating an unactivated version is allowed; NEVER alter active Rules');
 assert.equal(f.getCurrent(),oldId);
});

test('fake or incomplete pre-PATCH evidence does NOT authorize a Rules release',async()=>{
 for(const evidence of [
  null,{},'ok',
  {checkedAgainst:'synthetic-only',ownerFinanceAllowed:true,
   affectedSecondaryBound:true,partnerSessionFresh:true,partnerCountViewAllowed:true},
  {checkedAgainst:'production-live',ownerFinanceAllowed:false,
   affectedSecondaryBound:true,partnerSessionFresh:true,partnerCountViewAllowed:true},
  {checkedAgainst:'production-live',ownerFinanceAllowed:true,
   affectedSecondaryBound:false,partnerSessionFresh:true,partnerCountViewAllowed:true},
  {checkedAgainst:'production-live',ownerFinanceAllowed:true,
   affectedSecondaryBound:true,partnerSessionFresh:false}
 ]){
  const f=fixture();
  await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true,
   preApplyCheck:async()=>evidence}),/STOP_PHASE1_PRE_SWITCH_ACCOUNT_UNVERIFIED/);
  assert.equal(f.getCurrent(),oldId);
  assert.deepEqual(f.writes.map(x=>x.method),['POST']);
 }
});

test('pre-PATCH reproof is not called during readonly verify or candidate already active',async()=>{
 for(const starting of [oldId,candidateId]){
  const f=fixture({starting});
  const result=await phase1Boundary({...f.args,...approvals,
   apply:starting===candidateId,
   preApplyCheck:async()=>{throw Error('must not contact account sessions');}});
  assert.equal(result.applied,false);
  assert.equal(f.writes.length,0);
 }
});

test('pre-PATCH reproof runs after final inventory validation and BEFORE switch',async()=>{
 const f=fixture();
 const calls=[],getSnapshot=f.args.snapshot;
 const result=await phase1Boundary({...f.args,...approvals,apply:true,
  snapshot:async()=>{calls.push('snapshot');return getSnapshot();},
  preApplyCheck:async()=>{
   calls.push('preApply');
   assert.equal(f.getCurrent(),oldId);
   return {checkedAgainst:'production-live',ownerFinanceAllowed:true,
    affectedSecondaryBound:true,partnerSessionFresh:true,partnerCountViewAllowed:true};
  }
 });
 assert.equal(result.applied,true);
 assert.equal(calls.filter(x=>x==='preApply').length,1);
 assert.equal(calls[calls.indexOf('preApply')-1],'snapshot');
 assert.equal(calls[calls.indexOf('preApply')+1],'snapshot',
  'the live inventory is checked AGAIN after authenticated preflight');
 assert.equal(f.getCurrent(),candidateId);
});


test('a real count arriving DURING pre-PATCH identity checks stops release BEFORE changing active Rules',async()=>{
 const f=fixture();
 let liveCount=3;
 const snapFn=async()=>{
  const snapshot=structuredClone(snap);
  snapshot.documents[0].value.fields.totalCount.integerValue=String(liveCount);
  return snapshot;
 };
 const good=()=>({checkedAgainst:'production-live',ownerFinanceAllowed:true,
  affectedSecondaryBound:true,partnerSessionFresh:true,partnerCountViewAllowed:true});
 await assert.rejects(phase1Boundary({
  ...f.args,...approvals,apply:true,snapshot:snapFn,
  preApplyCheck:async()=>{
   assert.equal(f.getCurrent(),oldId);
   liveCount=4; // another seller just entered a real count
   return good();
  }
 }),/STOP_PHASE1_LIVE_COUNT_OR_FINANCE_CHANGED_BEFORE_PATCH/);
 assert.equal(liveCount,4,'a legitimate count entry is NEVER rolled back');
 assert.equal(f.getCurrent(),oldId,'finance Rules stay on the existing release');
 assert.deepEqual(f.writes.map(x=>x.method),['POST'],
  'no active release PATCH, no Firestore document writes');
});

test('a concurrent Rules operator during owner account proof prevents any PATCH',async()=>{
 const f=fixture();
 await assert.rejects(phase1Boundary({
  ...f.args,...approvals,apply:true,
  preApplyCheck:async()=>{
   assert.equal(f.getCurrent(),oldId);
   f.setCurrent(otherId);
   return {checkedAgainst:'production-live',ownerFinanceAllowed:true,
    affectedSecondaryBound:true,partnerSessionFresh:true,partnerCountViewAllowed:true};
  }
 }),/STOP_PHASE1_RULES_RELEASE_RACE_BEFORE_PATCH/);
 assert.equal(f.getCurrent(),otherId,'do not revert an unrelated release');
 assert.deepEqual(f.writes.map(x=>x.method),['POST']);
});


test('missing REAL pre-switch count-view proof blocks Rules PATCH without touching any saved totals',async()=>{
 for(const absent of [undefined,false,'true']){
  const f=fixture();
  await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true,
   preApplyCheck:async()=>({
    checkedAgainst:'production-live',ownerFinanceAllowed:true,
    affectedSecondaryBound:true,partnerSessionFresh:true,
    ...(absent===undefined?{}:{partnerCountViewAllowed:absent})
   })
  }),/STOP_PHASE1_PRE_SWITCH_COUNT_VIEW_UNVERIFIED/);
  assert.equal(f.getCurrent(),oldId);
  assert.deepEqual(f.writes.map(x=>x.method),['POST'],
   'unactivated Rules version may exist, but live release MUST remain unchanged');
 }
});

test('live finance 403 without a verified partner count view triggers Rules rollback',async()=>{
 for(const missing of [undefined,false,'true']){
  const f=fixture();
  const result={...liveProof()};
  if(missing===undefined)delete result.partnerCountViewAllowed;
  else result.partnerCountViewAllowed=missing;
  await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true,
   verifyLiveRoles:async()=>result
  }),/STOP_PHASE1_POST_SWITCH_COUNT_VIEW_UNVERIFIED/);
  assert.equal(f.getCurrent(),oldId);
  assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH','PATCH'],
   'finance-only proof may NEVER report a successful Rules cutover');
 }
});

test('approved live proof reports count-view continuity without inventing pre-switch proof',async()=>{
 const existing=fixture({starting:candidateId});
 const noSwitch=await phase1Boundary({...existing.args,...approvals,apply:true});
 assert.equal(noSwitch.applied,false);
 assert.equal(noSwitch.reviewedPartnerCountViewBeforeSwitch,false,
  'existing candidate has no new pre-switch check');
 assert.equal(noSwitch.reviewedPartnerCountViewAfterSwitch,true);
 assert.equal(existing.writes.length,0);
 const pending=fixture();
 const verifyOnly=await phase1Boundary({...pending.args});
 assert.equal(verifyOnly.reviewedPartnerCountViewBeforeSwitch,false);
 assert.equal(verifyOnly.reviewedPartnerCountViewAfterSwitch,false);
 assert.equal(pending.writes.length,0);
 const switched=fixture();
 const success=await phase1Boundary({...switched.args,...approvals,apply:true});
 assert.equal(success.applied,true);
 assert.equal(success.reviewedPartnerCountViewBeforeSwitch,true);
 assert.equal(success.reviewedPartnerCountViewAfterSwitch,true);
 assert.equal(success.productionDocumentWrites,0);
});

test('Rules PATCH rechecks READY managed backup after slow Owner/partner preflight',async()=>{
 for(const failure of ['expired-during-preflight','backup-revoked','backup-now-future','second-read-unavailable']){
  const f=fixture();
  let backupReads=0,currentTime=Date.parse(date)+1000;
  const latest=Date.parse(date);
  const backups=async()=>{
   backupReads++;
   if(backupReads===1)return {readyBackups:1,latestReadySnapshot:date};
   if(failure==='backup-revoked')return {readyBackups:0,latestReadySnapshot:date};
   if(failure==='backup-now-future')return {
    readyBackups:1,latestReadySnapshot:new Date(currentTime+60_000).toISOString()
   };
   if(failure==='second-read-unavailable')throw Error('STOP_TEST_BACKUP_API_UNAVAILABLE');
   return {readyBackups:1,latestReadySnapshot:date};
  };
  let preflightCalls=0;
  await assert.rejects(phase1Boundary({
   ...f.args,...approvals,apply:true,backup:backups,now:()=>currentTime,
   preApplyCheck:async()=>{
    preflightCalls++;
    assert.equal(f.getCurrent(),oldId);
    if(failure==='expired-during-preflight')
     currentTime=latest+48*60*60*1000+1;
    return {checkedAgainst:'production-live',ownerFinanceAllowed:true,
     affectedSecondaryBound:true,partnerSessionFresh:true,
     partnerCountViewAllowed:true};
   }
  }),/STOP_PHASE1_RECENT_BACKUP_REQUIRED|STOP_TEST_BACKUP_API_UNAVAILABLE/,
  failure+' must stop without an active Rules release update');
  assert.equal(preflightCalls,1,failure);
  assert.equal(backupReads,2,failure+' must verify backup again just before PATCH');
  assert.equal(f.getCurrent(),oldId,failure+' may never switch active Rules');
  assert.deepEqual(f.writes.map(x=>x.method),['POST'],
   'unactivated Ruleset creation is NOT an active release PATCH');
 }
});

test('approved switch checks managed backup twice; verify-only reads it once',async()=>{
 const f=fixture();
 let checks=0;
 const backup=async()=>{checks++;return goodBackup();};
 const result=await phase1Boundary({...f.args,...approvals,apply:true,backup});
 assert.equal(result.applied,true);
 assert.equal(checks,2,'second READY check must be after preApplyCheck');
 assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH']);
 const readonly=fixture();
 let readonlyChecks=0;
 const verified=await phase1Boundary({...readonly.args,
  backup:async()=>{readonlyChecks++;return goodBackup();}
 });
 assert.equal(verified.applied,false);
 assert.equal(readonlyChecks,1,'read-only verification is never a release');
 assert.equal(readonly.writes.length,0);
});
