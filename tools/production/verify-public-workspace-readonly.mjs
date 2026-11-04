#!/usr/bin/env node
/**
 * Unauthenticated, public-only production smoke test. NO credentials,
 * Firestore, tokens, sign-in, user IDs, record reads or data writes.
 * A callable POST with empty data may only be judged by an auth-denied code.
 * This is an observation, never a production deployment approval.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const URLS=Object.freeze({
 app:'https://nico-factory.web.app/',
 workspace:'https://nico-factory.web.app/partner-workspace.html',
 functions:'https://asia-northeast1-sales-management-cc116.cloudfunctions.net/'
});
const NAMES=Object.freeze([
 'getPartnerWorkspace','managePartnerWorkspace',
 'acceptPartnerWorkspaceInvite','submitPartnerWorkspaceCounts',
 'transferPartnerSecondaryMembership',
 'previewManagedAccountErasure','listManagedAccountErasurePending',
 'confirmManagedAccountErasure'
]);
const UNPUBLISHED=Object.freeze(new Set([
 'transferPartnerSecondaryMembership','previewManagedAccountErasure',
 'listManagedAccountErasurePending','confirmManagedAccountErasure'
]));
const stop=reason=>{throw new Error('STOP_PUBLIC_READONLY_'+reason);};
const hash=s=>createHash('sha256').update(s).digest('hex');
function environmentCheck(env){
 if(env.GOOGLE_APPLICATION_CREDENTIALS||env.FIREBASE_SERVICE_ACCOUNT_JSON||
    env.NICO_PUBLIC_READONLY!=='YES')stop('ENVIRONMENT_NOT_APPROVED');
}
async function response(fetcher,url,init){
 const signal=AbortSignal.timeout(15000);
 return fetcher(url,{...init,signal,redirect:'error'});
}
export async function inspectPublic({fetcher=fetch,env=process.env}={}){
 environmentCheck(env);
 const homepage=await response(fetcher,URLS.app,{method:'GET'});
 if(homepage.status!==200)stop('APP_HTTP_'+homepage.status);
 const html=await homepage.text();
 if(!html.includes('id="appScreen"')||!html.includes('id="partnerInlineWorkspace"')||
    html.length<10000)stop('UNEXPECTED_HOME_HTML');
 // Compare the existing public UI to the exact candidate file without
 // downloading any user data or making any deployment changes.
 const candidateHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 const liveFingerprint=hash(html),candidateFingerprint=hash(candidateHtml);
 const criticalIds=['appScreen','partnerInlineWorkspace','pInlineCountFields',
  'pInlineRanking','pInlineTeams','pInlineHistory','pInlineInviteEmail'];
 const missingCandidateIds=criticalIds.filter(id=>html.includes('id="'+id+'"')&&
  !candidateHtml.includes('id="'+id+'"'));
 if(missingCandidateIds.length)stop('CANDIDATE_REMOVES_EXISTING_UI');
 const workspace=await response(fetcher,URLS.workspace,{method:'GET'});
 if(workspace.status!==200)stop('WORKSPACE_HTTP_'+workspace.status);
 const wh=await workspace.text();
 if(!wh.includes('submitPartnerWorkspaceCounts')||!wh.includes('getPartnerWorkspace')||
    wh.length<1000)stop('UNEXPECTED_WORKSPACE_HTML');
 const result={project:'sales-management-cc116',mode:'PUBLIC_ONLY_READ_ONLY',
  firebaseCredentialsUsed:false,authenticatedUserReads:0,dataWrites:0,
  liveAppHtmlSha256:liveFingerprint,liveAppSizeBytes:Buffer.byteLength(html,'utf8'),
  candidateAppHtmlSha256:candidateFingerprint,
  candidateAppSizeBytes:Buffer.byteLength(candidateHtml,'utf8'),
  liveAppMatchesCandidate:liveFingerprint===candidateFingerprint,
  candidateHasMigrationAction:candidateHtml.includes('transferPartnerSecondaryMembership'),
  candidateHasAccountErasureAction:candidateHtml.includes('previewManagedAccountErasure')&&
   candidateHtml.includes('confirmManagedAccountErasure'),
  liveWorkspaceHtmlSha256:hash(wh),liveWorkspaceSizeBytes:Buffer.byteLength(wh,'utf8'),
  homepageHasSecondaryTransferAction:html.includes('transferPartnerSecondaryMembership'),
  homepageHasAdminErasureAction:html.includes('previewManagedAccountErasure')&&
   html.includes('confirmManagedAccountErasure'),
  api:{}};
 for(const name of NAMES){
  const r=await response(fetcher,URLS.functions+name,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:'{"data":{}}'
  });
  if(r.status===401||r.status===403)result.api[name]='anonymous_denied';
  else if(r.status===404){
   if(!UNPUBLISHED.has(name))stop('EXISTING_FUNCTION_MISSING_'+name);
   result.api[name]='not_published';
  }else stop('CALLABLE_UNSAFE_HTTP_'+name+'_'+r.status);
 }
 result.safeToDeploy=false;
 result.signedInPartnerE2EVerified=false;
 result.signedInOwnerFinanceVerified=false;
 return Object.freeze(result);
}
async function main(){
 try{
  const result=await inspectPublic();
  console.log('NICO_PUBLIC_PROBE '+JSON.stringify(result));
  if(result.api.transferPartnerSecondaryMembership==='not_published')
   console.log('BLOCK_MIGRATION_FUNCTION_NOT_PUBLISHED');
  for(const name of UNPUBLISHED)if(result.api[name]==='not_published')
   console.log('BLOCK_NOT_PUBLISHED_'+name);
  if(!result.homepageHasAdminErasureAction)
   console.log('BLOCK_ACCOUNT_ERASURE_UI_NOT_PUBLISHED');
  if(!result.homepageHasSecondaryTransferAction)
   console.log('BLOCK_SELF_MIGRATION_UI_NOT_PUBLISHED');
 }catch(e){
  console.error(e.message?.startsWith('STOP_PUBLIC_READONLY_')?e.message:
   'STOP_PUBLIC_READONLY_UNEXPECTED');
  process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
 await main();
