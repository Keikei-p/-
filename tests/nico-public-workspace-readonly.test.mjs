import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPublic} from '../tools/production/verify-public-workspace-readonly.mjs';
const allowedEnv={NICO_PUBLIC_READONLY:'YES'};
const kinds=['getPartnerWorkspace','managePartnerWorkspace','acceptPartnerWorkspaceInvite',
 'submitPartnerWorkspaceCounts','transferPartnerSecondaryMembership'];
function fakeFetch({missingMigration=true,homeHasAction=false,statusOverride={}}={}){
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,method:opts.method,headers:opts.headers||{},body:opts.body});
  if(url==='https://nico-factory.web.app/'){
   return {status:200,text:async()=>'<main id="appScreen"><section id="partnerInlineWorkspace"></section></main> '+
    'sample'.repeat(4000)+(homeHasAction?'transferPartnerSecondaryMembership':'')};
  }
  if(url==='https://nico-factory.web.app/partner-workspace.html'){
   return {status:200,text:async()=>'<p>submitPartnerWorkspaceCounts getPartnerWorkspace</p>'+
    'sample'.repeat(500)};
  }
  for(const name of kinds){
   if(url.endsWith('/'+name)){
    return {status:statusOverride[name]??(missingMigration&&name==='transferPartnerSecondaryMembership'?404:401)};
   }
  }
  throw Error('UNEXPECTED_URL');
 };
 return {fetcher,calls};
}
test('missing migration callable is reported without any production writes or sign in',async()=>{
 const {fetcher,calls}=fakeFetch();
 const x=await inspectPublic({fetcher,env:allowedEnv});
 assert.equal(x.project,'sales-management-cc116');
 assert.equal(x.api.transferPartnerSecondaryMembership,'not_published');
 assert.equal(x.api.managePartnerWorkspace,'anonymous_denied');
 assert.equal(x.dataWrites,0);
 assert.equal(x.authenticatedUserReads,0);
 assert.equal(x.safeToDeploy,false);
 assert.equal(calls.length,7);
 assert.ok(calls.every(c=>c.method==='GET'||(c.method==='POST'&&c.body==='{"data":{}}')));
 assert.ok(calls.every(c=>!c.headers.Authorization&&!c.headers.authorization));
 assert.equal(x.homepageHasSecondaryTransferAction,false);
 assert.equal(x.candidateHasMigrationAction,true);
 assert.equal(x.liveAppMatchesCandidate,false);
 assert.ok(x.candidateAppSizeBytes>10000);
});
test('published migration callable must reject anonymous request',async()=>{
 const {fetcher}=fakeFetch({missingMigration:false,homeHasAction:true,
  statusOverride:{transferPartnerSecondaryMembership:403}});
 const r=await inspectPublic({fetcher,env:allowedEnv});
 assert.equal(r.api.transferPartnerSecondaryMembership,'anonymous_denied');
 assert.equal(r.homepageHasSecondaryTransferAction,true);
 assert.equal(r.signedInPartnerE2EVerified,false);
});
test('anonymous callable 200, 400, 500 and missing existing function stop verification',async()=>{
 for(const [name,status] of [['getPartnerWorkspace',200],['managePartnerWorkspace',400],
  ['acceptPartnerWorkspaceInvite',500],['submitPartnerWorkspaceCounts',404]]){
  const {fetcher}=fakeFetch({statusOverride:{[name]:status}});
  await assert.rejects(inspectPublic({fetcher,env:allowedEnv}),/STOP_PUBLIC_READONLY_/);
 }
});
test('production credentials or absent explicit readonly mode stop without any network call',async()=>{
 const {fetcher,calls}=fakeFetch();
 for(const env of [{}, {NICO_PUBLIC_READONLY:'YES',GOOGLE_APPLICATION_CREDENTIALS:'/secrets'},
  {NICO_PUBLIC_READONLY:'YES',FIREBASE_SERVICE_ACCOUNT_JSON:'secret'}]){
  await assert.rejects(inspectPublic({fetcher,env}),/STOP_PUBLIC_READONLY_ENVIRONMENT_NOT_APPROVED/);
 }
 assert.equal(calls.length,0);
});
