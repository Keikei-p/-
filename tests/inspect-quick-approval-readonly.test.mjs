import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENDPOINTS,FUNCTION,PROJECT,REGION,classifyQuickApproval,inspectQuickApproval}
 from '../tools/production/inspect-quick-approval-readonly.mjs';

const name='projects/'+PROJECT+'/locations/'+REGION+'/functions/'+FUNCTION;
const response=(status,body)=>({status,json:async()=>body});

test('only the owner quick-approval Function is inspected using 2 metadata GETs',async()=>{
 const called=[];
 const result=await inspectQuickApproval(async url=>{
  called.push(url);
  return url===ENDPOINTS[0]?response(200,{name,state:'ACTIVE'}):{status:404};
 });
 assert.deepEqual(called,ENDPOINTS);
 assert.equal(result.deployed,true);
 assert.equal(result.active,true);
 assert.equal(result.gen2Present,true);
 assert.equal(result.gen1Present,false);
 assert.equal(result.productionWrites,0);
 assert.equal(result.actualApprovalInvocationVerified,false);
 assert.equal(result.actualOwnerCountApprovalVerified,false);
 assert.equal(result.safeToSwitchFinanceRules,false);
 assert.equal(result.safeToPublishNewWorkspaceUI,false);
});

test('Gen1 ACTIVE is recognized without claiming any real user approval success',async()=>{
 const x=await inspectQuickApproval(async url=>url===ENDPOINTS[1]?
  response(200,{name,status:'ACTIVE'}):{status:404});
 assert.equal(x.deployed,true);
 assert.equal(x.active,true);
 assert.equal(x.gen1Present,true);
 assert.equal(x.actualOwnerCountApprovalVerified,false);
});

test('absent, inactive, and wrong project/region cannot pass health proof',async()=>{
 const missing=await inspectQuickApproval(async()=>({status:404}));
 assert.equal(missing.deployed,false);
 assert.equal(missing.active,false);
 const inactive=await inspectQuickApproval(async url=>url===ENDPOINTS[0]?
  response(200,{name,state:'DEPLOYING'}):{status:404});
 assert.equal(inactive.deployed,true);
 assert.equal(inactive.active,false);
 const wrong=classifyQuickApproval('v2',200,{
  name:'projects/foreign/locations/us-central1/functions/'+FUNCTION,state:'ACTIVE'});
 assert.deepEqual(wrong,{present:false,active:false});
});

test('duplicate generations are flagged instead of certified as an unambiguous target',async()=>{
 const both=await inspectQuickApproval(async url=>url===ENDPOINTS[0]?
  response(200,{name,state:'ACTIVE'}):response(200,{name,status:'ACTIVE'}));
 assert.equal(both.ambiguousGenerations,true);
 assert.equal(both.actualApprovalInvocationVerified,false);
});

test('401/403/throttle/remote errors and bad JSON all fail closed',async()=>{
 for(const status of [401,403,429,500]){
  await assert.rejects(inspectQuickApproval(async()=>({status})),
   /STOP_QUICK_APPROVAL_AUDIT_/);
 }
 await assert.rejects(inspectQuickApproval(async()=>{throw Error('secret in transport');}),
  /STOP_QUICK_APPROVAL_AUDIT_REMOTE_READ_UNVERIFIED/);
 await assert.rejects(inspectQuickApproval(async()=>response(200,null)),
  /STOP_QUICK_APPROVAL_AUDIT_MALFORMED_METADATA/);
 await assert.rejects(inspectQuickApproval(async()=>({status:200,json:async()=>{throw Error('token');}})),
  /STOP_QUICK_APPROVAL_AUDIT_JSON_UNKNOWN/);
 assert.throws(()=>classifyQuickApproval('v3',404,null),
  /STOP_QUICK_APPROVAL_AUDIT_GENERATION/);
});

test('audit and workflow cannot deploy or print credentials; PR never uses service identity',()=>{
 const source=readFileSync(new URL('../tools/production/inspect-quick-approval-readonly.mjs',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../.github/workflows/nico-quick-approval-health-audit.yml',import.meta.url),'utf8');
 assert.match(source,/method:'GET'/);
 assert.match(source,/safeToSwitchFinanceRules:false/);
 assert.doesNotMatch(source,/method:'POST'|method:'PATCH'|method:'DELETE'|method:'PUT'/);
 assert.doesNotMatch(source,/firebase deploy|setDoc\(|updateDoc\(|deleteDoc\(|console\.log\(response|console\.log\(token/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/contents: read/);
 assert.match(workflow,/github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.doesNotMatch(workflow,/firebase deploy|firestore:rules|functions:delete|--force|permissions:\s*\n\s*contents:\s*write/);
});
