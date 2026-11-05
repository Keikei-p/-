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
const approvals={approval:true,realOwnerVerified:true,realPartnerDenied:true,backupReviewed:true};
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
test('deployer cannot apply without separate owner, partner, backup and signed approval',async()=>{
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
    // reads 1,2 are pre-apply checks; the third read differs.
    if(++n===4)v.documents[0].value.fields.totalCount.integerValue='4';
    return v;
   };
  }
  await assert.rejects(phase1Boundary({...f.args,...approvals,apply:true}));
  assert.equal(f.getCurrent(),oldId,kind);
  assert.deepEqual(f.writes.map(x=>x.method),['POST','PATCH','PATCH']);
  assert.equal(f.logs.at(-1).rulesRolledBack,true);
 }
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
 const sha=require=>require;
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
